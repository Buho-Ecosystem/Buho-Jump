/**
 * Core Cashu engine — mint interactions, proof management, token encode/decode.
 *
 * All mint API calls go through @cashu/cashu-ts. Proof storage is delegated
 * to cashu-store.js. This module is imported ONLY in background.js.
 */

import { Wallet, getEncodedTokenV4, getDecodedToken } from '@cashu/cashu-ts'
import { addProofs, swapProofs, getAllProofs } from './cashu-store.js'
import { log } from './logger.js'

// ── Wallet client cache (singleton per mint URL) ────────────────

const walletClients = new Map()
const walletInitPromises = new Map()

async function getWallet(mintUrl) {
  if (walletClients.has(mintUrl)) return walletClients.get(mintUrl)
  // Prevent duplicate init from concurrent calls
  if (!walletInitPromises.has(mintUrl)) {
    const promise = (async () => {
      const wallet = new Wallet(mintUrl)
      walletClients.set(mintUrl, wallet)
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
 * @returns {{ proofs: CashuProof[], amountSats: number }}
 */
export async function mintTokens(mintUrl, amountSats, quoteId, walletId, password) {
  const wallet = await getWallet(mintUrl)
  const proofs = await wallet.mintProofs(amountSats, quoteId)
  await addProofs(walletId, proofs, password)
  const total = proofs.reduce((s, p) => s + p.amount, 0)
  log.info('cashu', 'MINT_SUCCESS', { amount: total, mint: mintUrl })
  return { proofs, amountSats: total }
}

// ── Send via Lightning (melt proofs → pay invoice) ──────────────

/**
 * Create a melt quote — how much to pay this invoice?
 * @returns {{ quote: string, amount: number, fee: number }}
 */
export async function createMeltQuote(mintUrl, bolt11Invoice) {
  const wallet = await getWallet(mintUrl)
  const quote = await wallet.createMeltQuote(bolt11Invoice)
  return {
    quote: quote.quote,
    amount: quote.amount,
    fee: quote.fee_reserve,
  }
}

/**
 * Melt proofs to pay a bolt11 invoice.
 * Selects proofs, executes melt, returns change proofs.
 * @returns {{ paid: boolean, preimage: string }}
 */
export async function meltTokens(mintUrl, bolt11Invoice, walletId, password) {
  const wallet = await getWallet(mintUrl)
  const meltQuote = await wallet.createMeltQuoteBolt11(bolt11Invoice)
  const totalNeeded = meltQuote.amount + (meltQuote.fee_reserve || 0)

  const available = await getAllProofs(walletId, password)
  validateProofs(available)
  const balance = available.reduce((s, p) => s + p.amount, 0)
  if (balance < totalNeeded) {
    throw new Error(`Insufficient balance: need ${totalNeeded}, have ${balance}`)
  }

  // Select proofs to send and keep
  const { keep, send } = await wallet.send(totalNeeded, available)

  // Replace all proofs with keep proofs (remove originals, add keep)
  const originalSecrets = available.map(p => p.secret)
  await swapProofs(walletId, originalSecrets, keep, password)

  // Execute melt
  const result = await wallet.meltProofs(meltQuote, send)

  // Add any change proofs back
  if (result.change?.length > 0) {
    await addProofs(walletId, result.change, password)
  }

  const paid = result.isPaid !== undefined ? result.isPaid : !!result.paid
  log.info('cashu', 'MELT_SUCCESS', { amount: meltQuote.amount, fee: meltQuote.fee_reserve, paid })

  return {
    paid,
    preimage: result.preimage || '',
    payment_hash: '',
  }
}

// ── Ecash token send (create cashuA... string) ──────────────────

/**
 * Create a cashu token string for the given amount.
 * @returns {{ token: string, amountSats: number }}
 */
export async function createEcashToken(mintUrl, amountSats, walletId, password, memo) {
  const wallet = await getWallet(mintUrl)
  const available = await getAllProofs(walletId, password)
  validateProofs(available)
  const balance = available.reduce((s, p) => s + p.amount, 0)
  if (balance < amountSats) {
    throw new Error(`Insufficient balance: need ${amountSats}, have ${balance}`)
  }

  const { keep, send } = await wallet.send(amountSats, available)

  // Replace all proofs with keep proofs
  const originalSecrets = available.map(p => p.secret)
  await swapProofs(walletId, originalSecrets, keep, password)

  const token = getEncodedTokenV4({
    mint: mintUrl,
    proofs: send,
    memo: memo || undefined,
  })

  const total = send.reduce((s, p) => s + p.amount, 0)
  log.info('cashu', 'TOKEN_CREATED', { amount: total })
  return { token, amountSats: total }
}

// ── Ecash token receive (redeem cashuA... string) ───────────────

/**
 * Receive a cashu token — decode, swap for fresh proofs, store.
 * @returns {{ amountSats: number, mint: string }}
 */
export async function receiveEcashToken(tokenStr, walletId, password) {
  const decoded = getDecodedToken(tokenStr)
  const mintUrl = decoded.mint || decoded.token?.[0]?.mint
  if (!mintUrl) throw new Error('Token has no mint URL')

  const wallet = await getWallet(mintUrl)
  const proofs = await wallet.receive(tokenStr)
  await addProofs(walletId, proofs, password)

  const total = proofs.reduce((s, p) => s + p.amount, 0)
  log.info('cashu', 'TOKEN_RECEIVED', { amount: total, mint: mintUrl })
  return { amountSats: total, mint: mintUrl }
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
}
