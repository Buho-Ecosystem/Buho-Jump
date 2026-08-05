/**
 * NUT-27 — Nostr mint backup.
 *
 * The wallet's mint list is published as a NIP-44 self-encrypted kind 30078
 * event whose key pair is derived deterministically from the recovery words:
 *
 *   private_key = SHA256(bip39_seed_64 || UTF-8("cashu-mint-backup"))
 *
 * Any Cashu wallet holding the same words can find and decrypt the list,
 * so a restore on a new device brings the known mints back too.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { nip44, getPublicKey, finalizeEvent } from 'nostr-core'
import { requireSecureUrl } from './origins.js'

export const MINT_BACKUP_KIND = 30078
export const MINT_BACKUP_D_TAG = 'mint-list'

const MAX_BACKUP_MINTS = 50

/**
 * Derive the backup key pair from the 64-byte BIP-39 seed.
 * @param {Uint8Array} seed - output of mnemonicToSeedSync(mnemonic)
 * @returns {{ secretKey: Uint8Array, pubkey: string }}
 */
export function deriveMintBackupKeys(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 64) {
    throw new Error('Mint backup needs the 64-byte recovery seed')
  }
  const domain = new TextEncoder().encode('cashu-mint-backup')
  const combined = new Uint8Array(seed.length + domain.length)
  combined.set(seed)
  combined.set(domain, seed.length)
  const secretKey = sha256(combined)
  return { secretKey, pubkey: getPublicKey(secretKey) }
}

/**
 * Build the signed, self-encrypted backup event for a mint list.
 */
export function buildMintBackupEvent(seed, mints, timestamp = Math.floor(Date.now() / 1000)) {
  const { secretKey, pubkey } = deriveMintBackupKeys(seed)
  const list = (Array.isArray(mints) ? mints : []).slice(0, MAX_BACKUP_MINTS)
  const conversationKey = nip44.getConversationKey(secretKey, pubkey)
  const content = nip44.encrypt(JSON.stringify({ mints: list, timestamp }), conversationKey)
  return finalizeEvent({
    kind: MINT_BACKUP_KIND,
    created_at: timestamp,
    tags: [['d', MINT_BACKUP_D_TAG], ['client', 'buho-jump']],
    content,
  }, secretKey)
}

/**
 * Decrypt and validate a backup event fetched from relays.
 * Only events signed by the seed's own derived key are accepted, and only
 * HTTPS mint URLs survive validation.
 * @returns {{ mints: string[], timestamp: number } | null}
 */
export function parseMintBackupEvent(event, seed) {
  const { secretKey, pubkey } = deriveMintBackupKeys(seed)
  if (event?.kind !== MINT_BACKUP_KIND || event.pubkey !== pubkey) return null
  if (typeof event.content !== 'string' || event.content.length > 100_000) return null
  try {
    const conversationKey = nip44.getConversationKey(secretKey, pubkey)
    const data = JSON.parse(nip44.decrypt(event.content, conversationKey))
    const candidates = Array.isArray(data?.mints) ? data.mints.slice(0, MAX_BACKUP_MINTS) : []
    const mints = []
    for (const candidate of candidates) {
      try {
        const url = requireSecureUrl(candidate, { allowLoopback: true }).toString().replace(/\/$/, '')
        if (!mints.includes(url)) mints.push(url)
      } catch { /* drop unusable URLs */ }
    }
    return { mints, timestamp: Number(data?.timestamp) || 0 }
  } catch {
    return null
  }
}
