/**
 * NUTbits deep link integration.
 * Builds the one-click NWC connection URL.
 * The /connect endpoint is served by the NUTbits API (not the GUI).
 */

// Default NUTbits API URL — local dev
export const NUTBITS_URL = 'http://localhost:3338'

export const NUTBITS_APP_NAME = 'Buho Jump'

// Base callback URL — nothing listens here, but tabs.onUpdated captures the
// full URL (including ?value=) before the page fails to load.
// Chrome blocks redirects to chrome-extension:// from web pages, so we use HTTP.
// A random per-session token is appended to prevent local interception.
const CALLBACK_BASE = 'http://127.0.0.1:19816/buho-nwc-callback'

/** Generate a random hex token for callback URL verification. */
function generateToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Per-session token — regenerated each time the extension loads
let _sessionToken = generateToken()

/**
 * Get the current session callback URL (with token).
 * Used by background.js to match incoming redirects.
 */
export function getCallbackUrl() {
  return `${CALLBACK_BASE}/${_sessionToken}`
}

/**
 * Reset the session token. Call after each connection attempt.
 */
export function rotateCallbackToken() {
  _sessionToken = generateToken()
}

/**
 * Build the NUTbits deep link URL for one-click NWC connection.
 * @param {string} [nutbitsUrl] - Override NUTbits instance URL
 * @returns {string} Full deep link URL
 */
export function buildNutbitsDeepLink(nutbitsUrl = NUTBITS_URL) {
  const params = new URLSearchParams({
    appname: NUTBITS_APP_NAME,
    appicon: chrome.runtime.getURL('logo/icon-256x256.png'),
    callback: getCallbackUrl(),
  })
  return `${nutbitsUrl.replace(/\/+$/, '')}/connect?${params.toString()}`
}
