/**
 * Manual Cashu wallet backup — export/import encrypted backup files.
 *
 * Backup files use the same AES-256-GCM encryption as the wallet store,
 * keyed by the user's session password. The .buho extension is cosmetic.
 */

import { encryptData, decryptData } from './crypto.js'
import { readProofStore } from './cashu-store.js'
import { getActiveWallet } from './wallet.js'

const BACKUP_VERSION = 1

/**
 * Export the active Cashu wallet as an encrypted backup.
 * @returns {{ filename: string, data: string }}
 */
export async function exportCashuBackup(walletId, password) {
  const wallet = await getActiveWallet(password)
  if (!wallet || wallet.type !== 'cashu') throw new Error('No Cashu wallet active')

  const proofStore = await readProofStore(walletId, password)

  const backup = {
    version: BACKUP_VERSION,
    walletId: wallet.id,
    name: wallet.name,
    mints: wallet.mints,
    unit: wallet.unit || 'sat',
    proofs: proofStore.proofs,
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

  if (!backup || backup.version !== BACKUP_VERSION) {
    throw new Error('Unsupported backup format')
  }

  return {
    proofs: backup.proofs || [],
    mints: backup.mints || [],
    name: backup.name || 'Restored Wallet',
    exportedAt: backup.exportedAt || 0,
  }
}
