/**
 * Emergency journal for Cashu proofs returned by a mint before the main proof
 * vault could be updated.
 *
 * The durable copy uses encrypted local storage. An encrypted session copy is
 * also attempted because it can still work when a local write is temporarily
 * unavailable. Proofs never cross into a page or UI process.
 */

import { encryptData, decryptData } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'

const JOURNAL_VERSION = 1

export function cashuRecoveryKey(walletId) {
  return `cashuRecovery_${walletId}`
}

function validateEntry(value) {
  if (!value || value.version !== JOURNAL_VERSION
    || typeof value.mint !== 'string'
    || !Array.isArray(value.proofs)
    || value.proofs.length > 10_000) {
    throw new Error('Invalid Cashu recovery journal')
  }
  return value
}

export async function saveCashuRecovery(walletId, password, mint, proofs) {
  const key = cashuRecoveryKey(walletId)
  const encrypted = await encryptData({
    version: JOURNAL_VERSION,
    mint,
    proofs,
    createdAt: Date.now(),
  }, password)
  let durable = false
  let session = false

  try {
    await verifiedSet(key, { encrypted })
    durable = true
  } catch { /* use the independent session fallback */ }

  try {
    await chrome.storage.session.set({ [key]: { encrypted } })
    const readback = await chrome.storage.session.get(key)
    session = !!readback[key]?.encrypted
  } catch { /* durable storage may still have succeeded */ }

  if (!durable && !session) throw new Error('Cashu recovery journal could not be stored')
  return { durable, session }
}

export async function readCashuRecovery(walletId, password) {
  const key = cashuRecoveryKey(walletId)
  const [localData, sessionData] = await Promise.all([
    chrome.storage.local.get(key),
    chrome.storage.session.get(key),
  ])
  const candidates = [localData[key], sessionData[key]].filter(value => value?.encrypted)
  if (candidates.length === 0) return null

  let lastError
  for (const candidate of candidates) {
    try {
      return validateEntry(await decryptData(candidate.encrypted, password))
    } catch (error) {
      lastError = error
    }
  }
  throw vaultIntegrityError('Cashu recovery journal', lastError)
}

export async function hasCashuRecovery(walletId) {
  const key = cashuRecoveryKey(walletId)
  const [localData, sessionData] = await Promise.all([
    chrome.storage.local.get(key),
    chrome.storage.session.get(key),
  ])
  return !!(localData[key]?.encrypted || sessionData[key]?.encrypted)
}

export async function clearCashuRecovery(walletId) {
  const key = cashuRecoveryKey(walletId)
  await Promise.allSettled([
    chrome.storage.local.remove(key),
    chrome.storage.session.remove(key),
  ])
}

export async function reEncryptCashuRecovery(walletId, oldPassword, newPassword) {
  const entry = await readCashuRecovery(walletId, oldPassword)
  if (!entry) return
  await saveCashuRecovery(walletId, newPassword, entry.mint, entry.proofs)
}
