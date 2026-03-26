/**
 * Session storage helper — persists unlock state across service worker restarts.
 *
 * Primary: chrome.storage.session (in-memory only, never written to disk).
 * Fallback: chrome.storage.local with a short-lived key (for older browsers
 * or environments where session storage is unavailable).
 *
 * Session data survives service worker restarts but is wiped on browser close
 * (session) or explicitly cleared on lock (both).
 */

const SESSION_KEY = '_session'
const FALLBACK_KEY = '_sessionFallback'

/**
 * Detect whether chrome.storage.session is available.
 * Cached after first check.
 */
let _hasSessionStorage = null
function hasSessionStorage() {
  if (_hasSessionStorage !== null) return _hasSessionStorage
  _hasSessionStorage = !!(chrome.storage?.session?.get)
  return _hasSessionStorage
}

/** Get the appropriate storage backend. */
function getBackend() {
  return hasSessionStorage() ? chrome.storage.session : chrome.storage.local
}

/** Get the appropriate key. */
function getKey() {
  return hasSessionStorage() ? SESSION_KEY : FALLBACK_KEY
}

/**
 * Save session data (password + unlock timestamp).
 * @param {{ password: string, unlockedAt: number }} data
 */
export async function saveSession(data) {
  if (!data) return
  const { password, unlockedAt } = data
  const backend = getBackend()
  const key = getKey()
  await backend.set({ [key]: { password, unlockedAt } })
}

/**
 * Retrieve session data, or null if no session exists.
 * @returns {Promise<{ password: string, unlockedAt: number } | null>}
 */
export async function getSession() {
  try {
    const backend = getBackend()
    const key = getKey()
    const data = await backend.get(key)
    return data[key] || null
  } catch {
    // Session read failed — treat as locked
    return null
  }
}

/**
 * Clear session (explicit lock or auto-lock expiry).
 * Clears both backends to handle backend switches.
 */
export async function clearSession() {
  const promises = []
  if (hasSessionStorage()) {
    promises.push(chrome.storage.session.remove(SESSION_KEY).catch(() => {}))
  }
  // Always clear fallback key if it exists
  promises.push(chrome.storage.local.remove(FALLBACK_KEY).catch(() => {}))
  await Promise.all(promises)
}
