/**
 * Encrypted, account- and wallet-scoped transaction metadata.
 *
 * Wallet providers return the payment itself, but product features such as
 * LUD-09 messages, LUD-21 delivery receipts, Branta verification, and personal
 * notes are local wallet context. Keeping that context in one encrypted store
 * lets the popup and full-page activity views render the same information
 * without leaking metadata between accounts or wallets.
 */

import { encryptData, decryptData, encryptionNeedsUpgrade } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'

const STORAGE_KEY = 'transactionMetadata'
const MAX_RECORDS_PER_WALLET = 500

function emptyStore() {
  return { version: 1, accounts: {} }
}

function cleanText(value, max = 500) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : ''
}

function cleanHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function cleanSuccessAction(action) {
  if (!action || typeof action !== 'object') return null
  if (action.tag === 'message') {
    const message = cleanText(action.message, 144)
    return message ? { tag: 'message', message } : null
  }
  if (action.tag === 'url') {
    const url = cleanHttpsUrl(action.url)
    if (!url) return null
    return { tag: 'url', description: cleanText(action.description, 144), url }
  }
  if (action.tag === 'aes') {
    return {
      tag: 'aes',
      description: cleanText(action.description, 144),
      secret: cleanText(action.secret, 4096) || null,
      decryptError: action.decryptError === true,
    }
  }
  return null
}

function cleanDeliveryStatus(status) {
  if (!status || typeof status !== 'object') return null
  return {
    hasPayout: status.hasPayout === true,
    settled: status.settled === true,
    delivered: status.delivered === true,
    receipt: cleanText(status.receipt, 200) || null,
    recipient: cleanText(status.recipient, 200) || null,
    amount: Number.isFinite(status.amount) ? status.amount : null,
    completedAt: cleanText(status.completedAt, 100) || null,
  }
}

function cleanMerchantVerification(value) {
  if (!value || typeof value !== 'object') return null
  const result = {
    name: cleanText(value.name, 200),
    logoUrl: cleanHttpsUrl(value.logoUrl),
    logoLightUrl: cleanHttpsUrl(value.logoLightUrl),
    description: cleanText(value.description, 500),
    verifyUrl: cleanHttpsUrl(value.verifyUrl),
  }
  return Object.values(result).some(Boolean) ? result : null
}

function cleanPayout(value) {
  if (!value || typeof value !== 'object') return null
  const code = cleanText(value.code, 8).toUpperCase()
  const amount = Number(value.amount)
  if (!/^[A-Z]{3,8}$/.test(code) || !Number.isFinite(amount) || amount <= 0) return null
  return { code, amount }
}

function cleanFiatSnapshot(value) {
  if (!value || typeof value !== 'object') return null
  const code = cleanText(value.code, 8).toUpperCase()
  const amount = Number(value.amount)
  const rate = Number(value.rate)
  if (!/^[A-Z]{3,8}$/.test(code) || !Number.isFinite(amount) || amount < 0) return null
  return {
    code,
    amount,
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    capturedAt: Number.isFinite(value.capturedAt) ? value.capturedAt : Date.now(),
  }
}

/** Only persist fields the transaction UI understands. */
export function sanitizeTransactionMetadata(value) {
  if (!value || typeof value !== 'object') return {}
  const result = {}
  if ('successAction' in value) result.successAction = cleanSuccessAction(value.successAction)
  if ('verifyUrl' in value) result.verifyUrl = cleanHttpsUrl(value.verifyUrl) || null
  if ('deliveryStatus' in value) result.deliveryStatus = cleanDeliveryStatus(value.deliveryStatus)
  if ('merchantVerification' in value) result.merchantVerification = cleanMerchantVerification(value.merchantVerification)
  if ('payout' in value) result.payout = cleanPayout(value.payout)
  if ('fiatSnapshot' in value) result.fiatSnapshot = cleanFiatSnapshot(value.fiatSnapshot)
  if ('recipientAddress' in value) result.recipientAddress = cleanText(value.recipientAddress, 500) || null
  if ('recipientName' in value) result.recipientName = cleanText(value.recipientName, 200) || null
  if ('source' in value && ['mobile', 'nostr', 'merchant'].includes(value.source)) result.source = value.source
  if ('personalNote' in value) result.personalNote = cleanText(value.personalNote, 500)
  return result
}

