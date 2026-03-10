/**
 * Notification system — browser alerts for incoming DMs and payments.
 *
 * Used by the background service worker to show chrome.notifications.
 * Settings are persisted in chrome.storage.local and toggled from the popup.
 */

const SETTINGS_KEY = 'notificationSettings'

const DEFAULTS = {
  dms: true,
  payments: true,
}

// Throttle: skip if last notification was < 3s ago (prevents flood on catch-up)
let lastNotifyTime = 0
const THROTTLE_MS = 3000

/**
 * Read notification preferences from storage.
 */
export async function getNotificationSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY)
    return { ...DEFAULTS, ...data[SETTINGS_KEY] }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Write notification preferences to storage.
 */
export async function setNotificationSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

/**
 * Show a browser notification for an incoming DM.
 * @param {string} senderName - Display name or truncated npub
 * @param {string} preview - Message content preview (truncated)
 * @param {string} messageId - Unique message id for dedup
 */
export async function notifyDm(senderName, preview, messageId) {
  const settings = await getNotificationSettings()
  if (!settings.dms) return

  if (!shouldNotify()) return

  const title = senderName || 'New Message'
  const message = preview
    ? (senderName ? preview : preview)
    : 'You have a new encrypted message'

  try {
    await chrome.notifications.create(`dm-${messageId || Date.now()}`, {
      type: 'basic',
      iconUrl: getIconUrl(),
      title,
      message: truncatePreview(message),
    })
  } catch { /* notifications not supported */ }
}

/**
 * Show a browser notification for an incoming payment.
 * @param {number} amountSats - Amount received
 * @param {string} paymentHash - For dedup
 */
export async function notifyPayment(amountSats, paymentHash) {
  const settings = await getNotificationSettings()
  if (!settings.payments) return

  if (!shouldNotify()) return

  const formatted = new Intl.NumberFormat().format(amountSats)

  try {
    await chrome.notifications.create(`payment-${paymentHash || Date.now()}`, {
      type: 'basic',
      iconUrl: getIconUrl(),
      title: 'Payment Received',
      message: `You received ${formatted} sats`,
    })
  } catch { /* notifications not supported */ }
}

/**
 * Register the click handler — opens popup to the relevant tab.
 * Call once during background service worker init.
 */
export function setupNotificationClickHandler() {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const tab = notificationId.startsWith('dm-') ? 'chat' : 'wallet'

    // Open popup.html in a new tab with the target tab as query param
    chrome.tabs.create({
      url: chrome.runtime.getURL(`popup.html?tab=${tab}`),
    })

    chrome.notifications.clear(notificationId)
  })
}

// ── Helpers ──

function shouldNotify() {
  const now = Date.now()
  if (now - lastNotifyTime < THROTTLE_MS) return false
  lastNotifyTime = now
  return true
}

function getIconUrl() {
  // Use extension icon if available, fallback to empty
  try {
    return chrome.runtime.getURL('icon/128.png')
  } catch {
    return ''
  }
}

function truncatePreview(text, max = 120) {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max) + '\u2026'
}
