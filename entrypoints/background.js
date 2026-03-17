/**
 * Background service worker — handles all extension logic:
 * - Master password / lock state
 * - NIP-07 signing (local keys OR NIP-46 remote signer)
 * - NWC wallet operations (via nostr-core NWC client)
 * - WebLN compatibility layer
 * - Permission enforcement with blocklist + anti-spam
 * - Account management
 * - Profile publishing/fetching
 */

import { finalizeEvent, getPublicKey, hexToBytes, bytesToHex, randomBytes, nip19, nip42, nip57, NWC, createSecretKeySigner, fetchPayRequest, fetchInvoice } from 'nostr-core'
import {
  getActiveAccount,
  getAccounts,
  getActiveAccountId,
  setActiveAccount,
  createLocalAccount,
  createAccountWithMnemonic,
  importAccount,
  importFromMnemonic,
  createNip46Account,
  updateAccount,
  removeAccount,
  getAccountSummaries,
  reEncryptAccounts,
} from '../lib/accounts.js'
import {
  checkPermission,
  setPermission,
  getPermissions,
  removePermission,
  removeDomainPermissions,
} from '../lib/permissions.js'
import {
  isPasswordSet,
  setupPassword,
  verifyPassword,
  changePassword,
  encryptData,
  decryptData,
} from '../lib/crypto.js'
import { isBlocked, getBlocklist, addToBlocklist, removeFromBlocklist } from '../lib/blocklist.js'
import {
  getActiveWallet, getWalletSummaries,
  addWallet, removeWallet, setActiveWallet, renameWallet,
  reEncryptWallets, clearAllWallets,
} from '../lib/wallet.js'
import {
  getAllowances, getAllowance, setAllowance,
  recordSpend, checkBudget, removeAllowance, resetAllowanceSpend,
} from '../lib/allowances.js'
import { publishProfile, fetchProfile } from '../lib/profile.js'
import {
  getRelayConfig, getPoolRelays, setPoolRelays,
  addRelay as addRelayToPool, removeRelay as removeRelayFromPool,
  resetPoolToDefaults, fetchNip65, fetchRelayInfo,
  createNip65Event, DEFAULT_ACCOUNT_RELAYS,
} from '../lib/relays.js'
import { getPool, setAuthHandler } from '../lib/relayPool.js'
import { connectBunker, createNostrConnectURI, awaitNostrConnect, parseConnectionURI } from '../lib/nip46-bridge.js'
import { openPromptWindow, supportsWindowsApi } from '../lib/browser/capabilities.js'
import { notifyDm, notifyPayment, notifyGroup, setupNotificationClickHandler } from '../lib/notifications.js'
import { startNotificationPoller } from '../lib/notificationPoller.js'
import { saveSession, getSession, clearSession } from '../lib/session.js'
import { performAccountSwitch } from '../lib/accountSwitch.js'

// ── In-memory state ──────────────────────────────────────────────
let nwcClient = null
let nwcNotifUnsub = null // NIP-47 notification subscription cleanup
let remoteSigner = null
let pendingPermissions = new Map()
let _cachedPassword = null // In-memory cache of session password
let rejectedOrigins = new Set() // Anti-spam: tracks rejected origins
let _nostrConnectAbort = null // AbortController for pending nostrconnect flow

// ── Session restore (service worker wake-up) ─────────────────────
let _sessionLoadPromise = null

async function ensureSessionLoaded() {
  if (_cachedPassword !== null) return
  if (_sessionLoadPromise) return _sessionLoadPromise
  _sessionLoadPromise = (async () => {
    const session = await getSession()
    if (!session) return
    // Check auto-lock expiry
    const { autoLockMinutes } = await chrome.storage.local.get('autoLockMinutes')
    const minutes = autoLockMinutes ?? 0
    if (minutes > 0) {
      const elapsed = (Date.now() - session.unlockedAt) / 1000 / 60
      if (elapsed >= minutes) {
        await clearSession()
        return
      }
    }
    _cachedPassword = session.password
  })()
  try { await _sessionLoadPromise } finally { _sessionLoadPromise = null }
}

// ── Lock / Unlock ────────────────────────────────────────────────
function isUnlocked() {
  return _cachedPassword !== null
}

// ── Permission prompt ────────────────────────────────────────────
// All standard permission methods for "allow all" feature
const ALL_PERMISSION_METHODS = [
  'getPublicKey', 'signEvent',
  'nip04_encrypt', 'nip04_decrypt',
  'nip44_encrypt', 'nip44_decrypt',
  'weblnEnable',
]

async function requestPermission(host, method, kind, eventData, meta) {
  const activeId = await getActiveAccountId()
  // Payment prompts always show (per-transaction approval) — never auto-approve from stored perms
  if (method !== 'weblnSendPayment') {
    const existing = await checkPermission(host, method, kind, activeId)
    if (existing === 'allow') return true
    if (existing === 'deny') return false
  }

  // Check if this is the first time this host is asking for any permission
  // Payment prompts never use the first-visit flow — they always show per-transaction
  const allPerms = await getPermissions(activeId)
  const hostPerms = allPerms[host]
  const firstVisit = method !== 'weblnSendPayment' && (!hostPerms || Object.keys(hostPerms).length === 0)

  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    pendingPermissions.set(requestId, { resolve })

    // Store extra data so the prompt can display context
    if (eventData) {
      chrome.storage.local.set({ [`prompt_event_${requestId}`]: eventData })
    }

    // Build prompt URL with site metadata from the requesting tab
    const siteTitle = meta?.siteTitle || ''
    const siteFavicon = meta?.siteFavicon || ''
    const url = chrome.runtime.getURL(
      `/prompt.html?requestId=${requestId}&host=${encodeURIComponent(host)}&method=${encodeURIComponent(method)}&kind=${kind ?? ''}&firstVisit=${firstVisit}&siteTitle=${encodeURIComponent(siteTitle)}&siteFavicon=${encodeURIComponent(siteFavicon)}`
    )

    // Dynamic sizing: taller for complex prompts
    const promptHeight = firstVisit ? 720 : (method === 'signEvent' || method === 'weblnSendPayment') ? 640 : 520
    openPromptWindow(url, { width: 420, height: promptHeight }).then((win) => {
      // Prompt window guard: reject if window/tab is closed without response
      if (supportsWindowsApi && win?.id) {
        const onRemoved = (windowId) => {
          if (windowId === win.id && pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
            resolve(false)
            chrome.windows.onRemoved.removeListener(onRemoved)
          }
        }
        chrome.windows.onRemoved.addListener(onRemoved)
      }
    })
  })
}

