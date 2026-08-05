/**
 * Core Cashu engine — mint interactions, proof management, token encode/decode.
 *
 * All mint API calls go through @cashu/cashu-ts. Proof storage is delegated
 * to cashu-store.js. This module is imported ONLY in background.js.
 */

import {
  Wallet, CheckStateEnum, OutputData, getEncodedToken, getTokenMetadata,
  getPubKeyFromPrivKey, setGlobalRequestOptions,
} from '@cashu/cashu-ts'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  addProofs, removeProofs, swapProofs, getAllProofs, createCashuCounterSource,
} from './cashu-store.js'
import { log } from './logger.js'
import { requireSecureUrl } from './origins.js'
import {
  clearCashuRecovery, readCashuRecovery, saveCashuRecovery,
} from './cashu-recovery.js'
import {
  clearCashuMeltJournal, readCashuMeltJournal, saveCashuMeltJournal,
} from './cashu-melt-journal.js'

// Turn a stalled mint request into a retryable network error. Cashu-ts uses
// this with NUT-19 cached endpoints, while our encrypted journals protect
// operations when the mint does not advertise cached responses.
export const CASHU_REQUEST_TIMEOUT_MS = 15_000
setGlobalRequestOptions({ requestTimeout: CASHU_REQUEST_TIMEOUT_MS })

// ── Wallet-level mutex (serialize proof-mutating ops per wallet) ─

const walletLocks = new Map()
const volatileRecoveryJournals = new Map()

/**
 * Acquire an exclusive lock for the given walletId.
 * Returns a release function that MUST be called when done.
 */
function acquireLock(walletId) {
  const prev = walletLocks.get(walletId) || Promise.resolve()
  let release
  const next = new Promise(resolve => { release = resolve })
  walletLocks.set(walletId, next)
  return prev.then(() => release)
}

// ── Wallet client cache (singleton per mint URL, 10 min TTL) ────

const WALLET_TTL_MS = 10 * 60 * 1000
const walletClients = new Map()   // walletId + mintUrl → { wallet, createdAt }
const walletInitPromises = new Map()

