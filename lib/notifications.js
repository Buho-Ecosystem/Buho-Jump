/**
 * Notification system — browser alerts for incoming DMs, group messages, and payments.
 *
 * Used by the background service worker to show native browser notifications.
 * Settings are persisted in chrome.storage.local and toggled from the popup.
 *
 * Features:
 *   - Per-category toggles: DMs, groups, payments
 *   - Notification grouping/threading by category
 *   - Do Not Disturb with quiet hours
 *   - Throttle + dedup to prevent flood
 *   - Cross-browser: Chrome, Firefox, Edge, Brave, Opera, Vivaldi, Arc
 */

const SETTINGS_KEY = 'notificationSettings'

const DEFAULTS = {
  dms: true,
  groups: true,
  payments: true,
  // Do Not Disturb
  dnd: false,
  quietHours: false,
  quietStart: '22:00', // HH:MM
  quietEnd: '08:00',   // HH:MM
}

// Throttle: skip if last notification was within throttle window (prevents flood on catch-up)
let lastNotifyTime = 0
const THROTTLE_MS = 3000

// Dedup set — tracks recently shown notification IDs (cleared every 60s)
const recentIds = new Set()
let dedupTimer = null

function startDedupCleanup() {
  if (dedupTimer) return
  dedupTimer = setInterval(() => recentIds.clear(), 60_000)
}

// ── Settings ──

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

// ── DND / Quiet Hours ──

/**
 * Check if notifications are currently silenced by DND or quiet hours.
 */
function isSilenced(settings) {
  if (settings.dnd) return true
  if (!settings.quietHours) return false

  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = settings.quietStart.split(':').map(Number)
  const [endH, endM] = settings.quietEnd.split(':').map(Number)
  const start = startH * 60 + startM
  const end = endH * 60 + endM

  // Handle overnight ranges (e.g. 22:00 → 08:00)
  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end
  }
  return currentMinutes >= start || currentMinutes < end
}

// ── Notify: DM ──

/**
 * Show a browser notification for an incoming DM.
 * @param {string} senderName - Display name or truncated npub
 * @param {string} preview - Message content preview (truncated)
 * @param {string} messageId - Unique message id for dedup
 */
export async function notifyDm(senderName, preview, messageId) {
  const settings = await getNotificationSettings()
  if (!settings.dms) return
  if (isSilenced(settings)) return
  if (!shouldNotify(messageId)) return

  const title = senderName || 'New Message'
  const message = preview || 'You have a new encrypted message'

  await createNotification(`dm-${messageId || Date.now()}`, {
    title,
    message: truncatePreview(message),
  })
}

// ── Notify: Group ──

/**
 * Show a browser notification for an incoming group message.
 * @param {string} groupName - Group display name
 * @param {string} senderName - Message author name or truncated pubkey
 * @param {string} preview - Message content preview
 * @param {string} messageId - Unique message id for dedup
 */
export async function notifyGroup(groupName, senderName, preview, messageId) {
  const settings = await getNotificationSettings()
  if (!settings.groups) return
  if (isSilenced(settings)) return
  if (!shouldNotify(messageId)) return

  const title = groupName || 'Group Message'
  const sender = senderName ? `${senderName}: ` : ''
  const message = `${sender}${preview || 'New message'}`

  await createNotification(`group-${messageId || Date.now()}`, {
    title,
    message: truncatePreview(message),
  })
}

// ── Notify: Payment ──

/**
 * Show a browser notification for an incoming payment.
 * @param {number} amountSats - Amount received
 * @param {string} paymentHash - For dedup
 */
export async function notifyPayment(amountSats, paymentHash) {
  const settings = await getNotificationSettings()
  if (!settings.payments) return
  if (isSilenced(settings)) return
  if (!shouldNotify(paymentHash)) return

  const formatted = new Intl.NumberFormat().format(amountSats)

  await createNotification(`payment-${paymentHash || Date.now()}`, {
    title: 'Payment Received',
    message: `You received ${formatted} sats`,
  })
}

