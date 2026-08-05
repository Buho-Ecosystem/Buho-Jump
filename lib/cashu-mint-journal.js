/** Durable encrypted journal for Cashu Lightning deposit quotes. */

import { decryptData, encryptData, encryptionNeedsUpgrade } from './crypto.js'
import { requireSecureUrl } from './origins.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'

const VERSION = 1
const MAX_QUOTES = 20
const mutationTails = new Map()

export function cashuMintJournalKey(walletId) {
  return `cashuMintJournal_${walletId}`
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object'
    || typeof value.quoteId !== 'string' || !value.quoteId || value.quoteId.length > 1024
    || !Number.isSafeInteger(value.amountSats) || value.amountSats <= 0
    || !Number.isSafeInteger(value.expiry) || value.expiry < 0
    || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) {
    throw new Error('Invalid Cashu deposit quote')
  }
  return {
    mint: requireSecureUrl(value.mint, { allowLoopback: true }).toString().replace(/\/$/, ''),
    quoteId: value.quoteId,
    amountSats: value.amountSats,
    expiry: value.expiry,
    createdAt: value.createdAt,
  }
}

function serialize(walletId, operation) {
  const previous = mutationTails.get(walletId) || Promise.resolve()
  const result = previous.then(operation, operation)
  mutationTails.set(walletId, result.then(() => undefined, () => undefined))
  return result
}

async function writeQuotes(walletId, password, quotes) {
  if (!walletId || !password || !Array.isArray(quotes) || quotes.length > MAX_QUOTES) {
    throw new Error('Invalid Cashu deposit journal')
  }
  const encrypted = await encryptData({
    version: VERSION,
    quotes: quotes.map(normalizeEntry),
  }, password)
  await verifiedSet(cashuMintJournalKey(walletId), { encrypted })
}

async function loadQuotes(walletId, password) {
  const key = cashuMintJournalKey(walletId)
  const stored = (await chrome.storage.local.get(key))[key]
  if (!stored) return []
  if (!stored.encrypted) throw vaultIntegrityError('Cashu deposit journal', new Error('Invalid stored format'))
  try {
    const value = await decryptData(stored.encrypted, password)
    if (!value || value.version !== VERSION || !Array.isArray(value.quotes)
      || value.quotes.length > MAX_QUOTES) throw new Error('Invalid Cashu deposit journal')
    const quotes = value.quotes.map(normalizeEntry)
    if (encryptionNeedsUpgrade(stored.encrypted)) await writeQuotes(walletId, password, quotes)
    return quotes
  } catch (error) {
    if (error?.code === 'VAULT_INTEGRITY') throw error
    throw vaultIntegrityError('Cashu deposit journal', error)
  }
}

export async function listCashuMintQuotes(walletId, password) {
  return loadQuotes(walletId, password)
}

export async function saveCashuMintQuote(walletId, password, entry) {
  const quote = normalizeEntry({ ...entry, createdAt: entry.createdAt || Date.now() })
  return serialize(walletId, async () => {
    const quotes = await loadQuotes(walletId, password)
    const existing = quotes.findIndex(item => item.quoteId === quote.quoteId)
    if (existing >= 0) quotes.splice(existing, 1)
    quotes.unshift(quote)
    if (quotes.length > MAX_QUOTES) throw new Error('Check older eCash invoices before creating another')
    await writeQuotes(walletId, password, quotes)
  })
}

export async function removeCashuMintQuote(walletId, password, quoteId) {
  return serialize(walletId, async () => {
    const quotes = await loadQuotes(walletId, password)
    const next = quotes.filter(quote => quote.quoteId !== quoteId)
    if (next.length === quotes.length) return
    if (next.length > 0) await writeQuotes(walletId, password, next)
    else await clearCashuMintJournal(walletId)
  })
}

export async function hasCashuMintJournal(walletId) {
  const key = cashuMintJournalKey(walletId)
  return !!(await chrome.storage.local.get(key))[key]?.encrypted
}

export async function clearCashuMintJournal(walletId) {
  await chrome.storage.local.remove(cashuMintJournalKey(walletId))
}

export async function reEncryptCashuMintJournal(walletId, oldPassword, newPassword) {
  const quotes = await loadQuotes(walletId, oldPassword)
  if (quotes.length > 0) await writeQuotes(walletId, newPassword, quotes)
  else await clearCashuMintJournal(walletId)
}