async function readStore(password) {
  if (!password) return emptyStore()
  const data = await chrome.storage.local.get(STORAGE_KEY)
  const stored = data[STORAGE_KEY]
  if (!stored?.encrypted) return emptyStore()
  try {
    const result = await decryptData(stored.encrypted, password)
    if (!result?.accounts || typeof result.accounts !== 'object') throw new Error('Invalid metadata vault shape')
    if (encryptionNeedsUpgrade(stored.encrypted)) await writeStore(result, password)
    return result
  } catch (error) {
    throw vaultIntegrityError('Transaction metadata vault', error)
  }
}

async function writeStore(store, password) {
  if (!password) throw new Error('Password required to save transaction metadata')
  const encrypted = await encryptData(store, password)
  await verifiedSet(STORAGE_KEY, { encrypted })
}

function getWalletScope(store, accountId, walletId, create = false) {
  if (!accountId || !walletId) return null
  if (create) {
    store.accounts[accountId] ||= {}
    store.accounts[accountId][walletId] ||= {}
  }
  return store.accounts[accountId]?.[walletId] || null
}

function pruneScope(scope) {
  const entries = Object.entries(scope)
  if (entries.length <= MAX_RECORDS_PER_WALLET) return
  entries
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(MAX_RECORDS_PER_WALLET)
    .forEach(([id]) => delete scope[id])
}

export function getTransactionId(transaction) {
  if (typeof transaction === 'string') return transaction
  if (!transaction || typeof transaction !== 'object') return ''
  return cleanText(
    transaction.payment_hash || transaction.paymentHash || transaction.id || transaction.checking_id,
    300,
  )
}

export async function saveTransactionMetadata(password, accountId, walletId, transactionId, patch) {
  const id = getTransactionId(transactionId)
  if (!id || !accountId || !walletId) return null
  const store = await readStore(password)
  const scope = getWalletScope(store, accountId, walletId, true)
  const existing = scope[id] || {}
  scope[id] = {
    ...existing,
    ...sanitizeTransactionMetadata(patch),
    updatedAt: Date.now(),
  }
  pruneScope(scope)
  await writeStore(store, password)
  return scope[id]
}

export async function getTransactionMetadata(password, accountId, walletId, transactionId) {
  const id = getTransactionId(transactionId)
  if (!id) return null
  const store = await readStore(password)
  return getWalletScope(store, accountId, walletId)?.[id] || null
}

export async function enrichTransactionsWithMetadata(password, accountId, walletId, transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return transactions || []
  const store = await readStore(password)
  const scope = getWalletScope(store, accountId, walletId)
  if (!scope) return transactions
  return transactions.map((transaction) => {
    const metadata = scope[getTransactionId(transaction)]
    return metadata ? { ...transaction, metadata } : transaction
  })
}

export async function removeWalletTransactionMetadata(password, accountId, walletId) {
  const store = await readStore(password)
  if (!store.accounts[accountId]?.[walletId]) return
  delete store.accounts[accountId][walletId]
  if (Object.keys(store.accounts[accountId]).length === 0) delete store.accounts[accountId]
  await writeStore(store, password)
}

export async function removeWalletTransactionMetadataEverywhere(password, walletId) {
  if (!walletId) return
  const store = await readStore(password)
  let changed = false
  for (const [accountId, wallets] of Object.entries(store.accounts)) {
    if (!wallets[walletId]) continue
    delete wallets[walletId]
    changed = true
    if (Object.keys(wallets).length === 0) delete store.accounts[accountId]
  }
  if (changed) await writeStore(store, password)
}

export async function removeAccountTransactionMetadata(password, accountId) {
  const store = await readStore(password)
  if (!store.accounts[accountId]) return
  delete store.accounts[accountId]
  await writeStore(store, password)
}

export async function reEncryptTransactionMetadata(oldPassword, newPassword) {
  const store = await readStore(oldPassword)
  if (Object.keys(store.accounts).length === 0) {
    await chrome.storage.local.remove(STORAGE_KEY)
    return
  }
  await writeStore(store, newPassword)
}

export async function clearAllTransactionMetadata() {
  await chrome.storage.local.remove(STORAGE_KEY)
}