/**
 * Notify user that a payment was auto-approved within their spending limit.
 * @param {string} host - domain that spent
 * @param {number} amountSats - amount debited
 * @param {number} remainingSats - budget remaining after this payment
 */
export async function notifyBudgetSpend(host, amountSats, remainingSats) {
  const settings = await getNotificationSettings()
  if (!settings.payments) return
  if (isSilenced(settings)) return

  const formatted = new Intl.NumberFormat().format(amountSats)
  const remaining = new Intl.NumberFormat().format(remainingSats)

  await createNotification(`budget-${host}-${Date.now()}`, {
    title: `${formatted} sats auto-approved`,
    message: `${remaining} sats remaining in budget for ${host}`,
  })
}

// ── Click handler ──

/**
 * Register the click handler — opens popup to the relevant tab.
 * Call once during background service worker init.
 */
export function setupNotificationClickHandler() {
  if (!chrome.notifications?.onClicked) return

  chrome.notifications.onClicked.addListener((notificationId) => {
    let tab = 'wallet'
    if (notificationId.startsWith('dm-')) tab = 'chat'
    else if (notificationId.startsWith('group-')) tab = 'chat'

    chrome.tabs.create({
      url: chrome.runtime.getURL(`popup.html?tab=${tab}`),
    })

    try { chrome.notifications.clear(notificationId) } catch { /* best effort */ }
  })
}

// ── Cross-browser notification creator ──

/**
 * Create a notification using the chrome.notifications API.
 * Works across Chrome, Firefox, Edge, Brave, Opera, Vivaldi, Arc.
 *
 * Firefox quirks:
 *   - Does not support 'buttons' in notification options
 *   - Does not support 'requireInteraction'
 *   - iconUrl must be a valid extension URL (not data: URI)
 *
 * All Chromium browsers (Edge, Brave, Opera, Vivaldi, Arc) use the
 * same chrome.notifications API as Chrome — no special handling needed.
 */
async function createNotification(id, { title, message }) {
  if (!chrome.notifications?.create) return

  const options = {
    type: 'basic',
    iconUrl: getIconUrl(),
    title,
    message,
  }

  // Firefox: does not support priority or requireInteraction
  // Chromium: these are safe to include but optional
  const isFirefox = typeof browser !== 'undefined' && browser.runtime?.getBrowserInfo
  if (!isFirefox) {
    options.priority = 2 // high priority for Chromium
  }

  try {
    await chrome.notifications.create(id, options)
  } catch (err) {
    // If options like priority caused failure (Firefox), retry without them
    if (!isFirefox) {
      try {
        await chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: getIconUrl(),
          title,
          message,
        })
      } catch { /* notifications truly not supported */ }
    }
  }
}

// ── Helpers ──

function shouldNotify(dedupId) {
  startDedupCleanup()

  // Dedup: skip if we already showed this exact notification
  if (dedupId && recentIds.has(dedupId)) return false

  // Throttle: skip if too recent
  const now = Date.now()
  if (now - lastNotifyTime < THROTTLE_MS) return false

  // Passed all checks — record dedup and timestamp
  if (dedupId) recentIds.add(dedupId)
  lastNotifyTime = now
  return true
}

function getIconUrl() {
  try {
    return chrome.runtime.getURL('icon/128.png')
  } catch {
    // Fallback for browsers where getURL isn't available in this context
    try {
      return chrome.runtime.getURL('logo/icon-128x128.png')
    } catch {
      return ''
    }
  }
}

function truncatePreview(text, max = 120) {
  if (!text || text.length <= max) return text || ''
  return text.slice(0, max) + '\u2026'
}

/**
 * Reset module-level state — for testing only.
 */
export function _resetForTesting() {
  lastNotifyTime = 0
  recentIds.clear()
}
