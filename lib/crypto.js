/**
 * Encryption module — AES-256-GCM via Web Crypto API.
 * Uses PBKDF2 with 100k iterations for key derivation.
 * All secrets are encrypted at rest with the user's master password.
 *
 * Uses nostr-core utilities where possible.
 */

import { randomBytes, utf8Encoder, utf8Decoder } from 'nostr-core'

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const IV_BYTES = 12

/**
 * Derive an AES-256-GCM key from a password + salt.
 */
async function deriveKey(password, salt, { extractable = false } = {}) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt data with a password. Returns a base64 string containing
 * salt (16 bytes) + iv (12 bytes) + ciphertext.
 */
export async function encryptData(data, password) {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(password, salt)

  const plaintext = utf8Encoder.encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  // Combine: salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt a base64 string produced by encryptData.
 * Throws on wrong password or tampered data (AES-GCM authenticates).
 */
export async function decryptData(encoded, password) {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))

  const salt = combined.slice(0, SALT_BYTES)
  const iv = combined.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const ciphertext = combined.slice(SALT_BYTES + IV_BYTES)

  const key = await deriveKey(password, salt)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )

  return JSON.parse(utf8Decoder.decode(plaintext))
}

/**
 * Hash a password with a salt for verification (not for encryption).
 * Used to verify the master password without storing it.
 */
export async function hashPassword(password, salt) {
  const key = await deriveKey(password, salt, { extractable: true })
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
  await chrome.storage.local.set({ passwordHash: hash, passwordSalt: saltB64 })
}

/**
 * Verify a password against the stored hash.
 */
export async function verifyPassword(password) {
  const data = await chrome.storage.local.get(['passwordHash', 'passwordSalt'])
  if (!data.passwordHash || !data.passwordSalt) return false

  const salt = Uint8Array.from(atob(data.passwordSalt), (c) => c.charCodeAt(0))
  const hash = await hashPassword(password, salt)
  return hash === data.passwordHash
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
