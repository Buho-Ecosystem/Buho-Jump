/**
 * Session storage helper — persists unlock state across service worker restarts.
 *
 * chrome.storage.session is in-memory only and never written to disk. Buho
 * Jump's declared minimum browser versions support it; if it is unavailable
 * we fail closed instead of putting the master password in persistent storage.
 *
 * Session data survives service worker restarts but is wiped on browser close
 * (session) or explicitly cleared on lock (both).
 */

const SESSION_KEY = '_session'
const LEGACY_FALLBACK_KEY = '_sessionFallback'

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

/**
 * Save session data (password + unlock timestamp).
 * @param {{ password: string, unlockedAt: number }} data
 */
export async function saveSession(data) {
  if (!data) return
  if (!hasSessionStorage()) throw new Error('Secure session storage is unavailable')
  const { password, unlockedAt } = data
  if (typeof password !== 'string' || !password || password.length > 1024
    || !Number.isFinite(unlockedAt) || unlockedAt <= 0) {
    throw new Error('Invalid secure session data')
  }
  await chrome.storage.session.set({ [SESSION_KEY]: { password, unlockedAt } })
  if (Number.isFinite(unlockedAt)) await chrome.storage.local.set({ lastUnlockedAt: unlockedAt })
  // Remove any fallback left by an older release after secure storage succeeds.
  await chrome.storage.local.remove(LEGACY_FALLBACK_KEY).catch(() => {})
}

/**
 * Retrieve session data, or null if no session exists.
 * @returns {Promise<{ password: string, unlockedAt: number } | null>}
 */
export async function getSession() {
  try {
    if (!hasSessionStorage()) return null
    const data = await chrome.storage.session.get(SESSION_KEY)
    const session = data[SESSION_KEY]
    if (!session
      || typeof session.password !== 'string' || !session.password || session.password.length > 1024
      || !Number.isFinite(session.unlockedAt) || session.unlockedAt <= 0) return null
    return session
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
  const promises = hasSessionStorage()
    ? [chrome.storage.session.remove(SESSION_KEY).catch(() => {})]
    : []
  // Always clear an unsafe fallback created by an older version.
  promises.push(chrome.storage.local.remove(LEGACY_FALLBACK_KEY).catch(() => {}))
  await Promise.all(promises)
}
