/**
 * NUTbits deep link integration.
 * Builds the one-click NWC connection URL.
 * The /connect endpoint is served by the NUTbits API (not the GUI).
 */

// Default NUTbits API URL — local dev
export const NUTBITS_URL = 'http://localhost:3338'

export const NUTBITS_APP_NAME = 'Buho Jump'

// Dummy callback URL — nothing listens here, but tabs.onUpdated captures the
// full URL (including ?value=) before the page fails to load.
// Chrome blocks redirects to chrome-extension:// from web pages, so we use HTTP.
export const NUTBITS_CALLBACK_URL = 'http://127.0.0.1:19816/buho-nwc-callback'

/**
 * Build the NUTbits deep link URL for one-click NWC connection.
 * @param {string} [nutbitsUrl] - Override NUTbits instance URL
 * @returns {string} Full deep link URL
 */
export function buildNutbitsDeepLink(nutbitsUrl = NUTBITS_URL) {
  const params = new URLSearchParams({
    appname: NUTBITS_APP_NAME,
    appicon: chrome.runtime.getURL('logo/icon-256x256.png'),
    callback: NUTBITS_CALLBACK_URL,
  })
  return `${nutbitsUrl.replace(/\/+$/, '')}/connect?${params.toString()}`
}
