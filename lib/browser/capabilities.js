/**
 * Browser capability detection and unified API.
 * Centralizes all browser-specific behavior so the rest of the codebase
 * never checks browser type directly.
 */

const ua = globalThis.navigator?.userAgent || ''

export const BROWSER = detectBrowser()

function detectBrowser() {
  if (ua.includes('Firefox')) return 'firefox'
  if (ua.includes('Brave')) return 'brave'
  if (ua.includes('Edg/')) return 'edge'
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'opera'
  if (ua.includes('Vivaldi')) return 'vivaldi'
  // Arc doesn't have a unique UA token — detected via Chrome
  if (ua.includes('Chrome')) return 'chrome'
  return 'unknown'
}

/**
 * Whether the browser supports chrome.windows API for popup prompts.
 * Firefox uses a different approach for permission prompts.
 */
export const supportsWindowsApi = BROWSER !== 'firefox'

/**
 * Open a permission prompt — uses windows.create on Chromium, tabs on Firefox.
 */
export async function openPromptWindow(url, options = {}) {
  const { width = 420, height = 520 } = options

  if (supportsWindowsApi) {
    return chrome.windows.create({
      url,
      type: 'popup',
      width,
      height,
      focused: true,
    })
  }

  // Firefox fallback: open as a new tab
  return chrome.tabs.create({ url, active: true })
}

/**
 * Get the extension's base URL for loading pages.
 */
export function getExtensionURL(path) {
  return chrome.runtime.getURL(path)
}

/**
 * Storage wrapper — same API everywhere, but allows future
 * browser-specific storage backends if needed.
 */
export const storage = {
  async get(key) {
    const data = await chrome.storage.local.get(key)
    return data[key] ?? null
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value })
  },

  async remove(key) {
    await chrome.storage.local.remove(key)
  },

  async getAll(keys) {
    return chrome.storage.local.get(keys)
  },
}
