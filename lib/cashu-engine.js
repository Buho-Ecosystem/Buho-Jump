/**
 * Core Cashu engine — mint interactions, proof management, token encode/decode.
 *
 * All mint API calls go through @cashu/cashu-ts. Proof storage is delegated
 * to cashu-store.js. This module is imported ONLY in background.js.
 */

import { Wallet, getEncodedToken, getDecodedToken } from '@cashu/cashu-ts'
import { addProofs, removeProofs, swapProofs, getAllProofs } from './cashu-store.js'
import { log } from './logger.js'

// ── Wallet-level mutex (serialize proof-mutating ops per wallet) ─

const walletLocks = new Map()

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
const walletClients = new Map()   // mintUrl → { wallet, createdAt }
const walletInitPromises = new Map()

async function getWallet(mintUrl) {
  const cached = walletClients.get(mintUrl)
  if (cached && (Date.now() - cached.createdAt) < WALLET_TTL_MS) {
    return cached.wallet
  }
  // Stale or missing — evict and re-create
  if (cached) {
    walletClients.delete(mintUrl)
    walletInitPromises.delete(mintUrl)
  }
  if (!walletInitPromises.has(mintUrl)) {
    const promise = (async () => {
      const wallet = new Wallet(mintUrl, { unit: 'sat' })
      await wallet.loadMint()
      walletClients.set(mintUrl, { wallet, createdAt: Date.now() })
      return wallet
    })()
    walletInitPromises.set(mintUrl, promise)
  }
  return walletInitPromises.get(mintUrl)
}

function validateProofs(proofs) {
  if (!Array.isArray(proofs)) throw new Error('Invalid proof data')
  for (const p of proofs) {
    if (typeof p.amount !== 'number' || !p.secret || !p.C) {
      throw new Error('Corrupted proof detected in wallet')
    }
  }
}

// ── Receive via Lightning (mint quote → invoice → poll → proofs) ─

/**
 * Create a mint quote — returns an invoice the sender pays.
 * @returns {{ quote: string, request: string, expiry: number }}
 */
export async function createMintQuote(mintUrl, amountSats) {
  const wallet = await getWallet(mintUrl)
  const quote = await wallet.createMintQuoteBolt11(amountSats)
  return {
    quote: quote.quote,
    request: quote.request,
    expiry: quote.expiry || 0,
  }
}

/**
 * Check mint quote status — has the invoice been paid?
 * @returns {{ paid: boolean, state: string }}
 */
export async function checkMintQuote(mintUrl, quoteId) {
  const wallet = await getWallet(mintUrl)
  const status = await wallet.checkMintQuoteBolt11(quoteId)
  const paid = status.state === 'PAID' || status.paid === true
  return { paid, state: status.state || (paid ? 'PAID' : 'UNPAID') }
}

/**
 * Mint tokens after invoice is paid. Stores proofs locally.
 * Mutex-protected + retry on storage failure (same as receiveEcashToken).
 * @returns {{ proofs: CashuProof[], amountSats: number }}
 */
