/** Durable journal for a Lightning payment that may still be pending at a mint. */

import { encryptData, decryptData } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'

const VERSION = 1

export function cashuMeltJournalKey(walletId) {
  return `cashuMeltJournal_${walletId}`
}

function validate(value) {
  if (!value || value.version !== VERSION
    || typeof value.mint !== 'string'
    || typeof value.quoteId !== 'string'
    || !value.quoteId || value.quoteId.length > 1024
    || !Array.isArray(value.inputSecrets)
    || !Array.isArray(value.outputData)
    || value.inputSecrets.length > 10_000
    || value.outputData.length > 1_000
    || value.inputSecrets.some(secret => typeof secret !== 'string' || !secret || secret.length > 4096)
    || !Number.isSafeInteger(value.amountSats) || value.amountSats <= 0
    || !Number.isSafeInteger(value.inputTotal) || value.inputTotal < value.amountSats
    || typeof value.transactionId !== 'string' || value.transactionId.length > 256) {
    throw new Error('Invalid Cashu payment journal')
  }
  return value
}

export async function saveCashuMeltJournal(walletId, password, entry) {
  const encrypted = await encryptData({ version: VERSION, ...entry, createdAt: Date.now() }, password)
  await verifiedSet(cashuMeltJournalKey(walletId), { encrypted })
}

export async function readCashuMeltJournal(walletId, password) {
  const key = cashuMeltJournalKey(walletId)
  const data = await chrome.storage.local.get(key)
  if (!data[key]?.encrypted) return null
  try {
    return validate(await decryptData(data[key].encrypted, password))
  } catch (error) {
    throw vaultIntegrityError('Cashu payment journal', error)
  }
}

export async function hasCashuMeltJournal(walletId) {
  const key = cashuMeltJournalKey(walletId)
  return !!(await chrome.storage.local.get(key))[key]?.encrypted
}

export async function clearCashuMeltJournal(walletId) {
  await chrome.storage.local.remove(cashuMeltJournalKey(walletId))
}

export async function reEncryptCashuMeltJournal(walletId, oldPassword, newPassword) {
  const entry = await readCashuMeltJournal(walletId, oldPassword)
  if (!entry) return
  await saveCashuMeltJournal(walletId, newPassword, entry)
}