// ── NIP-46 connection management ─────────────────────────────────
async function ensureRemoteSigner() {
  if (remoteSigner?.connected) return remoteSigner

  const account = await getActiveAccount(_cachedPassword)
  if (!account || account.mode !== 'nip46') return null
  if (!account.nip46Session?.bunkerUri || !account.nip46ClientSecretHex) return null

  nip46Reconnecting = true
  try {
    remoteSigner = await connectBunker(
      account.nip46Session.bunkerUri,
      account.nip46ClientSecretHex
    )
    return remoteSigner
  } catch {
    return null
  } finally {
    nip46Reconnecting = false
  }
}

/**
 * Get a Signer for the active account (local or NIP-46).
 * Both return the same nostr-core Signer interface.
 */
async function getSigner() {
  const account = await getActiveAccount(_cachedPassword)
  if (!account) return null

  if (account.mode === 'local' && account.secretHex) {
    return createSecretKeySigner(hexToBytes(account.secretHex))
  }

  if (account.mode === 'nip46') {
    return ensureRemoteSigner()
  }

  return null
}

// ── Lock gate — prompts user to unlock when locked ───────────────
let pendingUnlock = null // shared promise so only one unlock prompt opens

async function requireUnlocked(origin) {
  await ensureSessionLoaded()
  if (isUnlocked()) return

  // If an unlock prompt is already open, wait for it
  if (pendingUnlock) {
    const ok = await pendingUnlock
    if (!ok) throw new Error('Extension is locked')
    return
  }

  // Open unlock prompt and wait
  const promise = new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    pendingPermissions.set(requestId, { resolve })

    const originParam = origin ? `&origin=${encodeURIComponent(origin)}` : ''
    const url = chrome.runtime.getURL(
      `/prompt.html?requestId=${requestId}&mode=unlock${originParam}`
    )

    openPromptWindow(url, { width: 400, height: 440 }).then((win) => {
      if (supportsWindowsApi && win?.id) {
        const onRemoved = (windowId) => {
          if (windowId === win.id && pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId)
            resolve(false)
            chrome.windows.onRemoved.removeListener(onRemoved)
          }
        }
        chrome.windows.onRemoved.addListener(onRemoved)
      }
    })
  })

  pendingUnlock = promise.finally(() => { pendingUnlock = null })
  const ok = await pendingUnlock
  if (!ok) throw new Error('Extension is locked')
}

// ── NIP-07 Handlers ──────────────────────────────────────────────
// All handlers use the unified Signer interface from nostr-core.
// Both local (createSecretKeySigner) and remote (NostrConnect) signers
// share: getPublicKey, signEvent, nip04, nip44.
// Only NostrConnect additionally provides getRelays.

/** Extract site metadata from the Chrome sender object for richer prompt display. */
function getSiteMeta(sender) {
  return {
    siteTitle: sender?.tab?.title || '',
    siteFavicon: sender?.tab?.favIconUrl || '',
  }
}

async function handleGetPublicKey(sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)
  const allowed = await requestPermission(host, 'getPublicKey', null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner()
  if (!signer) return { error: 'NO_SIGNER' }
  return { result: await signer.getPublicKey() }
}

async function handleSignEvent(params, sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)
  const event = params[0]
  if (!event) return { error: 'NO_EVENT' }
  const allowed = await requestPermission(host, 'signEvent', event.kind, event, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner()
  if (!signer) return { error: 'NO_SIGNER' }
  return { result: await signer.signEvent(event) }
}

async function handleGetRelays() {
  const signer = await getSigner()
  if (signer?.getRelays) {
    try { return { result: await signer.getRelays() } } catch { /* fall through */ }
  }

  // Fallback: return stored account relays as NIP-07 relay map
  const account = await getActiveAccount(_cachedPassword)
  if (account?.pubkey) {
    const relays = await getPoolRelays(account.pubkey, 'account')
    const map = {}
    for (const url of relays) {
      map[url] = { read: true, write: true }
    }
    return { result: map }
  }

  return { result: {} }
}

async function handleEncryptDecrypt(type, params, sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)
  const [pubkey, text] = params
  const method = type.toLowerCase()
  const allowed = await requestPermission(host, method, null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner()
  if (!signer) return { error: 'NO_SIGNER' }

  if (type === 'NIP04_ENCRYPT' || type === 'NIP04_DECRYPT') {
    if (!signer.nip04) return { error: 'Signer does not support NIP-04 encryption' }
    if (type === 'NIP04_ENCRYPT') return { result: await signer.nip04.encrypt(pubkey, text) }
    return { result: await signer.nip04.decrypt(pubkey, text) }
  }
  if (type === 'NIP44_ENCRYPT' || type === 'NIP44_DECRYPT') {
    if (!signer.nip44) return { error: 'Signer does not support NIP-44 encryption' }
    if (type === 'NIP44_ENCRYPT') return { result: await signer.nip44.encrypt(pubkey, text) }
    return { result: await signer.nip44.decrypt(pubkey, text) }
  }

  return { error: 'Unknown encrypt/decrypt method' }
}

