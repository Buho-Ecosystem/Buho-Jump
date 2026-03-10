/**
 * Session storage helper — persists unlock state across service worker restarts.
 *
 * Uses chrome.storage.session (in-memory only, never written to disk).
 * Data survives service worker restarts but is wiped on browser close.
 * Supported: Chrome 102+, Firefox 115+, Safari 16.4+.
 */

const SESSION_KEY = '_session'

/**
 * Save session data (password + unlock timestamp).
 * @param {{ password: string, unlockedAt: number }} data
 */
export async function saveSession({ password, unlockedAt }) {
  await chrome.storage.session.set({
    [SESSION_KEY]: { password, unlockedAt },
  })
}

/**
 * Retrieve session data, or null if no session exists.
 * @returns {Promise<{ password: string, unlockedAt: number } | null>}
 */
export async function getSession() {
  const data = await chrome.storage.session.get(SESSION_KEY)
  return data[SESSION_KEY] || null
}

/**
 * Clear session (explicit lock or auto-lock expiry).
 */
export async function clearSession() {
  await chrome.storage.session.remove(SESSION_KEY)
}
