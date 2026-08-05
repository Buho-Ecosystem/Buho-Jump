/**
 * Manual Cashu wallet backup — export/import encrypted backup files.
 *
 * Backup files use the same AES-256-GCM encryption as the wallet store,
 * keyed by the user's session password. The .buho extension is cosmetic.
 */

import { encryptData, decryptData } from './crypto.js'
import { readProofStore } from './cashu-store.js'
import { getActiveWallet } from './wallet.js'
import { requireSecureUrl } from './origins.js'
import { getPublicKey, hexToBytes } from 'nostr-core'

const BACKUP_VERSION = 3
const MAX_BACKUP_PROOFS = 10_000
const MAX_BACKUP_COUNTERS = 10_000

function normalizePrivateKey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) throw new Error('Invalid Cashu backup receiving key')
  const secretKey = hexToBytes(value)
  try {
    getPublicKey(secretKey)
    return value.toLowerCase()
  } catch {
    throw new Error('Invalid Cashu backup receiving key')
  } finally {
    secretKey.fill(0)
  }
}

function validateBackupProof(proof) {
  const amount = typeof proof?.amount === 'number' ? proof.amount : Number(proof?.amount)
  return !!proof && typeof proof === 'object'
    && Number.isSafeInteger(amount) && amount > 0
    && typeof proof.id === 'string' && !!proof.id && proof.id.length <= 256
    && typeof proof.secret === 'string' && !!proof.secret && proof.secret.length <= 4096
    && typeof proof.C === 'string' && !!proof.C && proof.C.length <= 1024
}

/**
 * Export the active Cashu wallet as an encrypted backup.
 * @returns {{ filename: string, data: string }}
 */
export async function exportCashuBackup(walletId, password) {
  const wallet = await getActiveWallet(password)
  if (!wallet || wallet.type !== 'cashu' || wallet.id !== walletId) {
    throw new Error('No matching Cashu wallet active')
  }

  const proofStore = await readProofStore(walletId, password)

  const backup = {
    version: BACKUP_VERSION,
    walletId: wallet.id,
    name: wallet.name,
    mints: wallet.mints,
    unit: wallet.unit || 'sat',
    proofSets: proofStore.proofSets,
    counters: proofStore.counters,
    cashuPrivkey: wallet.cashuPrivkey,
    exportedAt: Date.now(),
  }

  const encrypted = await encryptData(backup, password)
  const date = new Date().toISOString().slice(0, 10)
  const filename = `buho-wallet-backup-${date}.buho`

  return { filename, data: encrypted }
}

/**
 * Parse and decrypt an imported backup file.
 * @param {string} encryptedData - base64 encrypted blob
 * @param {string} password - session password
 * @returns {{ proofs, mints, name, exportedAt }}
 */
export async function importCashuBackup(encryptedData, password) {
  const backup = await decryptData(encryptedData, password)

  if (!backup || ![1, 2, BACKUP_VERSION].includes(backup.version)) {
    throw new Error('Unsupported backup format')
  }

  if (backup.unit && backup.unit !== 'sat') throw new Error('Unsupported Cashu backup unit')
  const normalizeMint = mint => requireSecureUrl(mint, { allowLoopback: true }).toString().replace(/\/$/, '')
  const mints = Array.isArray(backup.mints)
    ? [...new Set(backup.mints.slice(0, 20).map(normalizeMint))]
    : []
  const rawProofSets = backup.version === 1
    ? [{ mint: mints[0], proofs: Array.isArray(backup.proofs) ? backup.proofs : [] }]
    : (Array.isArray(backup.proofSets) ? backup.proofSets : [])
  const proofCount = rawProofSets.reduce((sum, set) =>
    sum + (Array.isArray(set?.proofs) ? set.proofs.length : 0), 0)
  if (rawProofSets.length > 20
    || proofCount > MAX_BACKUP_PROOFS
    || rawProofSets.some(set => !set?.mint
      || !Array.isArray(set.proofs)
      || set.proofs.some(proof => !validateBackupProof(proof)))) {
    throw new Error('Invalid Cashu backup data')
  }
  const proofSets = rawProofSets.map(set => ({ mint: normalizeMint(set.mint), proofs: set.proofs }))
  const counters = backup.version >= 2 && backup.counters && typeof backup.counters === 'object'
    && !Array.isArray(backup.counters)
    ? backup.counters
    : {}
  const counterEntries = Object.entries(counters)
  if (counterEntries.length > MAX_BACKUP_COUNTERS
    || counterEntries.some(([keysetId, next]) => !keysetId || keysetId.length > 4096
      || !Number.isSafeInteger(next) || next < 0)) {
    throw new Error('Invalid Cashu backup counters')
  }

  return {
    proofSets,
    counters,
    cashuPrivkey: backup.version >= 3 ? normalizePrivateKey(backup.cashuPrivkey) : null,
    mints,
    name: backup.name || 'Restored Wallet',
    exportedAt: backup.exportedAt || 0,
  }
}