// ── Bolt11 amount parser ─────────────────────────────────────────
/** Extract amount in sats from a bolt11 invoice string. Returns null if unknown. */
function parseBolt11Amount(invoice) {
  if (!invoice || typeof invoice !== 'string') return null
  const lower = invoice.toLowerCase()
  const match = lower.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?/)
  if (!match) return null
  const num = parseInt(match[1], 10)
  const multiplier = match[2]
  // Amount is in BTC by default, convert to sats
  const btcMultipliers = { m: 0.001, u: 0.000001, n: 0.000000001, p: 0.000000000001 }
  const btc = multiplier ? num * btcMultipliers[multiplier] : num
  return Math.round(btc * 1e8) // BTC → sats
}

// ── NWC / WebLN Handlers ─────────────────────────────────────────
async function ensureNWC() {
  if (nwcClient?.connected) return nwcClient
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet?.connectionUri) throw new Error('No wallet connected')
  if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch {} nwcNotifUnsub = null }
  if (nwcClient) { try { nwcClient.close() } catch {} }
  nwcClient = new NWC(wallet.connectionUri)
  await nwcClient.connect()
  subscribeNwcNotifications()
  return nwcClient
}

/**
 * Execute an NWC operation with automatic reconnect on connection failure.
 * If the first attempt fails with a connection error, reconnects and retries once.
 */
async function withNwcRetry(operation) {
  try {
    const nwc = await ensureNWC()
    return await operation(nwc)
  } catch (err) {
    // If it looks like a connection/network error, reconnect and retry once
    const msg = err?.message?.toLowerCase() || ''
    if (msg.includes('closed') || msg.includes('disconnect') || msg.includes('timeout') || msg.includes('not connected')) {
      // Force reconnect
      if (nwcClient) { try { nwcClient.close() } catch {} nwcClient = null }
      const nwc = await ensureNWC()
      return await operation(nwc)
    }
    throw err
  }
}

/**
 * Subscribe to NIP-47 wallet notifications (payment_received, payment_sent).
 * Triggers browser notifications via lib/notifications.js.
 */
function subscribeNwcNotifications() {
  if (!nwcClient || nwcNotifUnsub) return
  try {
    nwcClient.on('payment_received', (notification) => {
      const amountSats = notification?.amount ? Math.floor(notification.amount / 1000) : 0
      const hash = notification?.payment_hash || ''
      if (amountSats > 0) {
        notifyPayment(amountSats, hash)
      }
    })
    nwcClient.on('payment_sent', () => {
      // Could notify on outgoing payments too — currently a no-op
    })
    nwcNotifUnsub = () => {
      try {
        nwcClient?.off('payment_received')
        nwcClient?.off('payment_sent')
      } catch { /* cleanup best-effort */ }
    }
  } catch {
    // Wallet may not support notifications — that's fine
  }
}

async function handleWeblnEnable(sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)
  const allowed = await requestPermission(host, 'weblnEnable', null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try { await ensureNWC(); return { result: { enabled: true } } }
  catch (err) { return { error: err.message } }
}

async function handleWeblnGetInfo(sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try { const nwc = await ensureNWC(); return { result: await nwc.getInfo() } }
  catch (err) { return { error: err.message } }
}

async function handleWeblnSendPayment(params, sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)

  // Check if this payment fits within the site's budget allowance
  const invoice = params[0]
  const amountSats = parseBolt11Amount(invoice)
  if (amountSats && await checkBudget(host, amountSats)) {
    // Auto-approve: within budget
    try {
      const result = await withNwcRetry(nwc => nwc.payInvoice(invoice))
      await recordSpend(host, amountSats)
      return { result: { preimage: result.preimage } }
    } catch (err) { return { error: err.message } }
  }

  // No budget or over budget — prompt user (pass amount + budget info)
  const allowance = await getAllowance(host)
  const paymentMeta = { amountSats, budgetSats: allowance?.budget || null, spentSats: allowance?.spent || 0 }
  const allowed = await requestPermission(host, 'weblnSendPayment', null, paymentMeta, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const result = await withNwcRetry(nwc => nwc.payInvoice(invoice))
    if (amountSats) await recordSpend(host, amountSats)
    return { result: { preimage: result.preimage } }
  } catch (err) { return { error: err.message } }
}

async function handleWeblnMakeInvoice(params, sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try {
    const args = params[0]
    const amount = typeof args === 'number' ? args : args?.amount
    const description = typeof args === 'object' ? args?.defaultMemo || '' : ''
    const nwc = await ensureNWC()
    const result = await nwc.makeInvoice({ amount: amount * 1000, description })
    return { result: { paymentRequest: result.invoice } }
  } catch (err) { return { error: err.message } }
}

async function handleWeblnGetBalance(sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try {
    const nwc = await ensureNWC()
    const result = await nwc.getBalance()
    return { result: { balance: Math.floor(result.balance / 1000) } }
  } catch (err) { return { error: err.message } }
}

