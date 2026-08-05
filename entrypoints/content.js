/**
 * Content script — bridges page-level NIP-07 and WebLN requests
 * to the background service worker via chrome.runtime messaging.
 * Runs in isolated world. Injects provider scripts into main world.
 *
 * Security: All forwarded messages go through the PUBLIC route,
 * which is separated from internal routes in the background.
 * Anti-spam: Tracks rejected origins to prevent repeated prompts.
 * @see https://nips.nostr.com/7
 */

// Allowed methods — only these can be called from page context
const NIP07_METHODS = new Set([
  'getPublicKey', 'signEvent', 'getRelays',
  'nip04_encrypt', 'nip04_decrypt',
  'nip44_encrypt', 'nip44_decrypt',
])

const WEBLN_METHODS = new Set([
  'webln_enable', 'webln_getInfo', 'webln_sendPayment',
  'webln_makeInvoice', 'webln_getBalance', 'webln_keysend',
])

const NIP07_METHOD_MAP = {
  getPublicKey: 'NIP07_GET_PUBLIC_KEY',
  signEvent: 'NIP07_SIGN_EVENT',
  getRelays: 'NIP07_GET_RELAYS',
  nip04_encrypt: 'NIP04_ENCRYPT',
  nip04_decrypt: 'NIP04_DECRYPT',
  nip44_encrypt: 'NIP44_ENCRYPT',
  nip44_decrypt: 'NIP44_DECRYPT',
}

const WEBLN_METHOD_MAP = {
  webln_enable: 'WEBLN_ENABLE',
  webln_getInfo: 'WEBLN_GET_INFO',
  webln_sendPayment: 'WEBLN_SEND_PAYMENT',
  webln_makeInvoice: 'WEBLN_MAKE_INVOICE',
  webln_getBalance: 'WEBLN_GET_BALANCE',
  webln_keysend: 'WEBLN_KEYSEND',
}

function injectScript(fileName) {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL(fileName)
  script.onload = () => script.remove()
  script.onerror = () => {
    script.remove()
    console.warn(`[Buho Jump] Failed to inject ${fileName}`)
  }
  ;(document.documentElement || document.head).appendChild(script)
}

/**
 * Validates that we should inject on this page.
 * Skips non-HTML content and blocked file types.
 */
function shouldInjectOnPage() {
  const docEl = document.documentElement
  if (!docEl || docEl.nodeName !== 'HTML') return false

  const url = document.location?.href || ''
  if (/\.(xml|pdf|json|txt)$/i.test(url)) return false

  return true
}

function createBridge(eventName, responseType, methodMap, allowedMethods) {
  let isRejected = false

  document.addEventListener(eventName, async (e) => {
    const { id, method, params } = e.detail ?? {}
    if (!id || !method) return

    function sendResponse(payload) {
      window.postMessage({ type: responseType, payload }, window.location.origin)
    }

    // Anti-spam: block after rejection
    if (isRejected) {
      sendResponse({ id, error: 'Access denied. Reload the page to try again.' })
      return
    }

    // Validate method is in allowlist
    if (!allowedMethods.has(method)) {
      sendResponse({ id, error: `Unknown method: ${method}` })
      return
    }

    const action = methodMap[method]
    if (!action) {
      sendResponse({ id, error: `Unknown method: ${method}` })
      return
    }

    try {
      // Guard against extension context invalidation (unload/update)
      if (!chrome.runtime?.id) {
        sendResponse({ id, error: 'Extension context invalidated. Please reload the page.' })
        return
      }

      // All messages go through the PUBLIC route
      const res = await chrome.runtime.sendMessage({
        type: 'PUBLIC',
        params: [{ action, params: params ?? [] }],
      })
      if (res?.error) {
        // Track rejections for anti-spam
        if (res.error === 'PERMISSION_DENIED' || (typeof res.error === 'string' && res.error.includes('Access denied'))) {
          isRejected = true
        }
        sendResponse({ id, error: res.error })
      } else {
        sendResponse({ id, result: res?.result })
      }
    } catch (err) {
      // Extension context invalidated (service worker restart, update)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      sendResponse({ id, error: msg })
    }
  })
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',

  async main() {
    // Page-level injection checks
    if (!shouldInjectOnPage()) return

    const host = document?.location?.hostname || ''
    if (!host) return

    // Check blocklist via background
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SHOULD_INJECT', host })
      if (res?.inject !== true) return
    } catch {
      return
    }

    // Set up NIP-07 bridge (public route)
    createBridge('nip07-request', 'nip07-response', NIP07_METHOD_MAP, NIP07_METHODS)
    injectScript('nostr-provider.js')

    // Set up WebLN bridge (public route)
    createBridge('webln-request', 'webln-response', WEBLN_METHOD_MAP, WEBLN_METHODS)
    injectScript('webln-provider.js')

  },
})
