/** Validation performed inside the trusted background boundary. */

export const MAX_EVENT_BYTES = 128 * 1024
export const MAX_CRYPTO_TEXT_BYTES = 64 * 1024
export const MAX_CIPHERTEXT_BYTES = 128 * 1024
export const MAX_INVOICE_CHARS = 16 * 1024
export const MAX_TAGS = 2_000
export const MAX_TAG_ITEMS = 100
export const MAX_SATS = 21_000_000 * 100_000_000

const encoder = new TextEncoder()

function byteLength(value) {
  return encoder.encode(value).byteLength
}

function requestError(message) {
  const error = new Error(message)
  error.code = 'INVALID_REQUEST'
  return error
}

export function validatePubkey(pubkey) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw requestError('A valid 32-byte public key is required')
  }
  return pubkey.toLowerCase()
}

export function validateCryptoPayload(pubkey, text, { decrypt = false } = {}) {
  const cleanPubkey = validatePubkey(pubkey)
  if (typeof text !== 'string') throw requestError('Encryption input must be text')
  const limit = decrypt ? MAX_CIPHERTEXT_BYTES : MAX_CRYPTO_TEXT_BYTES
  if (byteLength(text) > limit) throw requestError('Encryption input is too large')
  return [cleanPubkey, text]
}

export function validateUnsignedEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw requestError('Event must be an object')
  }
  if (!Number.isInteger(value.kind) || value.kind < 0 || value.kind > 65_535) {
    throw requestError('Event kind must be an integer from 0 to 65535')
  }
  if (!Number.isSafeInteger(value.created_at) || value.created_at < 0) {
    throw requestError('Event timestamp is invalid')
  }
  if (typeof value.content !== 'string') throw requestError('Event content must be text')
  if (!Array.isArray(value.tags) || value.tags.length > MAX_TAGS) {
    throw requestError('Event tags are invalid or too numerous')
  }

  const tags = value.tags.map((tag) => {
    if (!Array.isArray(tag) || tag.length > MAX_TAG_ITEMS || !tag.every(item => typeof item === 'string')) {
      throw requestError('Every event tag must be an array of strings')
    }
    return [...tag]
  })

  // Sign only the NIP-01 unsigned-event fields. A page cannot smuggle an id,
  // signature, pubkey, accessor, or prototype through to a signer.
  const event = {
    kind: value.kind,
    created_at: value.created_at,
    content: value.content,
    tags,
  }
  if (byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) throw requestError('Event is too large')
  return event
}

export function validateInvoice(invoice) {
  if (typeof invoice !== 'string' || !invoice.trim()) throw requestError('A payment request is required')
  const clean = invoice.trim()
  if (clean.length > MAX_INVOICE_CHARS) throw requestError('Payment request is too large')
  return clean
}

export function validateSats(value, { allowZero = false } = {}) {
  const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(amount) || amount < minimum || amount > MAX_SATS) {
    throw requestError('Payment amount is invalid')
  }
  return amount
}

export function validateKeysend(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw requestError('Keysend details are invalid')
  if (typeof value.destination !== 'string' || !/^(02|03)[0-9a-f]{64}$/i.test(value.destination)) {
    throw requestError('Keysend destination is invalid')
  }
  const amount = validateSats(value.amount)
  const customRecords = value.customRecords
  if (customRecords != null) {
    if (typeof customRecords !== 'object' || Array.isArray(customRecords) || Object.keys(customRecords).length > 100) {
      throw requestError('Keysend custom records are invalid')
    }
    for (const [type, record] of Object.entries(customRecords)) {
      if (!/^\d+$/.test(type) || typeof record !== 'string' || byteLength(record) > 4096) {
        throw requestError('Keysend custom record is invalid')
      }
    }
  }
  return { destination: value.destination.toLowerCase(), amount, customRecords }
}
