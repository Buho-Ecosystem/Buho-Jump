/**
 * Local encrypted proof cache for Cashu wallets.
 *
 * Storage key: cashuProofs_{walletId} → { encrypted: base64 }
 * Decrypted shape: { proofs: CashuProof[], lastSyncedAt: number }
 *
 * Same AES-256-GCM pattern as wallet.js.
 */

import { encryptData, decryptData } from './crypto.js'
import { verifiedSet } from './storage.js'

function storageKey(walletId) {
  return `cashuProofs_${walletId}`
}

function emptyProofStore() {
  return { proofs: [], lastSyncedAt: 0 }
}

export async function readProofStore(walletId, password) {
  if (!password || !walletId) return emptyProofStore()
  try {
    const data = await chrome.storage.local.get(storageKey(walletId))
    const blob = data[storageKey(walletId)]
    if (!blob?.encrypted) return emptyProofStore()
    return await decryptData(blob.encrypted, password)
  } catch {
    return emptyProofStore()
  }
}

export async function writeProofStore(walletId, store, password) {
  if (!password || !walletId) throw new Error('Password and walletId required')
  const encrypted = await encryptData(store, password)
  await verifiedSet(storageKey(walletId), { encrypted })
}

/**
 * Get total balance (sum of all proof amounts) in sats.
 */
export async function getCashuBalance(walletId, password) {
  const store = await readProofStore(walletId, password)
  return store.proofs.reduce((sum, p) => sum + p.amount, 0)
}

/**
 * Add new proofs to the store.
 */
export async function addProofs(walletId, newProofs, password) {
  const store = await readProofStore(walletId, password)
  store.proofs.push(...newProofs)
  await writeProofStore(walletId, store, password)
}

/**
 * Remove proofs by their secret values.
 */
export async function removeProofs(walletId, secrets, password) {
  const store = await readProofStore(walletId, password)
  const secretSet = new Set(secrets)
  store.proofs = store.proofs.filter(p => !secretSet.has(p.secret))
  await writeProofStore(walletId, store, password)
}

/**
 * Atomic swap: remove old proofs by secret, add new ones.
 * Used after mint swap/split operations.
 */
export async function swapProofs(walletId, removeSecrets, addNew, password) {
  const store = await readProofStore(walletId, password)
  const secretSet = new Set(removeSecrets)
  store.proofs = store.proofs.filter(p => !secretSet.has(p.secret))
  store.proofs.push(...addNew)
  await writeProofStore(walletId, store, password)
}

/**
 * Get all proofs (for a specific mint if needed — caller filters by keyset).
 */
export async function getAllProofs(walletId, password) {
  const store = await readProofStore(walletId, password)
  return store.proofs
}

/**
 * Delete proof store for a wallet.
 */
export async function clearProofStore(walletId) {
  await chrome.storage.local.remove(storageKey(walletId))
}

/**
 * Re-encrypt proof store with a new password.
 * Called during password change.
 */
export async function reEncryptProofStore(walletId, oldPassword, newPassword) {
  const store = await readProofStore(walletId, oldPassword)
  if (store.proofs.length === 0) return
  await writeProofStore(walletId, store, newPassword)
}
