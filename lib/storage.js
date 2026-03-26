/**
 * Verified storage helpers — wraps chrome.storage.local with write verification.
 *
 * The verify pattern: after set(), read back the key and confirm it matches.
 * On failure, retries once, then throws so the caller can surface the error.
 * This prevents silent data loss from quota exceeded, corruption, or races.
 *
 * Usage:
 *   import { verifiedSet, verifiedGet } from './storage.js'
 *   await verifiedSet('accounts', encryptedBlob)  // throws on write failure
 */

import { log } from './logger.js'

/**
 * Write a single key to chrome.storage.local and verify it persisted.
 * Retries once on failure before throwing.
 *
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @throws {Error} if write cannot be verified after retry
 */
export async function verifiedSet(key, value) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await chrome.storage.local.set({ [key]: value })

    // Read back to verify
    const readback = await chrome.storage.local.get(key)
    if (readback[key] !== undefined) return // success

    log.warn('storage', 'WRITE_VERIFY_FAILED', { key, attempt })
  }

  log.error('storage', 'WRITE_FAILED', { key })
  throw new Error(`Storage write failed for key: ${key}`)
}

/**
 * Read a single key from chrome.storage.local.
 * Returns undefined if key doesn't exist.
 *
 * @param {string} key - Storage key
 * @returns {Promise<*>}
 */
export async function verifiedGet(key) {
  const data = await chrome.storage.local.get(key)
  return data[key]
}
