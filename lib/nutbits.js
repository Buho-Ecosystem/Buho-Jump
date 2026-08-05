/**
 * NUTbits deep link integration.
 * Builds the one-click NWC connection URL.
 * The /connect endpoint is served by the NUTbits API (not the GUI).
 */

// Default NUTbits API URL
export const NUTBITS_URL = 'https://nutbits.drshift.dev'

export const NUTBITS_APP_NAME = 'Buho Jump'

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
  const callback = new URL(chrome.runtime.getURL('nwc-callback.html'))
  callback.searchParams.set('token', _sessionToken)
  return callback.toString()
}

export function verifyCallbackToken(token) {
  if (typeof token !== 'string' || token.length !== _sessionToken.length) return false
  let difference = 0
  for (let index = 0; index < token.length; index++) {
    difference |= token.charCodeAt(index) ^ _sessionToken.charCodeAt(index)
  }
  return difference === 0
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