// ── Public routes — callable from content scripts (web pages) ────
const PUBLIC_HANDLERS = {
  NIP07_GET_PUBLIC_KEY: (params, sender) => handleGetPublicKey(sender),
  NIP07_SIGN_EVENT: (params, sender) => handleSignEvent(params, sender),
  NIP07_GET_RELAYS: () => handleGetRelays(),
  NIP04_ENCRYPT: (params, sender) => handleEncryptDecrypt('NIP04_ENCRYPT', params, sender),
  NIP04_DECRYPT: (params, sender) => handleEncryptDecrypt('NIP04_DECRYPT', params, sender),
  NIP44_ENCRYPT: (params, sender) => handleEncryptDecrypt('NIP44_ENCRYPT', params, sender),
  NIP44_DECRYPT: (params, sender) => handleEncryptDecrypt('NIP44_DECRYPT', params, sender),
  WEBLN_ENABLE: (params, sender) => handleWeblnEnable(sender),
  WEBLN_GET_INFO: (params, sender) => handleWeblnGetInfo(sender),
  WEBLN_SEND_PAYMENT: (params, sender) => handleWeblnSendPayment(params, sender),
  WEBLN_MAKE_INVOICE: (params, sender) => handleWeblnMakeInvoice(params, sender),
  WEBLN_GET_BALANCE: (params, sender) => handleWeblnGetBalance(sender),
  NOSTR_CONNECT_LINK: async (params) => {
    // Intercepted nostrconnect: link from a web page — open popup or handle directly
    const [href] = params
    if (!href) return { error: 'No URI provided' }
    // Store the URI so the popup can pick it up
    await chrome.storage.local.set({ pendingNostrConnect: href })
    // Open the popup (not all browsers support this — fallback to notification)
    try { await chrome.action.openPopup() } catch {}
    return { result: { received: true } }
  },
}

// ── Main message listener ────────────────────────────────────────
// ── NIP-46 reconnection state (visible to popup) ────────────────
let nip46Reconnecting = false

async function proactiveReconnect() {
  await ensureSessionLoaded()
  if (!isUnlocked()) return
  const account = await getActiveAccount(_cachedPassword)
  if (!account || account.mode !== 'nip46') return
  if (!account.nip46Session?.bunkerUri || !account.nip46ClientSecretHex) return
  if (remoteSigner?.connected) return

  nip46Reconnecting = true
  try {
    remoteSigner = await connectBunker(
      account.nip46Session.bunkerUri,
      account.nip46ClientSecretHex
    )
  } catch {
    remoteSigner = null
  } finally {
    nip46Reconnecting = false
  }
}

