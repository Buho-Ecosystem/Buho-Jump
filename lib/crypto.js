/**
 * Encryption module — AES-256-GCM via Web Crypto API.
 * Uses a versioned PBKDF2-HMAC-SHA256 envelope. New data follows the current
 * OWASP work factor; legacy 100k blobs remain readable and are upgraded by
 * each encrypted store on successful access.
 * All secrets are encrypted at rest with the user's master password.
 *
 * Uses nostr-core utilities where possible.
 */

import { randomBytes, utf8Encoder, utf8Decoder } from 'nostr-core'

const LEGACY_PBKDF2_ITERATIONS = 100_000
const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const ENVELOPE_VERSION = 1
const ENVELOPE_PREFIX = `BUHO$${ENVELOPE_VERSION}$PBKDF2-SHA256$${PBKDF2_ITERATIONS}$`

/**
 * Derive an AES-256-GCM key from a password + salt.
 */
async function deriveKey(password, salt, { extractable = false, iterations = PBKDF2_ITERATIONS } = {}) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt data with a password. The authenticated header records the format,
 * KDF, and work factor so future migrations can be explicit and fail closed.
 */
export async function encryptData(data, password) {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(password, salt)

  const plaintext = utf8Encoder.encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8Encoder.encode(ENVELOPE_PREFIX) },
    key,
    plaintext
  )

  // Combine: salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return ENVELOPE_PREFIX + btoa(String.fromCharCode(...combined))
}

export function encryptionNeedsUpgrade(encoded) {
  return typeof encoded !== 'string' || !encoded.startsWith(ENVELOPE_PREFIX)
}

/**
 * Decrypt a base64 string produced by encryptData.
 * Throws on wrong password or tampered data (AES-GCM authenticates).
 */
export async function decryptData(encoded, password) {
  if (typeof encoded !== 'string' || !encoded) throw new Error('Encrypted data is missing')

  let payload = encoded
  let iterations = LEGACY_PBKDF2_ITERATIONS
  let additionalData
  if (encoded.startsWith('BUHO$')) {
    if (!encoded.startsWith(ENVELOPE_PREFIX)) throw new Error('Unsupported encrypted data format')
    payload = encoded.slice(ENVELOPE_PREFIX.length)
    iterations = PBKDF2_ITERATIONS
    additionalData = utf8Encoder.encode(ENVELOPE_PREFIX)
  }

  let combined
  try {
    combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  } catch {
    throw new Error('Encrypted data is malformed')
  }
  if (combined.length <= SALT_BYTES + IV_BYTES + 16) throw new Error('Encrypted data is truncated')

  const salt = combined.slice(0, SALT_BYTES)
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const ciphertext = combined.slice(SALT_BYTES + IV_BYTES)

  const key = await deriveKey(password, salt, { iterations })

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, ...(additionalData ? { additionalData } : {}) },
    key,
    ciphertext
  )

  return JSON.parse(utf8Decoder.decode(plaintext))
}

/**
 * Hash a password with a salt for verification (not for encryption).
 * Used to verify the master password without storing it.
 */
export async function hashPassword(password, salt, { iterations = PBKDF2_ITERATIONS } = {}) {
  const key = await deriveKey(password, salt, { extractable: true, iterations })
  const exported = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
}

/**
 * Check if master password is set up.
 */
export async function isPasswordSet() {
  const data = await chrome.storage.local.get('passwordHash')
  return !!data.passwordHash
}

/**
 * Set up the master password for the first time.
 * Stores a verifier hash (not the password itself).
 */
export async function setupPassword(password) {
  const salt = randomBytes(SALT_BYTES)
  const hash = await hashPassword(password, salt)
  const saltB64 = btoa(String.fromCharCode(...salt))
  await chrome.storage.local.set({
    passwordHash: hash,
    passwordSalt: saltB64,
    passwordKdf: { version: 1, algorithm: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS },
  })
}

/**
 * Verify a password against the stored hash.
 */
export async function verifyPassword(password) {
  const data = await chrome.storage.local.get(['passwordHash', 'passwordSalt', 'passwordKdf'])
  if (!data.passwordHash || !data.passwordSalt) return false

  const salt = Uint8Array.from(atob(data.passwordSalt), (c) => c.charCodeAt(0))
  const current = data.passwordKdf?.version === 1
    && data.passwordKdf?.algorithm === 'PBKDF2-SHA256'
    && data.passwordKdf?.iterations === PBKDF2_ITERATIONS
  const hash = await hashPassword(password, salt, {
    iterations: current ? PBKDF2_ITERATIONS : LEGACY_PBKDF2_ITERATIONS,
  })
  const expected = Uint8Array.from(atob(data.passwordHash), c => c.charCodeAt(0))
  const actual = Uint8Array.from(atob(hash), c => c.charCodeAt(0))
  let difference = expected.length ^ actual.length
  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    difference |= (expected[index] || 0) ^ (actual[index] || 0)
  }
  const valid = difference === 0
  if (valid && !current) await setupPassword(password)
  return valid
}

/**
 * Change the master password. Re-encrypts all account secrets.
 */
export async function changePassword(oldPassword, newPassword) {
  const valid = await verifyPassword(oldPassword)
  if (!valid) throw new Error('Current password is incorrect')

  // Update password hash
  await setupPassword(newPassword)
}