function amountToNumber(value, label = 'Cashu amount') {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'string'
        ? Number(value)
        : typeof value?.toNumber === 'function'
          ? value.toNumber()
          : Number.NaN
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Invalid ${label}`)
  return amount
}

function validateAmount(amount, label = 'Cashu amount') {
  const value = amountToNumber(amount, label)
  if (value <= 0 || value > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function normalizeProofs(proofs) {
  if (!Array.isArray(proofs) || proofs.length > 10_000) throw new Error('Invalid proof data')
  return proofs.map(proof => ({ ...proof, amount: validateAmount(proof?.amount, 'proof amount') }))
}

async function getWallet(mintUrl, options = {}) {
  const normalizedMint = requireSecureUrl(mintUrl, { allowLoopback: true }).toString().replace(/\/$/, '')
  const cacheKey = `${options.walletId || 'public'}:${normalizedMint}`
  const cached = walletClients.get(cacheKey)
  if (cached && (Date.now() - cached.createdAt) < WALLET_TTL_MS) {
    return cached.wallet
  }
  // Stale or missing — evict and re-create
  if (cached) {
    walletClients.delete(cacheKey)
    walletInitPromises.delete(cacheKey)
  }
  if (!walletInitPromises.has(cacheKey)) {
    const promise = (async () => {
      const deterministic = options.seed instanceof Uint8Array && options.seed.length > 0
      const wallet = new Wallet(normalizedMint, {
        unit: 'sat',
        requireSigDleq: true,
        ...(deterministic ? {
          bip39seed: options.seed,
          secretsPolicy: 'deterministic',
          counterSource: createCashuCounterSource(options.walletId, options.password, normalizedMint),
        } : {}),
      })
      await wallet.loadMint()
      walletClients.set(cacheKey, { wallet, createdAt: Date.now() })
      return wallet
    })().finally(() => walletInitPromises.delete(cacheKey))
    walletInitPromises.set(cacheKey, promise)
  }
  return walletInitPromises.get(cacheKey)
}

function validateProofs(proofs) {
  const normalized = normalizeProofs(proofs)
  for (const proof of normalized) {
    if (!proof.id || !proof.secret || !proof.C) throw new Error('Corrupted proof detected in wallet')
  }
  return normalized
}

async function persistProofTransition(operation, recoveryProofs, mintUrl, walletId, password) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await operation()
      return
    } catch (error) {
      lastError = error
      log.warn('cashu', 'PROOF_STORE_RETRY', { attempt, err: error?.message })
    }
  }
  let journal
  volatileRecoveryJournals.set(walletId, { mint: mintUrl, proofs: recoveryProofs })
  try {
    journal = await saveCashuRecovery(walletId, password, mintUrl, recoveryProofs)
  } catch (journalError) {
    const fatal = new Error(`Cashu proofs could not be stored or journaled: ${journalError?.message || lastError?.message || 'unknown storage error'}`)
    fatal.code = 'CASHU_STORAGE_FATAL'
    throw fatal
  }
  const error = new Error(`Cashu proofs need recovery after a storage error: ${lastError?.message || 'unknown storage error'}`)
  error.code = 'CASHU_RECOVERY_REQUIRED'
  error.recoveryDurable = journal.durable
  throw error
}

// ── Receive via Lightning (mint quote → invoice → poll → proofs) ─

/**
 * Create a mint quote — returns an invoice the sender pays.
 * @returns {{ quote: string, request: string, expiry: number }}
 */
export async function createMintQuote(mintUrl, amountSats, walletId, password, seed, quotePrivkey) {
  const amount = validateAmount(amountSats)
  const wallet = await getWallet(mintUrl, { walletId, password, seed })
  const canLockQuote = wallet.getMintInfo()?.nuts?.['20']?.supported === true
    && /^[0-9a-f]{64}$/i.test(quotePrivkey || '')
  const quote = canLockQuote
    ? await wallet.createLockedMintQuote(
      amount,
      bytesToHex(getPubKeyFromPrivKey(hexToBytes(quotePrivkey))),
    )
    : await wallet.createMintQuoteBolt11(amount)
  return {
    quote: quote.quote,
    request: quote.request,
    expiry: quote.expiry || 0,
    locked: canLockQuote,
  }
}

/**
 * Check mint quote status — has the invoice been paid?
 * @returns {{ paid: boolean, state: string }}
 */
export async function checkMintQuote(mintUrl, quoteId, walletId, password, seed) {
  if (typeof quoteId !== 'string' || !quoteId || quoteId.length > 1024) throw new Error('Invalid mint quote')
  const wallet = await getWallet(mintUrl, { walletId, password, seed })
  const status = await wallet.checkMintQuoteBolt11(quoteId)
  const paid = status.state === 'PAID' || status.paid === true
  return { paid, state: status.state || (paid ? 'PAID' : 'UNPAID') }
}

/** Wait for a quote over NUT-17 when supported, with a polling fallback. */
export async function waitForMintQuote(mintUrl, quoteId, walletId, password, seed, timeoutMs = 20_000) {
  if (typeof quoteId !== 'string' || !quoteId || quoteId.length > 1024) throw new Error('Invalid mint quote')
  const timeout = Math.min(30_000, Math.max(1_000, Number(timeoutMs) || 20_000))
  const wallet = await getWallet(mintUrl, { walletId, password, seed })
  const nut17 = wallet.getMintInfo()?.nuts?.['17']?.supported
  const supportsUpdates = Array.isArray(nut17)
    && nut17.some(method => method?.method === 'bolt11'
      && method?.unit === 'sat'
      && method?.commands?.includes('bolt11_mint_quote'))
  if (supportsUpdates) {
    try {
      const status = await wallet.on.onceMintPaid(quoteId, { timeoutMs: timeout })
      return { paid: status.state === 'PAID', state: status.state || 'UNPAID', realtime: true }
    } catch { /* fall through to one authoritative HTTP check */ }
  }
  return { ...(await checkMintQuote(mintUrl, quoteId, walletId, password, seed)), realtime: false }
}

/**
 * Mint tokens after invoice is paid. Stores proofs locally.
 * Mutex-protected + retry on storage failure (same as receiveEcashToken).
 * @returns {{ proofs: CashuProof[], amountSats: number }}
 */
export async function mintTokens(mintUrl, amountSats, quoteId, walletId, password, seed, quotePrivkey) {
  const release = await acquireLock(walletId)
  try {
    const amount = validateAmount(amountSats)
    if (typeof quoteId !== 'string' || !quoteId || quoteId.length > 1024) throw new Error('Invalid mint quote')
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const proofs = normalizeProofs(await wallet.mintProofsBolt11(
      amount,
      quoteId,
      /^[0-9a-f]{64}$/i.test(quotePrivkey || '') ? { privkey: quotePrivkey } : undefined,
    ))
    await persistProofTransition(
      () => addProofs(walletId, proofs, password, mintUrl),
      proofs,
      mintUrl,
      walletId,
      password,
    )

    const total = proofs.reduce((s, p) => s + p.amount, 0)
    log.info('cashu', 'MINT_SUCCESS', { amount: total, mint: mintUrl })
    return { proofs, amountSats: total }
  } finally {
    release()
  }
}

// ── Send via Lightning (melt proofs → pay invoice) ──────────────

/**
 * Melt proofs to pay a bolt11 invoice.
 *
 * Proof lifecycle (matches cashu.me / nutshell reference wallets):
 *
 *   1. wallet.send()       → swaps originals at mint → {keep, send}
 *      *** original proofs are NOW SPENT at the mint ***
 *   2. Persist immediately  → remove originals, store keep + send
 *      (no valid proofs are ever only in memory)
 *   3. wallet.meltProofsBolt11()  → pay invoice with send proofs
 *   4. SUCCESS → remove send proofs, add change proofs
 *      FAILURE → send proofs stay in storage (still valid ecash)
 *
 * @returns {{ paid: boolean, preimage: string }}
 */
export async function meltTokens(mintUrl, bolt11Invoice, walletId, password, seed, context = {}) {
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const meltQuote = await wallet.createMeltQuoteBolt11(bolt11Invoice)
    const quoteAmount = validateAmount(meltQuote.amount, 'melt quote amount')
    const feeReserve = amountToNumber(meltQuote.fee_reserve || 0, 'melt fee reserve')
    const totalNeeded = quoteAmount + feeReserve

    // Check quote expiry (if provided by mint)
    if (meltQuote.expiry && meltQuote.expiry < Math.floor(Date.now() / 1000)) {
      throw new Error('Melt quote expired before payment could be attempted')
    }

    const available = validateProofs(await getAllProofs(walletId, password, mintUrl))
    const balance = available.reduce((s, p) => s + p.amount, 0)
    if (balance < totalNeeded) {
      const error = new Error(`Insufficient balance at this mint: need ${totalNeeded}, have ${balance}`)
      error.code = 'CASHU_MINT_BALANCE'
      throw error
    }

    // Step 1: Swap with mint — originals are SPENT after this returns
    const split = await wallet.send(totalNeeded, available)
    const keep = normalizeProofs(split.keep)
    const send = normalizeProofs(split.send)

    // Step 2: Persist immediately — keep + send replace originals
    // No valid proofs should ever exist only in memory
    const originalSecrets = available.map(p => p.secret)
    await persistProofTransition(
      () => swapProofs(walletId, originalSecrets, [...keep, ...send], password, mintUrl),
      [...keep, ...send],
      mintUrl,
      walletId,
      password,
    )

    // Step 3: Prepare and durably journal the exact change outputs before the
    // mint can consume inputs. This makes a timeout or browser restart safe.
    const preview = await wallet.prepareMelt('bolt11', meltQuote, send)
    await saveCashuMeltJournal(walletId, password, {
      mint: mintUrl,
      quoteId: meltQuote.quote,
      inputSecrets: send.map(proof => proof.secret),
      outputData: preview.outputData.map(output => OutputData.serialize(output)),
      amountSats: quoteAmount,
      inputTotal: send.reduce((sum, proof) => sum + proof.amount, 0),
      transactionId: context.transactionId || '',
    })

    // Step 4: Attempt the melt with the journalled request.
    let result
    try {
      result = await wallet.completeMelt(preview)
    } catch (meltErr) {
      try {
        const status = await wallet.checkMeltQuoteBolt11(meltQuote.quote)
        if (status.state === 'PAID') {
          result = {
            quote: status,
            change: wallet.createMeltChangeProofs(preview.outputData, status.change || []),
          }
        } else if (status.state === 'UNPAID') {
          await clearCashuMeltJournal(walletId)
          throw meltErr
        }
      } catch (statusError) {
        if (statusError === meltErr) throw statusError
      }
      if (!result) {
        const pendingError = new Error('Cashu payment result is still pending at the mint')
        pendingError.code = 'CASHU_PAYMENT_PENDING'
        throw pendingError
      }
    }

    // meltProofsBolt11() returns { quote: MeltQuoteBolt11Response, change: Proof[] }.
    // The paid flag and preimage live on result.quote, NOT on the top-level result.
    const paid = result.quote?.state === 'PAID'

    if (!paid) {
      if (result.quote?.state === 'UNPAID') await clearCashuMeltJournal(walletId)
      log.warn('cashu', 'MELT_NOT_PAID', { amount: meltQuote.amount })
      const error = new Error('Payment was not completed by the mint')
      if (result.quote?.state === 'PENDING') error.code = 'CASHU_PAYMENT_PENDING'
      throw error
    }

    // Step 5: Success. Remove spent inputs, add change, then clear the journal.
    const sendSecrets = send.map(p => p.secret)
    const changeProofs = result.change?.length > 0 ? normalizeProofs(result.change) : []
    const inputTotal = send.reduce((sum, proof) => sum + proof.amount, 0)
    const changeTotal = changeProofs.reduce((sum, proof) => sum + proof.amount, 0)
    const feeSats = Math.max(0, inputTotal - changeTotal - quoteAmount)
    if (changeProofs.length > 0) {
      await persistProofTransition(
        () => swapProofs(walletId, sendSecrets, changeProofs, password, mintUrl),
        [...keep, ...changeProofs],
        mintUrl,
        walletId,
        password,
      )
    } else {
      await persistProofTransition(
        () => removeProofs(walletId, sendSecrets, password),
        keep,
        mintUrl,
        walletId,
        password,
      )
    }
    await clearCashuMeltJournal(walletId)

    log.info('cashu', 'MELT_SUCCESS', { amount: meltQuote.amount, fee: meltQuote.fee_reserve, paid })

    return {
      paid,
      preimage: result.quote?.payment_preimage || '',
      payment_hash: '',
      feeSats,
    }
  } finally {
    release()
  }
}

/** Resolve a payment left in the durable melt journal after a timeout or restart. */
export async function resolvePendingCashuMelt(walletId, password, seed) {
  const pending = await readCashuMeltJournal(walletId, password)
  if (!pending) return { pending: false, resolved: false }
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(pending.mint, { walletId, password, seed })
    const status = await wallet.checkMeltQuoteBolt11(pending.quoteId)
    if (status.state === 'PENDING') return { pending: true, resolved: false, transactionId: pending.transactionId }
    if (status.state === 'UNPAID') {
      const inputSecretSet = new Set(pending.inputSecrets)
      const inputs = (await getAllProofs(walletId, password, pending.mint))
        .filter(proof => inputSecretSet.has(proof.secret))
      if (inputs.length !== pending.inputSecrets.length) {
        return { pending: true, resolved: false, transactionId: pending.transactionId }
      }
      const proofStates = await wallet.groupProofsByState(inputs)
      if ((proofStates.pending?.length || 0) > 0 || (proofStates.spent?.length || 0) > 0) {
        return { pending: true, resolved: false, transactionId: pending.transactionId }
      }
      await clearCashuMeltJournal(walletId)
      return { pending: false, resolved: true, paid: false, transactionId: pending.transactionId }
    }
    if (status.state !== 'PAID') return { pending: true, resolved: false, transactionId: pending.transactionId }

    const outputData = pending.outputData.map(output => OutputData.deserialize(output))
    const change = normalizeProofs(wallet.createMeltChangeProofs(outputData, status.change || []))
    if (change.length > 0) {
      await persistProofTransition(
        () => swapProofs(walletId, pending.inputSecrets, change, password, pending.mint),
        change,
        pending.mint,
        walletId,
        password,
      )
    } else {
      await persistProofTransition(
        () => removeProofs(walletId, pending.inputSecrets, password),
        [],
        pending.mint,
        walletId,
        password,
      )
    }
    await clearCashuMeltJournal(walletId)
    const changeTotal = change.reduce((sum, proof) => sum + proof.amount, 0)
    return {
      pending: false,
      resolved: true,
      paid: true,
      mint: pending.mint,
      transactionId: pending.transactionId,
      feeSats: Math.max(0, pending.inputTotal - changeTotal - pending.amountSats),
      preimage: status.payment_preimage || '',
    }
  } finally {
    release()
  }
}

// ── Ecash token send (create cashuB... string) ──────────────────

/**
 * Create a cashu token string for the given amount.
 *
 * Proof lifecycle (same as meltTokens):
 *   1. wallet.send()       → swap originals at mint → {keep, send}
 *   2. Persist immediately  → remove originals, store keep (send goes to token)
 *   3. Encode token from send proofs
 *
 * Note: wallet.send() already spent the originals at the mint, so we MUST
 * persist keep proofs immediately. The send proofs leave our wallet as the token.
 *
 * @param {{ includeFees?: boolean }} [options] - includeFees makes the sender
 *   cover the receiver's future swap fee (NUT-18 payment requests need this
 *   so the receiver nets the requested amount).
 * @returns {{ token: string, amountSats: number }}
 */
export async function createEcashToken(mintUrl, amountSats, walletId, password, memo, seed, options = {}) {
  const release = await acquireLock(walletId)
  try {
    const amount = validateAmount(amountSats)
    if (typeof memo === 'string' && memo.length > 500) throw new Error('Cashu token memo is too long')
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const available = validateProofs(await getAllProofs(walletId, password, mintUrl))
    const balance = available.reduce((s, p) => s + p.amount, 0)
    if (balance < amount) {
      const error = new Error(`Insufficient balance at this mint: need ${amount}, have ${balance}`)
      error.code = 'CASHU_MINT_BALANCE'
      throw error
    }

    // Step 1: Swap with mint — originals SPENT after this
    const split = await wallet.send(amount, available, options.includeFees ? { includeFees: true } : undefined)
    const keep = normalizeProofs(split.keep)
    const send = normalizeProofs(split.send)

    // Step 2: Persist every new proof before encoding. If the extension stops
    // here, the send proofs are still recoverable inside the wallet.
    const originalSecrets = available.map(p => p.secret)
    await persistProofTransition(
      () => swapProofs(walletId, originalSecrets, [...keep, ...send], password, mintUrl),
      [...keep, ...send],
      mintUrl,
      walletId,
      password,
    )

    // Step 3: Encode the token. If local encoding fails, keep and send proofs
    // remain in the wallet because the token was never returned to the user.
    const token = getEncodedToken({
      mint: mintUrl,
      unit: 'sat',
      proofs: send,
      memo: memo || undefined,
    })

    // Only remove the outgoing proofs after token encoding succeeded.
    await persistProofTransition(
      () => removeProofs(walletId, send.map(proof => proof.secret), password),
      // The token is returned only after this write succeeds. If storage is
      // uncertain, recover both sets so value that was never handed out stays
      // available to this wallet.
      [...keep, ...send],
      mintUrl,
      walletId,
      password,
    )

    const total = send.reduce((s, p) => s + p.amount, 0)
    log.info('cashu', 'TOKEN_CREATED', { amount: total })
    return { token, amountSats: total }
  } finally {
    release()
  }
}

// ── Ecash token receive (redeem a cashu token string) ───────────

/**
 * Receive a cashu token — decode, swap for fresh proofs, store.
 *
 * SAFETY: If addProofs fails after wallet.receive succeeds, we retry
 * storage up to 2 times before throwing with the proofs attached
 * so the caller can attempt recovery.
 *
 * @returns {{ amountSats: number, mint: string }}
 */
export async function receiveEcashToken(tokenStr, walletId, password, seed, receivePrivkey) {
  if (typeof tokenStr !== 'string' || tokenStr.length < 16 || tokenStr.length > 1_000_000) {
    throw new Error('Invalid Cashu token')
  }
  // Metadata decoding does not need keyset data. The wallet performs the full
  // proof decode only after it has loaded the mint's complete keyset list.
  const metadata = getTokenMetadata(tokenStr)
  const mintUrl = metadata.mint
  if (!mintUrl) throw new Error('Token has no mint URL')
  if ((metadata.unit || 'sat') !== 'sat') throw new Error('Only sat-denominated Cashu tokens are supported')
  validateAmount(metadata.amount, 'token amount')

  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const proofs = normalizeProofs(await wallet.receive(
      tokenStr,
      /^[0-9a-f]{64}$/i.test(receivePrivkey || '') ? { privkey: receivePrivkey } : undefined,
    ))
    await persistProofTransition(
      () => addProofs(walletId, proofs, password, mintUrl),
      proofs,
      mintUrl,
      walletId,
      password,
    )

    const total = proofs.reduce((s, p) => s + p.amount, 0)
    log.info('cashu', 'TOKEN_RECEIVED', { amount: total, mint: mintUrl })
    return { amountSats: total, mint: mintUrl }
  } finally {
    release()
  }
}

/**
 * Validate and rotate proofs loaded from a file or relay before counting them.
 * Unknown proofs are swapped at their mint, which rejects spent or forged data.
 */
export async function recoverExternalProofs(mintUrl, candidateProofs, walletId, password, seed, receivePrivkey) {
  const release = await acquireLock(walletId)
  try {
    const candidates = validateProofs(candidateProofs)
    const existing = await getAllProofs(walletId, password, mintUrl)
    const knownSecrets = new Set(existing.map(proof => proof.secret))
    const unknown = candidates.filter(proof => !knownSecrets.has(proof.secret))
    if (unknown.length === 0) return { amountSats: 0, proofs: 0, mint: mintUrl }

    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const states = await wallet.groupProofsByState(unknown)
    const unspent = normalizeProofs(states.unspent || [])
    if (unspent.length === 0) return { amountSats: 0, proofs: 0, mint: mintUrl }

    // Rotate imported proofs before storing them. This verifies mint signatures,
    // prevents a copied backup from being counted twice, and breaks the link to
    // the old proof secrets.
    const refreshed = normalizeProofs(await wallet.receive(
      unspent,
      /^[0-9a-f]{64}$/i.test(receivePrivkey || '') ? { privkey: receivePrivkey } : undefined,
    ))
    await persistProofTransition(
      () => addProofs(walletId, refreshed, password, mintUrl),
      refreshed,
      mintUrl,
      walletId,
      password,
    )
    return {
      amountSats: refreshed.reduce((sum, proof) => sum + proof.amount, 0),
      proofs: refreshed.length,
      mint: mintUrl,
    }
  } finally {
    release()
  }
}

/** Remove mint-confirmed spent proofs while retaining pending and unspent ones. */
export async function reconcileCashuMintProofs(mintUrl, walletId, password, seed) {
  const release = await acquireLock(walletId)
  try {
    const existing = validateProofs(await getAllProofs(walletId, password, mintUrl))
    if (existing.length === 0) return { removed: 0, pending: 0 }
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const states = await wallet.groupProofsByState(existing)
    const spentSecrets = (states.spent || []).map(proof => proof.secret)
    if (spentSecrets.length > 0) await removeProofs(walletId, spentSecrets, password)
    return { removed: spentSecrets.length, pending: (states.pending || []).length }
  } finally {
    release()
  }
}

// ── Utility ─────────────────────────────────────────────────────

/**
 * Get mint info (name, description, supported features).
 */
export async function getMintInfo(mintUrl) {
  const wallet = await getWallet(mintUrl)
  const info = await wallet.getMintInfo()
  const cleanText = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
  const nuts = info?.nuts && typeof info.nuts === 'object'
    ? Object.fromEntries(Object.entries(info.nuts).slice(0, 100).map(([key, value]) => [
      String(key).slice(0, 16),
      value && typeof value === 'object' ? value : {},
    ]))
    : {}
  return {
    name: cleanText(info?.name, 200),
    description: cleanText(info?.description, 1_000),
    description_long: cleanText(info?.description_long, 5_000),
    version: cleanText(info?.version, 100),
    contact: Array.isArray(info?.contact) ? info.contact.slice(0, 20).map(contact => ({
      method: cleanText(contact?.method, 50),
      info: cleanText(contact?.info, 500),
    })) : [],
    nuts,
  }
}

/** Restore NUT-13 deterministic proofs and retain only mint-confirmed unspent outputs. */
export async function restoreDeterministicProofs(mintUrl, walletId, password, seed) {
  if (!(seed instanceof Uint8Array) || seed.length === 0) throw new Error('Recovery-word identity required')
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl, { walletId, password, seed })
    const counterSource = createCashuCounterSource(walletId, password, mintUrl)
    const restored = []
    const seenSecrets = new Set()

    // Recovery must scan inactive keysets too. Mints rotate keysets over time,
    // and limiting recovery to today's active keyset can hide older funds.
    for (const keyset of wallet.keyChain.getKeysets()) {
      try {
        await wallet.keyChain.ensureKeysetKeys(keyset.id)
        const result = await wallet.batchRestore(300, 300, 0, keyset.id)
        for (const proof of normalizeProofs(result.proofs)) {
          if (seenSecrets.has(proof.secret)) continue
          seenSecrets.add(proof.secret)
          restored.push(proof)
        }
        if (Number.isSafeInteger(result.lastCounterWithSignature)) {
          await counterSource.advanceToAtLeast(keyset.id, result.lastCounterWithSignature + 1)
        }
      } catch (error) {
        log.warn('cashu', 'KEYSET_RESTORE_SKIPPED', { keysetId: keyset.id, err: error?.message })
      }
    }
    if (restored.length === 0) return { amountSats: 0, proofs: 0, mint: mintUrl }
    const states = await wallet.checkProofsStates(restored)
    const unspent = restored.filter((_, index) => states[index]?.state === CheckStateEnum.UNSPENT)
    await addProofs(walletId, unspent, password, mintUrl)
    return {
      amountSats: unspent.reduce((sum, proof) => sum + proof.amount, 0),
      proofs: unspent.length,
      mint: mintUrl,
    }
  } finally {
    release()
  }
}

/** Recover proofs held in the encrypted emergency journal after a storage failure. */
export async function recoverPendingCashuProofs(walletId, password, seed, receivePrivkey) {
  const pending = await readCashuRecovery(walletId, password)
    || volatileRecoveryJournals.get(walletId)
  if (!pending) return { recovered: false, amountSats: 0, proofs: 0 }
  const result = await recoverExternalProofs(
    pending.mint,
    pending.proofs,
    walletId,
    password,
    seed,
    receivePrivkey,
  )
  await reconcileCashuMintProofs(pending.mint, walletId, password, seed)
  await clearCashuRecovery(walletId)
  volatileRecoveryJournals.delete(walletId)
  return { recovered: true, ...result }
}

export function hasVolatileCashuRecovery(walletId) {
  return volatileRecoveryJournals.has(walletId)
}

/**
 * Tear down all cached clients. Called on account switch or wallet disconnect.
 */
export function teardownCashu() {
  for (const { wallet } of walletClients.values()) {
    try { wallet.mint?.disconnectWebSocket?.() } catch { /* best-effort cleanup */ }
  }
  walletClients.clear()
  walletInitPromises.clear()
  // NOTE: walletLocks is intentionally NOT cleared. The per-wallet mutex chains
  // in-flight proof mutations; clearing it mid-flight would let a concurrent op
  // acquire a fresh lock and run unserialized against the same proof store
  // (a double-spend window). The chained promises are tiny and self-resolve.
}