export default defineBackground(() => {
  // Set up notification click handler (opens popup to relevant tab)
  setupNotificationClickHandler()

  // Start background polling for new messages (fires notifications when popup is closed)
  startNotificationPoller(() => _cachedPassword)

  // NIP-42: auto-sign relay auth challenges with active account's key
  setAuthHandler(async (relay, challenge) => {
    try {
      const account = await getActiveAccount(_cachedPassword)
      if (!account?.secretHex) return
      const authEvent = nip42.createAuthEvent(
        { relay: relay.url, challenge },
        hexToBytes(account.secretHex)
      )
      await relay.auth(authEvent)
    } catch { /* auth failed silently — relay may reject us */ }
  })

  // Proactively reconnect NIP-46 signer on service worker startup
  proactiveReconnect()

  // ── Extension badge: show permission count for active tab ──
  async function updateBadgeForTab(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (!tab?.url) { chrome.action.setBadgeText({ tabId, text: '' }); return }
      const host = new URL(tab.url).hostname
      if (!host) { chrome.action.setBadgeText({ tabId, text: '' }); return }
      const activeId = await getActiveAccountId()
      const perms = await getPermissions(activeId)
      const hostPerms = perms[host]
      if (!hostPerms || Object.keys(hostPerms).length === 0) {
        chrome.action.setBadgeText({ tabId, text: '' })
      } else {
        const count = Object.keys(hostPerms).length
        chrome.action.setBadgeText({ tabId, text: String(count) })
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#059573' })
      }
    } catch {
      // Tab may not exist or URL may be restricted
    }
  }

  chrome.tabs.onActivated.addListener(({ tabId }) => updateBadgeForTab(tabId))
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') updateBadgeForTab(tabId)
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, params } = message

    const handle = async () => {
      try {
        // ── Public routes (from content scripts) ──
        if (type === 'PUBLIC') {
          const { action, params: publicParams } = params?.[0] || {}

          // Anti-spam: reject if origin was previously denied
          const origin = sender.tab?.url ? new URL(sender.tab.url).origin : null
          if (origin && rejectedOrigins.has(origin)) {
            return { error: 'Access denied. Reload the page to try again.' }
          }

          const handler = PUBLIC_HANDLERS[action]
          if (!handler) return { error: `Unknown public action: ${action}` }

          try {
            return await handler(publicParams || [], sender)
          } catch (err) {
            // Track rejected permissions for anti-spam
            if (err.message === 'Permission denied' && origin) {
              rejectedOrigins.add(origin)
            }
            throw err
          }
        }

        // ── Internal routes (from popup / options / prompt) ──
        switch (type) {

          // ── Lock / Unlock ──
          case 'GET_LOCK_STATE': {
            await ensureSessionLoaded()
            const hasPassword = await isPasswordSet()
            return { result: { locked: !isUnlocked(), passwordSet: hasPassword } }
          }
          case 'SETUP_PASSWORD': {
            const pw = params?.[0]
            if (!pw || pw.length < 8) return { error: 'Password must be at least 8 characters' }
            await setupPassword(pw)
            _cachedPassword = pw
            await saveSession({ password: pw, unlockedAt: Date.now() })
            return { result: { ok: true } }
          }
          case 'UNLOCK': {
            const pw = params?.[0]
            const valid = await verifyPassword(pw)
            if (!valid) throw new Error('Wrong password')
            _cachedPassword = pw
            await saveSession({ password: pw, unlockedAt: Date.now() })
            rejectedOrigins.clear()
            return { result: { ok: true } }
          }
          case 'LOCK':
            _cachedPassword = null
            await clearSession()
            if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch {} nwcNotifUnsub = null }
            if (nwcClient) { nwcClient.close(); nwcClient = null }
            if (remoteSigner) { remoteSigner.close(); remoteSigner = null }
            return { result: { ok: true } }
          case 'CHANGE_PASSWORD': {
            const [oldPw, newPw] = params || []
            // Verify old password first
            const valid = await verifyPassword(oldPw)
            if (!valid) return { error: 'WRONG_PASSWORD' }
            // Re-encrypt data BEFORE updating the password hash.
            // If re-encryption fails, data stays accessible with the old password.
            await reEncryptAccounts(oldPw, newPw)
            await reEncryptWallets(oldPw, newPw)
            // Now safe to update the hash — data already uses new password
            await changePassword(oldPw, newPw)
            _cachedPassword = newPw
            await saveSession({ password: newPw, unlockedAt: Date.now() })
            return { result: { ok: true } }
          }

          // ── Injection check ──
          case 'SHOULD_INJECT': {
            const host = message.host || ''
            if (!host) return { inject: false }
            const blocked = await isBlocked(host)
            return { inject: !blocked }
          }

          // ── Blocklist ──
          case 'GET_BLOCKLIST':
            return { result: await getBlocklist() }
          case 'ADD_TO_BLOCKLIST':
            await addToBlocklist(params?.[0])
            return { result: { ok: true } }
          case 'REMOVE_FROM_BLOCKLIST':
            await removeFromBlocklist(params?.[0])
            return { result: { ok: true } }

          // ── Settings ──
          case 'GET_SETTINGS': {
            const data = await chrome.storage.local.get(['autoLockMinutes', 'theme', 'mode'])
            return { result: { autoLockMinutes: data.autoLockMinutes ?? 0, theme: data.theme, mode: data.mode } }
          }
          case 'SET_AUTO_LOCK': {
            await chrome.storage.local.set({ autoLockMinutes: params?.[0] ?? 0 })
            // Refresh session timestamp so new timeout applies from now
            if (isUnlocked()) {
              await saveSession({ password: _cachedPassword, unlockedAt: Date.now() })
            }
            return { result: { ok: true } }
          }
          case 'RESET_AUTO_LOCK': {
            if (isUnlocked()) {
              await saveSession({ password: _cachedPassword, unlockedAt: Date.now() })
            }
            return { result: { ok: true } }
          }

          // ── NIP-46 status ──
          case 'GET_NIP46_STATUS':
            return { result: {
              connected: !!remoteSigner?.connected,
              reconnecting: nip46Reconnecting,
            } }

          // ── Account management ──
          case 'GET_ACTIVE_ACCOUNT':
            return { result: await getActiveAccount(_cachedPassword) }
          case 'GET_ACCOUNTS':
            return { result: await getAccountSummaries(_cachedPassword) }
          case 'CREATE_ACCOUNT':
            return { result: await createLocalAccount(_cachedPassword, params?.[0]) }
          case 'CREATE_ACCOUNT_MNEMONIC':
            return { result: await createAccountWithMnemonic(_cachedPassword, params?.[0]) }
          case 'IMPORT_ACCOUNT':
            return { result: await importAccount(_cachedPassword, params?.[0], params?.[1]) }
          case 'IMPORT_FROM_MNEMONIC':
            return { result: await importFromMnemonic(_cachedPassword, params?.[0], params?.[1]) }
          case 'CREATE_NIP46_ACCOUNT':
            return { result: await createNip46Account(_cachedPassword, params?.[0]) }
          case 'SWITCH_ACCOUNT': {
            const cleaned = await performAccountSwitch(params?.[0], {
              nwcClient, nwcNotifUnsub, remoteSigner,
            })
            nwcClient = cleaned.nwcClient
            nwcNotifUnsub = cleaned.nwcNotifUnsub
            remoteSigner = cleaned.remoteSigner
            return { result: { switched: true } }
          }
          case 'REMOVE_ACCOUNT':
            await removeAccount(_cachedPassword, params?.[0])
            if (remoteSigner) { await remoteSigner.disconnect(); remoteSigner = null }
            return { result: { removed: true } }
          case 'EXPORT_NSEC': {
            const acct = await getActiveAccount(_cachedPassword)
            if (!acct || acct.mode !== 'local' || !acct.secretHex) {
              return { error: 'No local key to export' }
            }
            return { result: { nsec: nip19.nsecEncode(hexToBytes(acct.secretHex)) } }
          }

          // ── NIP-46 connection ──
          case 'CONNECT_NIP46': {
            const [bunkerUri, accountId] = params
            try {
              // Gracefully disconnect any existing remote signer before connecting
              if (remoteSigner) { try { await remoteSigner.disconnect() } catch {} remoteSigner = null }
              const parsed = parseConnectionURI(bunkerUri)
              const clientSecret = (await getAccounts(_cachedPassword))[accountId]?.nip46ClientSecretHex
              if (!clientSecret) return { error: 'Account missing client secret key' }
              const signer = await connectBunker(bunkerUri, clientSecret)
              remoteSigner = signer
              const pubkey = await signer.getPublicKey()
              const updates = {
                pubkey,
                nip46Session: {
                  signerPubkey: parsed.remotePubkey,
                  relays: parsed.relayUrls,
                  bunkerUri,
                },
              }
              // Fetch profile to use real name instead of "Remote Signer"
              try {
                const profile = await fetchProfile(pubkey)
                if (profile?.display_name || profile?.name) {
                  updates.name = profile.display_name || profile.name
                }
              } catch { /* non-critical */ }
              await updateAccount(_cachedPassword, accountId, updates)
              // Always activate the newly connected NIP-46 account
              await setActiveAccount(accountId)
              return { result: { pubkey, connected: true } }
            } catch (err) {
              // Clean up the failed account so it doesn't linger
              try { await removeAccount(_cachedPassword, accountId) } catch {}
              const msg = err.message || ''
              if (/already.connect/i.test(msg)) {
                return { error: 'Session already active on signer. Please generate a new bunker URI from your signer app.' }
              }
              return { error: msg }
            }
          }
          case 'DISCONNECT_NIP46':
            if (remoteSigner) { await remoteSigner.disconnect(); remoteSigner = null }
            if (_nostrConnectAbort) { _nostrConnectAbort.abort(); _nostrConnectAbort = null }
            return { result: { disconnected: true } }

          // ── Nostr Connect (reverse flow — signer scans our QR) ──
          case 'START_NOSTR_CONNECT': {
            const [accountId, relayUrl] = params
            try {
              const account = (await getAccounts(_cachedPassword))[accountId]
              if (!account?.nip46ClientSecretHex) return { error: 'Account not found' }
              const clientPubkey = getPublicKey(hexToBytes(account.nip46ClientSecretHex))
              const secret = bytesToHex(randomBytes(16))
              const effectiveRelay = relayUrl || 'wss://relay.nsec.app'
              const uri = createNostrConnectURI({
                clientPubkey,
                relayUrl: effectiveRelay,
                secret,
                name: 'Buho Jump',
              })
              // Cancel any pending nostrconnect flow
              if (_nostrConnectAbort) { _nostrConnectAbort.abort(); _nostrConnectAbort = null }
              const abortController = new AbortController()
              _nostrConnectAbort = abortController
              nip46Reconnecting = true
              // Start listening in background — popup polls GET_NIP46_STATUS
              awaitNostrConnect({
                secretKey: account.nip46ClientSecretHex,
                relayUrl: effectiveRelay,
                secret,
                timeout: 90000,
                signal: abortController.signal,
              }).then(async ({ signer, remotePubkey, relayUrl: connectedRelay }) => {
                remoteSigner = signer
                _nostrConnectAbort = null
                const pubkey = await signer.getPublicKey()
                const updates = { pubkey, nip46Session: {
                  signerPubkey: remotePubkey,
                  relays: [connectedRelay],
                  bunkerUri: `bunker://${remotePubkey}?relay=${encodeURIComponent(connectedRelay)}`,
                } }
                try {
                  const profile = await fetchProfile(pubkey)
                  if (profile?.display_name || profile?.name) updates.name = profile.display_name || profile.name
                } catch {}
                await updateAccount(_cachedPassword, accountId, updates)
                await setActiveAccount(accountId)
              }).catch(() => {
                _nostrConnectAbort = null
              }).finally(() => {
                nip46Reconnecting = false
              })
              return { result: { uri, secret } }
            } catch (err) {
              nip46Reconnecting = false
              return { error: err.message }
            }
          }
          case 'CANCEL_NOSTR_CONNECT':
            if (_nostrConnectAbort) { _nostrConnectAbort.abort(); _nostrConnectAbort = null }
            nip46Reconnecting = false
            return { result: { cancelled: true } }

          // ── Profile ──
          case 'PUBLISH_PROFILE': {
            const [profileData] = params
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'Local account required to publish profile' }
            const relays = account.pubkey ? await getPoolRelays(account.pubkey, 'account') : undefined
            const result = await publishProfile(profileData, account.secretHex, relays)
            if (profileData.name) {
              await updateAccount(_cachedPassword, account.id, { name: profileData.name })
            }
            return { result }
          }
          case 'FETCH_PROFILE': {
            const [pubkey] = params
            const relays = pubkey ? await getPoolRelays(pubkey, 'account').catch(() => undefined) : undefined
            const profile = await fetchProfile(pubkey, relays)
            return { result: profile }
          }

          // ── Wallet ──
          case 'CONNECT_WALLET': {
            const [uri, walletName] = params || []
            await addWallet(uri, walletName || null, _cachedPassword)
            if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch {} nwcNotifUnsub = null }
            if (nwcClient) { try { nwcClient.close() } catch {} }
            nwcClient = null
            try { await ensureNWC(); return { result: { connected: true } } }
            catch (err) { return { error: err.message } }
          }
          case 'DISCONNECT_WALLET': {
            const [walletId] = params || []
            if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch {} nwcNotifUnsub = null }
            if (nwcClient) { try { nwcClient.close() } catch {}; nwcClient = null }
            if (walletId) {
              await removeWallet(walletId, _cachedPassword)
            } else {
              await clearAllWallets()
            }
            // Reconnect to next active wallet if one exists
            try { await ensureNWC() } catch { /* no wallet left — fine */ }
            return { result: { disconnected: true } }
          }
          case 'GET_WALLET_STATUS': {
            const wallet = await getActiveWallet(_cachedPassword)
            try {
              if (wallet?.connectionUri) {
                const nwc = await ensureNWC()
                const bal = await nwc.getBalance()
                return { result: {
                  connected: true,
                  balance: Math.floor(bal.balance / 1000),
                  activeWallet: { id: wallet.id, name: wallet.name },
                } }
              }
            } catch { /* fall through */ }
            return { result: { connected: false, balance: null, activeWallet: null } }
          }
          case 'GET_WALLETS': {
            const summaries = await getWalletSummaries(_cachedPassword)
            return { result: summaries }
          }
          case 'SWITCH_WALLET': {
            const [switchId] = params || []
            await setActiveWallet(switchId, _cachedPassword)
            if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch {} nwcNotifUnsub = null }
            if (nwcClient) { try { nwcClient.close() } catch {} }
            nwcClient = null
            try {
              await ensureNWC()
              const nwc = nwcClient
              const bal = await nwc.getBalance()
              return { result: {
                connected: true,
                balance: Math.floor(bal.balance / 1000),
              } }
            } catch (err) { return { error: err.message } }
          }
          case 'RENAME_WALLET': {
            const [renameId, newName] = params || []
            await renameWallet(renameId, newName, _cachedPassword)
            return { result: { ok: true } }
          }
          case 'WALLET_GET_INFO': {
            const nwc = await ensureNWC()
            const info = await nwc.getInfo()
            return { result: info }
          }
          case 'WALLET_GET_BALANCE': {
            const nwc = await ensureNWC()
            const bal = await nwc.getBalance()
            return { result: { balance: Math.floor(bal.balance / 1000) } }
          }
          case 'WALLET_GET_BUDGET': {
            const nwc = await ensureNWC()
            const budget = await nwc.getBudget()
            return { result: budget }
          }
          case 'WALLET_PAY_INVOICE': {
            const [invoice, amountSats] = params || []
            const payResult = await withNwcRetry(nwc =>
              nwc.payInvoice(invoice, amountSats ? amountSats * 1000 : undefined)
            )
            return { result: payResult }
          }
          case 'WALLET_MAKE_INVOICE': {
            const [amountSats, description] = params || []
            const nwc = await ensureNWC()
            const inv = await nwc.makeInvoice({ amount: amountSats * 1000, description: description || '' })
            return { result: inv }
          }
          case 'WALLET_LOOKUP_INVOICE': {
            const [lookupParams] = params || []
            const nwc = await ensureNWC()
            const inv = await nwc.lookupInvoice(lookupParams)
            return { result: inv }
          }
          case 'WALLET_LIST_TRANSACTIONS': {
            const [txParams] = params || []
            const nwc = await ensureNWC()
            const txs = await nwc.listTransactions(txParams || {})
            return { result: txs }
          }
          case 'WALLET_PAY_KEYSEND': {
            const [keysendParams] = params || []
            const nwc = await ensureNWC()
            const ksResult = await nwc.payKeysend(keysendParams)
            return { result: ksResult }
          }
          case 'WALLET_SIGN_MESSAGE': {
            const [msg] = params || []
            const nwc = await ensureNWC()
            const sigResult = await nwc.signMessage(msg)
            return { result: sigResult }
          }

          // ── Zaps (NIP-57) ──
          case 'SEND_ZAP': {
            const { recipientPubkey, amountSats, lightningAddress, content } = params?.[0] || {}
            if (!lightningAddress || !amountSats) return { error: 'Missing zap parameters' }
            const nwc = await ensureNWC()
            const account = await getActiveAccount(_cachedPassword)
            const amountMsats = amountSats * 1000

            // Try NIP-57 for local accounts
            if (account?.secretHex) {
              try {
                // Resolve Lightning Address to LNURL-pay URL (fetchPayRequest doesn't accept user@domain)
                const [name, domain] = lightningAddress.split('@')
                const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${name}`
                const payReq = await fetchPayRequest(lnurlPayUrl)
                if (payReq.allowsNostr && payReq.nostrPubkey) {
                  const relays = await getPoolRelays(account.pubkey, 'account')
                  const zapReq = nip57.createZapRequestEvent({
                    recipientPubkey,
                    amount: amountMsats,
                    relays: relays.slice(0, 3),
                    content: content || '',
                    lnurl: lightningAddress,
                  }, hexToBytes(account.secretHex))

                  const invoice = await nip57.fetchZapInvoice({
                    lnurl: payReq.callback,
                    zapRequest: zapReq,
                    amount: amountMsats,
                  })

                  const payResult = await nwc.payInvoice(invoice)
                  return { result: { preimage: payResult.preimage, nip57: true } }
                }
              } catch { /* NIP-57 failed, fall through to plain payment */ }
            }

            // Fallback: plain Lightning Address payment
            const inv = await fetchInvoice(lightningAddress, amountSats)
            const payResult = await nwc.payInvoice(inv.invoice)
            return { result: { preimage: payResult.preimage, nip57: false } }
          }

          // ── Allowances (budgets) ──
          case 'GET_ALLOWANCES':
            return { result: await getAllowances() }
          case 'GET_ALLOWANCE':
            return { result: await getAllowance(params?.[0]) }
          case 'SET_ALLOWANCE':
            await setAllowance(params?.[0], params?.[1])
            return { result: { ok: true } }
          case 'REMOVE_ALLOWANCE':
            await removeAllowance(params?.[0])
            return { result: { ok: true } }
          case 'RESET_ALLOWANCE':
            await resetAllowanceSpend(params?.[0])
            return { result: { ok: true } }

          // ── Permissions ──
          case 'GET_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            return { result: await getPermissions(activeId) }
          }
          case 'REMOVE_PERMISSION': {
            const activeId = await getActiveAccountId()
            await removePermission(params?.[0], params?.[1], activeId)
            return { result: { removed: true } }
          }
          case 'REMOVE_DOMAIN_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            await removeDomainPermissions(params?.[0], activeId)
            return { result: { removed: true } }
          }

          // ── Chat crypto (internal — used by popup chat for NIP-46 accounts) ──
          case 'CHAT_ENCRYPT': {
            const [pubkey, text, method] = params || []
            const signer = await getSigner()
            if (!signer) return { error: 'NO_SIGNER' }
            if (method === 'nip44') {
              if (!signer.nip44) return { error: 'Signer does not support NIP-44' }
              return { result: await signer.nip44.encrypt(pubkey, text) }
            }
            if (!signer.nip04) return { error: 'Signer does not support NIP-04' }
            return { result: await signer.nip04.encrypt(pubkey, text) }
          }
          case 'CHAT_DECRYPT': {
            const [pubkey, ciphertext, method] = params || []
            const signer = await getSigner()
            if (!signer) return { error: 'NO_SIGNER' }
            if (method === 'nip44') {
              if (!signer.nip44) return { error: 'Signer does not support NIP-44' }
              return { result: await signer.nip44.decrypt(pubkey, ciphertext) }
            }
            if (!signer.nip04) return { error: 'Signer does not support NIP-04' }
            return { result: await signer.nip04.decrypt(pubkey, ciphertext) }
          }
          case 'CHAT_SIGN': {
            const [eventTemplate] = params || []
            const signer = await getSigner()
            if (!signer) return { error: 'NO_SIGNER' }
            return { result: await signer.signEvent(eventTemplate) }
          }

          // ── Relay management ──
          case 'GET_RELAY_CONFIG': {
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.pubkey) return { error: 'NO_ACCOUNT' }
            return { result: await getRelayConfig(account.pubkey) }
          }
          case 'SET_RELAY_CONFIG': {
            const [pool, urls] = params || []
            if (!['account', 'wallet', 'chat'].includes(pool)) return { error: 'Invalid pool' }
            if (!Array.isArray(urls)) return { error: 'URLs must be an array' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.pubkey) return { error: 'NO_ACCOUNT' }
            await setPoolRelays(account.pubkey, pool, urls)
            return { result: { ok: true } }
          }
          case 'ADD_RELAY': {
            const [pool, url] = params || []
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.pubkey) return { error: 'NO_ACCOUNT' }
            const config = await addRelayToPool(account.pubkey, pool, url)
            return { result: config }
          }
          case 'REMOVE_RELAY': {
            const [pool, url] = params || []
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.pubkey) return { error: 'NO_ACCOUNT' }
            const config = await removeRelayFromPool(account.pubkey, pool, url)
            return { result: config }
          }
          case 'RESET_RELAYS': {
            const [pool] = params || []
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.pubkey) return { error: 'NO_ACCOUNT' }
            const config = await resetPoolToDefaults(account.pubkey, pool)
            return { result: config }
          }
          case 'FETCH_NIP65': {
            const [pubkey] = params || []
            const account = await getActiveAccount(_cachedPassword)
            const pk = pubkey || account?.pubkey
            if (!pk) return { error: 'NO_PUBKEY' }
            const relays = await getPoolRelays(pk, 'account').catch(() => DEFAULT_ACCOUNT_RELAYS)
            const result = await fetchNip65(pk, relays)
            return { result }
          }
          case 'PUBLISH_NIP65': {
            const [relayList] = params || []
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const template = createNip65Event(relayList)
            const secretKey = hexToBytes(account.secretHex)
            const event = finalizeEvent(template, secretKey)
            const relays = await getPoolRelays(account.pubkey, 'account')
            const pool = getPool()
            const published = []
            const failed = []
            const results = await Promise.allSettled(
              relays.map(async (url) => { await pool.publish([url], event); return url })
            )
            for (let i = 0; i < results.length; i++) {
              if (results[i].status === 'fulfilled') published.push(results[i].value)
              else failed.push(relays[i])
            }
            return { result: { published, failed } }
          }
          case 'FETCH_RELAY_INFO': {
            const [url] = params || []
            if (!url) return { error: 'No relay URL' }
            const info = await fetchRelayInfo(url)
            return { result: info }
          }

          // ── Notifications ──
          case 'NOTIFY_DM': {
            const { senderName, preview, messageId } = params?.[0] || {}
            await notifyDm(senderName, preview, messageId)
            return { result: { ok: true } }
          }
          case 'NOTIFY_GROUP': {
            const { groupName, senderName, preview, messageId } = params?.[0] || {}
            await notifyGroup(groupName, senderName, preview, messageId)
            return { result: { ok: true } }
          }
          case 'NOTIFY_PAYMENT': {
            const { amountSats, paymentHash } = params?.[0] || {}
            await notifyPayment(amountSats, paymentHash)
            return { result: { ok: true } }
          }

          // ── Unlock prompt response ──
          case 'UNLOCK_RESPONSE': {
            const { requestId: unlockReqId, password } = params?.[0] || {}
            const pendingUnlockEntry = pendingPermissions.get(unlockReqId)
            if (!pendingUnlockEntry) return { error: 'Unknown request' }
            try {
              const valid = await verifyPassword(password)
              if (!valid) return { error: 'Wrong password' }
              _cachedPassword = password
              await saveSession({ password, unlockedAt: Date.now() })
              rejectedOrigins.clear()
              pendingPermissions.delete(unlockReqId)
              pendingUnlockEntry.resolve(true)
              return { result: { ok: true } }
            } catch (err) {
              return { error: err.message || 'Wrong password' }
            }
          }

          // ── Permission prompt response ──
          case 'PERMISSION_RESPONSE': {
            const { requestId, decision, host, method, kind } = params?.[0] || {}
            const pending = pendingPermissions.get(requestId)
            if (!pending) return { error: 'Unknown request' }
            pendingPermissions.delete(requestId)
            // Clean up stored event data
            chrome.storage.local.remove(`prompt_event_${requestId}`)
            const activeId = await getActiveAccountId()

            if (decision === 'allow_all') {
              // Grant all standard permissions for this host (never includes weblnSendPayment)
              for (const m of ALL_PERMISSION_METHODS) {
                await setPermission(host, m, 'allow', null, activeId)
              }
              pending.resolve(true)
            } else if (decision === 'deny_all') {
              // Block all methods for this host
              for (const m of [...ALL_PERMISSION_METHODS, 'weblnSendPayment']) {
                await setPermission(host, m, 'deny', null, activeId)
              }
              pending.resolve(false)
            } else if (decision === 'allow_always' || decision === 'deny_always') {
              await setPermission(host, method, decision === 'allow_always' ? 'allow' : 'deny', kind || null, activeId)
              pending.resolve(decision === 'allow_always')
            } else {
              pending.resolve(decision === 'allow_once')
            }
            return { result: { ok: true } }
          }

          default:
            return { error: `Unknown message type: ${type}` }
        }
      } catch (err) {
        return { error: err.message || 'Unknown error' }
      }
    }

    handle().then(sendResponse)
    return true
  })
})