export async function mintTokens(mintUrl, amountSats, quoteId, walletId, password) {
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl)
    const proofs = await wallet.mintProofsBolt11(amountSats, quoteId)

    let stored = false
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await addProofs(walletId, proofs, password)
        stored = true
        break
      } catch (err) {
        lastErr = err
        log.warn('cashu', 'MINT_STORE_RETRY', { attempt, err: err?.message })
      }
    }
    if (!stored) {
      const err = new Error(`Failed to store minted proofs: ${lastErr?.message}`)
      err.recoveryProofs = proofs
      err.mintUrl = mintUrl
      throw err
    }

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
export async function meltTokens(mintUrl, bolt11Invoice, walletId, password) {
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl)
    const meltQuote = await wallet.createMeltQuoteBolt11(bolt11Invoice)
    const totalNeeded = meltQuote.amount + (meltQuote.fee_reserve || 0)

    // Check quote expiry (if provided by mint)
    if (meltQuote.expiry && meltQuote.expiry < Math.floor(Date.now() / 1000)) {
      throw new Error('Melt quote expired before payment could be attempted')
    }

    const available = await getAllProofs(walletId, password)
    validateProofs(available)
    const balance = available.reduce((s, p) => s + p.amount, 0)
    if (balance < totalNeeded) {
      throw new Error(`Insufficient balance: need ${totalNeeded}, have ${balance}`)
    }

    // Step 1: Swap with mint — originals are SPENT after this returns
    const { keep, send } = await wallet.send(totalNeeded, available)

    // Step 2: Persist immediately — keep + send replace originals
    // No valid proofs should ever exist only in memory
    const originalSecrets = available.map(p => p.secret)
    await swapProofs(walletId, originalSecrets, [...keep, ...send], password)

    // Step 3: Attempt melt with the send proofs
    let result
    try {
      result = await wallet.meltProofsBolt11(meltQuote, send)
    } catch (meltErr) {
      // Melt failed — send proofs are still valid ecash, safe in storage
      log.warn('cashu', 'MELT_FAILED_PROOFS_SAFE', {
        amount: meltQuote.amount,
        sendProofs: send.length,
        err: meltErr?.message,
      })
      throw meltErr
    }

    // meltProofsBolt11() returns { quote: MeltQuoteBolt11Response, change: Proof[] }.
    // The paid flag and preimage live on result.quote, NOT on the top-level result.
    const paid = result.quote?.state === 'PAID'

    if (!paid) {
      // Mint accepted request but didn't pay — send proofs still in storage
      log.warn('cashu', 'MELT_NOT_PAID', { amount: meltQuote.amount })
      throw new Error('Payment was not completed by the mint')
    }

    // Step 4: Success — remove send proofs, add any change proofs
    const sendSecrets = send.map(p => p.secret)
    const changeProofs = result.change?.length > 0 ? result.change : []
    if (changeProofs.length > 0) {
      await swapProofs(walletId, sendSecrets, changeProofs, password)
    } else {
      await removeProofs(walletId, sendSecrets, password)
    }

    log.info('cashu', 'MELT_SUCCESS', { amount: meltQuote.amount, fee: meltQuote.fee_reserve, paid })

    return {
      paid,
      preimage: result.quote?.payment_preimage || '',
      payment_hash: '',
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
 * @returns {{ token: string, amountSats: number }}
 */
export async function createEcashToken(mintUrl, amountSats, walletId, password, memo) {
  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl)
    const available = await getAllProofs(walletId, password)
    validateProofs(available)
    const balance = available.reduce((s, p) => s + p.amount, 0)
    if (balance < amountSats) {
      throw new Error(`Insufficient balance: need ${amountSats}, have ${balance}`)
    }

    // Step 1: Swap with mint — originals SPENT after this
    const { keep, send } = await wallet.send(amountSats, available)

    // Step 2: Persist keep proofs immediately (send proofs leave as the token)
    const originalSecrets = available.map(p => p.secret)
    await swapProofs(walletId, originalSecrets, keep, password)

    // Step 3: Encode the token (if this fails, keep proofs are safe,
    // send proofs are lost — but encoding is local and won't fail in practice)
    const token = getEncodedToken({
      mint: mintUrl,
      unit: 'sat',
      proofs: send,
      memo: memo || undefined,
    })

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
export async function receiveEcashToken(tokenStr, walletId, password) {
  // keysetIds can be empty here — we only need the mint URL; wallet.receive()
  // re-decodes the token string with the mint's loaded keysets.
  const decoded = getDecodedToken(tokenStr, [])
  const mintUrl = decoded.mint
  if (!mintUrl) throw new Error('Token has no mint URL')

  const release = await acquireLock(walletId)
  try {
    const wallet = await getWallet(mintUrl)
    const proofs = await wallet.receive(tokenStr)

    // Retry addProofs — losing proofs after mint accepted them means sats loss
    let stored = false
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await addProofs(walletId, proofs, password)
        stored = true
        break
      } catch (err) {
        lastErr = err
        log.warn('cashu', 'ADD_PROOFS_RETRY', { attempt, err: err?.message })
      }
    }
    if (!stored) {
      const err = new Error(`Failed to store received proofs after 3 attempts: ${lastErr?.message}`)
      err.recoveryProofs = proofs
      err.mintUrl = mintUrl
      throw err
    }

    const total = proofs.reduce((s, p) => s + p.amount, 0)
    log.info('cashu', 'TOKEN_RECEIVED', { amount: total, mint: mintUrl })
    return { amountSats: total, mint: mintUrl }
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
  return await wallet.getMintInfo()
}

/**
 * Tear down all cached clients. Called on account switch or wallet disconnect.
 */
export function teardownCashu() {
  walletClients.clear()
  walletInitPromises.clear()
  // NOTE: walletLocks is intentionally NOT cleared. The per-wallet mutex chains
  // in-flight proof mutations; clearing it mid-flight would let a concurrent op
  // acquire a fresh lock and run unserialized against the same proof store
  // (a double-spend window). The chained promises are tiny and self-resolve.
}
