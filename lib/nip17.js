/**
 * NIP-17 Gift-Wrapped Direct Messages
 *
 * Implements the full NIP-17 protocol using nostr-core primitives:
 *   Rumor (kind 14) → Seal (kind 13) → Gift Wrap (kind 1059)
 *
 * Uses NIP-44 encryption at each layer for modern, padding-aware crypto.
 */

import {
  nip44,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  getEventHash,
  verifyEvent,
} from 'nostr-core'

/**
 * Tweak a timestamp by ±48 hours to prevent metadata correlation.
 */
function tweakTimestamp(ts) {
  const twoDays = 2 * 24 * 60 * 60
  return ts - Math.round(Math.random() * twoDays)
}

/**
 * Create an unsigned "rumor" event (kind 14).
 */
function createRumor(content, senderPubkey, recipientPubkey) {
  const rumor = {
    kind: 14,
    content,
    tags: [['p', recipientPubkey]],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: senderPubkey,
  }
  rumor.id = getEventHash(rumor)
  return rumor
}

/**
 * Wrap a direct message for a recipient using NIP-17 gift wrapping.
 *
 * @param {string} content - Plaintext message
 * @param {Uint8Array} senderSecretKey - Sender's secret key
 * @param {string} recipientPubkey - Recipient's hex pubkey
 * @returns {object} The gift wrap event (kind 1059), ready to publish
 */
export function wrapDirectMessage(content, senderSecretKey, recipientPubkey) {
  const senderPubkey = getPublicKey(senderSecretKey)

  // 1. Create rumor (unsigned kind 14)
  const rumor = createRumor(content, senderPubkey, recipientPubkey)

  // 2. Create seal (kind 13) — rumor encrypted to recipient
  const sealConversationKey = nip44.getConversationKey(senderSecretKey, recipientPubkey)
  const sealContent = nip44.encrypt(JSON.stringify(rumor), sealConversationKey)

  const seal = finalizeEvent({
    kind: 13,
    content: sealContent,
    tags: [],
    created_at: tweakTimestamp(Math.floor(Date.now() / 1000)),
  }, senderSecretKey)

  // 3. Create gift wrap (kind 1059) — seal encrypted with random key
  const wrapSecretKey = generateSecretKey()
  const wrapConversationKey = nip44.getConversationKey(wrapSecretKey, recipientPubkey)
  const wrapContent = nip44.encrypt(JSON.stringify(seal), wrapConversationKey)

  const wrap = finalizeEvent({
    kind: 1059,
    content: wrapContent,
    tags: [['p', recipientPubkey]],
    created_at: tweakTimestamp(Math.floor(Date.now() / 1000)),
  }, wrapSecretKey)

  return wrap
}

/**
 * Unwrap and decrypt a NIP-17 gift-wrapped direct message.
 *
 * @param {object} wrapEvent - The kind 1059 gift wrap event
 * @param {Uint8Array} recipientSecretKey - Our secret key
 * @returns {{ id, sender, content, created_at }} The decrypted message
 */
export function unwrapDirectMessage(wrapEvent, recipientSecretKey) {
  // 1. Decrypt gift wrap → seal
  const wrapCK = nip44.getConversationKey(recipientSecretKey, wrapEvent.pubkey)
  const sealJSON = nip44.decrypt(wrapEvent.content, wrapCK)
  const seal = JSON.parse(sealJSON)

  // 2. Verify seal signature
  if (!verifyEvent(seal)) {
    throw new Error('Invalid seal signature')
  }

  // 3. Decrypt seal → rumor
  const sealCK = nip44.getConversationKey(recipientSecretKey, seal.pubkey)
  const rumorJSON = nip44.decrypt(seal.content, sealCK)
  const rumor = JSON.parse(rumorJSON)

  return {
    id: rumor.id || wrapEvent.id,
    sender: rumor.pubkey || seal.pubkey,
    content: rumor.content,
    created_at: rumor.created_at,
  }
}
