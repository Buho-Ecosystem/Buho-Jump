/**
 * Encrypted local transaction history for Cashu wallets.
 *
 * Each wallet is isolated under cashuTxHistory_{walletId}. History uses the
 * same NWC-compatible shape as the rest of the transaction UI. Legacy
 * plaintext arrays are migrated after the first successful authenticated read.
 */

import { decryptData, encryptData, encryptionNeedsUpgrade } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'

const MAX_HISTORY = 200

function storageKey(walletId) {
  return `cashuTxHistory_${walletId}`
}

async function writeHistory(walletId, history, password) {
  if (!walletId || !password) throw new Error('Password and walletId required')
  const encrypted = await encryptData(history.slice(0, MAX_HISTORY), password)
  await verifiedSet(storageKey(walletId), { encrypted })
}

async function loadHistory(walletId, password) {
  if (!walletId || !password) return []
  const key = storageKey(walletId)
  const data = await chrome.storage.local.get(key)
  const stored = data[key]
  if (!stored) return []

  if (stored?.encrypted) {
    try {
      const history = await decryptData(stored.encrypted, password)
      if (!Array.isArray(history)) throw new Error('Invalid transaction history shape')
      if (encryptionNeedsUpgrade(stored.encrypted)) await writeHistory(walletId, history, password)
      return history
    } catch (error) {
      throw vaultIntegrityError('Cashu transaction history', error)
    }
  }

  if (Array.isArray(stored)) {
    await writeHistory(walletId, stored, password)
    return stored
  }

  throw vaultIntegrityError('Cashu transaction history', new Error('Invalid stored format'))
}

export async function recordCashuTx(walletId, { direction, amount, description, state, paymentHash: suppliedPaymentHash }, password) {
  if (!['in', 'out'].includes(direction)
    || !Number.isSafeInteger(amount) || amount <= 0
    || amount > Math.floor(Number.MAX_SAFE_INTEGER / 1000)
    || typeof description !== 'undefined' && typeof description !== 'string'
    || typeof description === 'string' && description.length > 500
    || typeof suppliedPaymentHash !== 'undefined'
      && (typeof suppliedPaymentHash !== 'string' || suppliedPaymentHash.length > 256)
    || typeof state !== 'undefined' && !['pending', 'settled', 'failed'].includes(state)) {
    throw new Error('Invalid Cashu transaction')
  }
  const history = await loadHistory(walletId, password)
  const paymentHash = suppliedPaymentHash || crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  const transaction = {
    type: direction === 'in' ? 'incoming' : 'outgoing',
    amount: amount * 1000,
    description: description || '',
    created_at: now,
    settled_at: state === 'settled' ? now : 0,
    state: state || 'settled',
    payment_hash: paymentHash,
  }

  // Lightning payment hashes are idempotency keys. Retrying the same invoice
  // updates its existing pending entry instead of creating duplicate history.
  const existingIndex = suppliedPaymentHash
    ? history.findIndex(item => item.payment_hash === suppliedPaymentHash)
    : -1
  if (existingIndex >= 0) {
    const [existing] = history.splice(existingIndex, 1)
    history.unshift({ ...existing, ...transaction, created_at: existing.created_at || now })
  } else {
    history.unshift(transaction)
  }

  await writeHistory(walletId, history, password)
  return paymentHash
}

export async function updateCashuTx(walletId, paymentHash, updates, password) {
  const history = await loadHistory(walletId, password)
  const tx = history.find(item => item.payment_hash === paymentHash)
  if (!tx) return
  if (updates.state) {
    tx.state = updates.state
    if (updates.state === 'settled') tx.settled_at = Math.floor(Date.now() / 1000)
  }
  if (updates.description) tx.description = updates.description
  if (Number.isSafeInteger(updates.feesPaid) && updates.feesPaid >= 0) {
    tx.fees_paid = updates.feesPaid * 1000
  }
  await writeHistory(walletId, history, password)
}

export async function getCashuTransactions(walletId, { limit = 20, offset = 0 } = {}, password) {
  const history = await loadHistory(walletId, password)
  return { transactions: history.slice(offset, offset + limit) }
}

export async function getCashuTx(walletId, paymentHash, password) {
  if (typeof paymentHash !== 'string' || !paymentHash || paymentHash.length > 256) return null
  return (await loadHistory(walletId, password))
    .find(item => item.payment_hash === paymentHash) || null
}

export async function reEncryptCashuTxHistory(walletId, oldPassword, newPassword) {
  const history = await loadHistory(walletId, oldPassword)
  if (history.length > 0) await writeHistory(walletId, history, newPassword)
  else await clearCashuTxHistory(walletId)
}

export async function clearCashuTxHistory(walletId) {
  await chrome.storage.local.remove(storageKey(walletId))
}
