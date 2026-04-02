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

import { finalizeEvent, getPublicKey, hexToBytes, bytesToHex, randomBytes, nip19, nip42, nip57, nip09, createReactionEvent, createHttpAuthEvent, getAuthorizationHeader, NWC, createSecretKeySigner, fetchPayRequest, fetchInvoice, decodeBolt11 } from 'nostr-core'
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
  reEncryptWallets, clearAllWallets, addCashuWallet, updateCashuMints,
} from '../lib/wallet.js'
import {
  getCashuBalance, getAllProofs as getCashuProofs, addProofs as addCashuProofs, clearProofStore,
  reEncryptProofStore, readProofStore,
} from '../lib/cashu-store.js'
import {
  createMintQuote, checkMintQuote, mintTokens, meltTokens,
  createEcashToken, receiveEcashToken, getMintInfo, teardownCashu,
} from '../lib/cashu-engine.js'
import {
  publishWalletEvent, publishTokenEvent, publishHistoryEvent,
  deleteTokenEvents, restoreFromRelays,
} from '../lib/cashu-sync.js'
import { exportCashuBackup, importCashuBackup } from '../lib/cashu-backup.js'
import { fetchLnurlWithdrawParams, executeLnurlWithdraw } from '../lib/lnurl.js'
import { recordCashuTx, updateCashuTx, getCashuTransactions, clearCashuTxHistory } from '../lib/cashu-transactions.js'
import { DEFAULT_MINT, DEFAULT_WALLET_NAME } from '../lib/cashu-constants.js'
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
import { openPromptWindow } from '../lib/browser/capabilities.js'
import { notifyDm, notifyPayment, notifyGroup, setupNotificationClickHandler } from '../lib/notifications.js'
import { startNotificationPoller } from '../lib/notificationPoller.js'
import { saveSession, getSession, clearSession } from '../lib/session.js'
import { performAccountSwitch } from '../lib/accountSwitch.js'
import { log, getLogEntries, clearLog as clearLogEntries, exportLog as exportLogData } from '../lib/logger.js'
import { createRequestCoordinator, PROMPT_EVENT_PREFIX } from '../lib/background/requestCoordinator.js'

// ── In-memory state ──────────────────────────────────────────────
let nwcClient = null
let nwcNotifUnsub = null // NIP-47 notification subscription cleanup
let remoteSigner = null
let _cachedPassword = null // In-memory cache of session password
let rejectedOrigins = new Set() // Anti-spam: tracks rejected origins
let _nostrConnectAbort = null // AbortController for pending nostrconnect flow
let _accountSwitching = false // Guard against in-flight requests during account switch
const requestCoordinator = createRequestCoordinator()

// ── Error classification ─────────────────────────────────────────
/** Map raw errors to structured codes for the frontend. */
function classifyError(err) {
  const msg = err?.message || ''
  const lower = msg.toLowerCase()
  if (lower.includes('no wallet connected') || lower.includes('no wallet'))
    return 'NO_WALLET'
  if (lower.includes('not connected') || lower.includes('closed') || lower.includes('disconnect'))
    return 'WALLET_DISCONNECTED'
  if (lower.includes('timeout'))
    return 'TIMEOUT'
  if (lower.includes('wrong password'))
    return 'WRONG_PASSWORD'
  if (lower.includes('locked'))
    return 'LOCKED'
  if (lower.includes('permission denied'))
    return 'PERMISSION_DENIED'
  if (lower.includes('insufficient') || lower.includes('not enough'))
    return 'INSUFFICIENT_BALANCE'
  // Preserve original message for unclassified errors
  return msg || 'UNKNOWN_ERROR'
}

// ── Session restore (service worker wake-up) ─────────────────────
let _sessionLoadPromise = null

async function ensureSessionLoaded() {
  if (_cachedPassword !== null) return
  if (_sessionLoadPromise) return _sessionLoadPromise
  _sessionLoadPromise = (async () => {
    const session = await getSession()
    if (!session) {
      log.debug('session', 'NO_SESSION')
      return
    }
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
    requestCoordinator.register(requestId, resolve)

    // Store extra data so the prompt can display context
    requestCoordinator.setEventData(requestId, eventData).catch(err =>
      log.warn('permissions', 'SET_EVENT_DATA_FAILED', { requestId, err: err?.message })
    )

    // Build prompt URL with site metadata from the requesting tab
    const siteTitle = meta?.siteTitle || ''
    const siteFavicon = meta?.siteFavicon || ''
    const url = chrome.runtime.getURL(
      `/prompt.html?requestId=${requestId}&host=${encodeURIComponent(host)}&method=${encodeURIComponent(method)}&kind=${kind ?? ''}&firstVisit=${firstVisit}&siteTitle=${encodeURIComponent(siteTitle)}&siteFavicon=${encodeURIComponent(siteFavicon)}`
    )

    // Dynamic sizing: taller for complex prompts
    const promptHeight = firstVisit ? 720 : (method === 'signEvent' || method === 'weblnSendPayment') ? 640 : 520
    openPromptWindow(url, { width: 420, height: promptHeight }).then((win) => {
      requestCoordinator.attachWindowClose(requestId, win, false)
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
  } catch (err) {
    log.warn('nip46', 'RECONNECT_FAILED', { err: err?.message })
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
    await pendingUnlock
    // Re-check actual state — don't trust the promise value alone
    if (!isUnlocked()) throw new Error('Extension is locked')
    return
  }

  // Open unlock prompt and wait
  const promise = new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    requestCoordinator.register(requestId, resolve)

    const originParam = origin ? `&origin=${encodeURIComponent(origin)}` : ''
    const url = chrome.runtime.getURL(
      `/prompt.html?requestId=${requestId}&mode=unlock${originParam}`
    )

    openPromptWindow(url, { width: 400, height: 440 }).then((win) => {
      requestCoordinator.attachWindowClose(requestId, win, false)
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

// ── Bolt11 invoice helpers ───────────────────────────────────────
/**
 * Decode a BOLT-11 invoice via nostr-core.
 * Returns the full decoded object or null on failure.
 */
function safeDecode11(invoice) {
  if (!invoice || typeof invoice !== 'string') return null
  try { return decodeBolt11(invoice) } catch { return null }
}

/** Extract amount in sats from a bolt11 invoice string. Returns null if unknown. */
function parseBolt11Amount(invoice) {
  const decoded = safeDecode11(invoice)
  return decoded?.amountSat ?? null
}

// ── NWC lifecycle helpers ────────────────────────────────────────
/** Safely tear down current NWC client — unsub first, then close. */
function teardownNwc() {
  if (nwcNotifUnsub) { try { nwcNotifUnsub() } catch (e) { log.debug('cleanup', 'nwc-unsub', { err: e?.message }) } nwcNotifUnsub = null }
  if (nwcClient) { try { nwcClient.close() } catch (e) { log.debug('cleanup', 'nwc-close', { err: e?.message }) } nwcClient = null }
}

// ── Unified wallet router (NWC or Cashu) ────────────────────────

async function getActiveWalletType() {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) return null
  return wallet.type || 'nwc'
}

/**
 * After a Cashu proof mutation, publish updated token state to relays and record history.
 * Publishes current proofs as a new token event, records history with token event ID,
 * and optionally deletes old token events for spent proofs.
 */
async function syncCashuToRelays(wallet, direction, amountSats, oldTokenEventIds) {
  try {
    const account = await getActiveAccount(_cachedPassword)
    if (!account?.secretHex) return
    const secretKey = hexToBytes(account.secretHex)
    const mintUrl = getCashuMint(wallet)

    // Publish current proof state as a new token event
    const currentProofs = await getCashuProofs(wallet.id, _cachedPassword)
    const tokenEventId = currentProofs.length > 0
      ? await publishTokenEvent(secretKey, mintUrl, currentProofs, account.pubkey, oldTokenEventIds || [])
      : null

    // Record history with the new token event ID
    const tokenIds = tokenEventId ? [tokenEventId] : []
    await publishHistoryEvent(secretKey, direction, amountSats, tokenIds, account.pubkey)

    // Delete old spent token events from relays
    if (oldTokenEventIds?.length > 0) {
      await deleteTokenEvents(secretKey, oldTokenEventIds, account.pubkey)
    }
  } catch (err) {
    log.warn('cashu', 'RELAY_SYNC_FAILED', { direction, err: err?.message })
  }
}

function getCashuMint(wallet) {
  if (!wallet.mints?.length) throw new Error('No mint configured for this wallet')
  return wallet.mints[0]
}

async function walletPayInvoice(invoice, amountSats) {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) throw new Error('No wallet connected')
  if (wallet.type === 'cashu') {
    const mintUrl = getCashuMint(wallet)
    const amount = amountSats || 0

    // Record pending tx BEFORE attempting payment
    const txId = await recordCashuTx(wallet.id, {
      direction: 'out', amount, description: 'Lightning payment', state: 'pending',
    })

    try {
      const result = await meltTokens(mintUrl, invoice, wallet.id, _cachedPassword)
      // Mark settled on success
      await updateCashuTx(wallet.id, txId, { state: 'settled' }).catch(err =>
        log.warn('cashu', 'TX_UPDATE_FAILED', { txId, err: err?.message })
      )
      // Sync proof state to relays (fire-and-forget)
      syncCashuToRelays(wallet, 'out', amount).catch(err =>
        log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
      )
      return result
    } catch (err) {
      // Mark failed so user sees it in history
      await updateCashuTx(wallet.id, txId, { state: 'failed' }).catch(updErr =>
        log.warn('cashu', 'TX_UPDATE_FAILED', { txId, err: updErr?.message })
      )
      throw err
    }
  }
  return await withNwcRetry(nwc => nwc.payInvoice(invoice, amountSats ? amountSats * 1000 : undefined))
}

async function walletMakeInvoice(amountSats, description) {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) throw new Error('No wallet connected')
  if (wallet.type === 'cashu') {
    const mintUrl = getCashuMint(wallet)
    const q = await createMintQuote(mintUrl, amountSats)
    return { invoice: q.request, quoteId: q.quote, expiry: q.expiry }
  }
  const nwc = await ensureNWC()
  return await nwc.makeInvoice({ amount: amountSats * 1000, description: description || '' })
}

async function walletGetBalance() {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) return 0
  if (wallet.type === 'cashu') return await getCashuBalance(wallet.id, _cachedPassword)
  const nwc = await ensureNWC()
  return Math.floor((await nwc.getBalance()).balance / 1000)
}

// ── NWC / WebLN Handlers ─────────────────────────────────────────
async function ensureNWC() {
  if (_accountSwitching) throw new Error('Account switch in progress')
  if (nwcClient?.connected) return nwcClient
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet?.connectionUri) throw new Error('No wallet connected')
  teardownNwc()
  nwcClient = new NWC(wallet.connectionUri)
  await nwcClient.connect()
  subscribeNwcNotifications()
  return nwcClient
}

/**
 * Check if an error looks like a transient connection failure.
 */
function isConnectionError(err) {
  const msg = err?.message?.toLowerCase() || ''
  return msg.includes('closed') || msg.includes('disconnect')
    || msg.includes('timeout') || msg.includes('not connected')
}

/**
 * Execute an NWC operation with automatic reconnect on connection failure.
 * Retries once with a 1s backoff on transient errors.
 */
async function withNwcRetry(operation) {
  try {
    const nwc = await ensureNWC()
    return await operation(nwc)
  } catch (err) {
    if (!isConnectionError(err)) throw err

    log.info('wallet', 'NWC_RETRY', { err: err?.message })
    teardownNwc()
    await new Promise(r => setTimeout(r, 1000))
    const nwc = await ensureNWC()
    return await operation(nwc)
  }
}

/**
 * Subscribe to NIP-47 wallet notifications (payment_received, payment_sent).
 * Triggers browser notifications via lib/notifications.js.
 */
function subscribeNwcNotifications() {
  if (!nwcClient) return
  // Always clean up previous subscription before creating new one
  if (nwcNotifUnsub) {
    try { nwcNotifUnsub() } catch { /* best-effort */ }
    nwcNotifUnsub = null
  }
  const client = nwcClient // Capture reference to detect stale callbacks
  try {
    client.on('payment_received', (notification) => {
      if (client !== nwcClient) return // Stale subscription — ignore
      const amountSats = notification?.amount ? Math.floor(notification.amount / 1000) : 0
      const hash = notification?.payment_hash || ''
      if (amountSats > 0) {
        notifyPayment(amountSats, hash)
      }
    })
    client.on('payment_sent', () => {
      // Could notify on outgoing payments too — currently a no-op
    })
    nwcNotifUnsub = () => {
      try {
        client.off('payment_received')
        client.off('payment_sent')
      } catch { /* cleanup best-effort */ }
    }
  } catch (err) {
    log.info('wallet', 'NOTIF_SUB_UNSUPPORTED', { err: err?.message })
  }
}

async function handleWeblnEnable(sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)
  const allowed = await requestPermission(host, 'weblnEnable', null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const wType = await getActiveWalletType()
    if (wType === 'cashu') return { result: { enabled: true } }
    await ensureNWC()
    return { result: { enabled: true } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnGetInfo(sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try {
    const wType = await getActiveWalletType()
    if (wType === 'cashu') {
      const w = await getActiveWallet(_cachedPassword)
      return { result: { alias: w?.name || 'Buho', methods: ['pay_invoice', 'make_invoice', 'get_balance', 'pay_keysend'] } }
    }
    const nwc = await ensureNWC()
    return { result: await nwc.getInfo() }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnSendPayment(params, sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)

  const invoice = params[0]
  const amountSats = parseBolt11Amount(invoice)
  if (amountSats && await checkBudget(host, amountSats)) {
    try {
      const result = await walletPayInvoice(invoice, amountSats)
      await recordSpend(host, amountSats)
      return { result: { preimage: result.preimage } }
    } catch (err) { return { error: classifyError(err) } }
  }

  const allowance = await getAllowance(host)
  const paymentMeta = { amountSats, budgetSats: allowance?.budget || null, spentSats: allowance?.spent || 0 }
  const allowed = await requestPermission(host, 'weblnSendPayment', null, paymentMeta, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const result = await walletPayInvoice(invoice, amountSats)
    if (amountSats) await recordSpend(host, amountSats)
    return { result: { preimage: result.preimage } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnMakeInvoice(params, sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try {
    const args = params[0]
    const amount = typeof args === 'number' ? args : args?.amount
    const description = typeof args === 'object' ? args?.defaultMemo || '' : ''
    const inv = await walletMakeInvoice(amount, description)
    return { result: { paymentRequest: inv.invoice } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnGetBalance(sender) {
  const host = sender?.url ? new URL(sender.url).hostname : null
  await requireUnlocked(host)
  try {
    const balance = await walletGetBalance()
    return { result: { balance } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnKeysend(params, sender) {
  const host = new URL(sender.url).hostname
  await requireUnlocked(host)

  const args = params[0] || {}
  const { destination, amount, customRecords } = args
  if (!destination || !amount) return { error: 'Missing destination or amount' }

  const amountSats = typeof amount === 'string' ? parseInt(amount, 10) : amount
  if (!amountSats || amountSats <= 0) return { error: 'Invalid amount' }

  // Permission check + budget (same flow as sendPayment)
  if (await checkBudget(host, amountSats)) {
    try {
      const result = await walletKeysend(destination, amountSats, customRecords)
      await recordSpend(host, amountSats)
      return { result }
    } catch (err) { return { error: classifyError(err) } }
  }

  const allowance = await getAllowance(host)
  const paymentMeta = { amountSats, budgetSats: allowance?.budget || null, spentSats: allowance?.spent || 0 }
  const allowed = await requestPermission(host, 'weblnKeysend', null, paymentMeta, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const result = await walletKeysend(destination, amountSats, customRecords)
    await recordSpend(host, amountSats)
    return { result }
  } catch (err) { return { error: classifyError(err) } }
}

async function walletKeysend(destination, amountSats, customRecords) {
  const wType = await getActiveWalletType()
  if (wType === 'cashu') {
    throw new Error('Keysend is not supported with Cashu wallets')
  }
  const nwc = await ensureNWC()
  // Convert WebLN customRecords (string keys → int, string values) to NWC tlv_records
  const tlvRecords = customRecords
    ? Object.entries(customRecords).map(([k, v]) => ({
        type: parseInt(k, 10),
        value: v,
      }))
    : undefined
  return await nwc.payKeysend({
    pubkey: destination,
    amount: amountSats * 1000, // sats → msats
    tlv_records: tlvRecords,
  })
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
  WEBLN_KEYSEND: (params, sender) => handleWeblnKeysend(params, sender),
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

// ── NIP-46 reconnection state (visible to popup) ────────────────
let nip46Reconnecting = false
let nip46LastError = null // Last NostrConnect error (polled by popup via GET_NIP46_STATUS)

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
  } catch (err) {
    log.warn('nip46', 'PROACTIVE_RECONNECT_FAILED', { err: err?.message })
    remoteSigner = null
  } finally {
    nip46Reconnecting = false
  }
}

export default defineBackground(() => {
  // Sweep stale prompt_event_* entries from previous sessions
  chrome.storage.local.get(null).then((all) => {
    const staleKeys = Object.keys(all).filter(k => k.startsWith(PROMPT_EVENT_PREFIX))
    if (staleKeys.length) chrome.storage.local.remove(staleKeys)
  })

  // Startup integrity check — verify encrypted stores can be read
  ensureSessionLoaded().then(async () => {
    if (!_cachedPassword) return
    try {
      await getActiveAccount(_cachedPassword)
    } catch (err) {
      log.error('startup', 'ACCOUNTS_INTEGRITY_FAILED', { err: err?.message })
    }
    try {
      await getActiveWallet(_cachedPassword)
    } catch (err) {
      log.error('startup', 'WALLETS_INTEGRITY_FAILED', { err: err?.message })
    }
  })

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
    } catch (err) { log.debug('relay', 'AUTH_FAILED', { err: err?.message }) }
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
            teardownNwc()
            teardownCashu()
            if (remoteSigner) { try { remoteSigner.close() } catch {} remoteSigner = null }
            return { result: { ok: true } }
          case 'CHANGE_PASSWORD': {
            const [oldPw, newPw] = params || []
            // Verify old password first
            const valid = await verifyPassword(oldPw)
            if (!valid) return { error: 'WRONG_PASSWORD' }
            // Re-encrypt data BEFORE updating the password hash.
            // If re-encryption fails, data stays accessible with the old password.
            // Collect Cashu wallet IDs BEFORE re-encryption (using old password)
            const cashuWalletIds = (await getWalletSummaries(oldPw))
              .filter(w => w.type === 'cashu').map(w => w.id)
            await reEncryptAccounts(oldPw, newPw)
            await reEncryptWallets(oldPw, newPw)
            // Re-encrypt Cashu proof stores (still encrypted with old password)
            for (const wId of cashuWalletIds) {
              await reEncryptProofStore(wId, oldPw, newPw)
            }
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

          // ── Connection status ──
          case 'GET_NWC_STATUS':
            return { result: { connected: !!nwcClient?.connected } }

          // ── NIP-46 status ──
          case 'GET_NIP46_STATUS': {
            const status = {
              connected: !!remoteSigner?.connected,
              reconnecting: nip46Reconnecting,
            }
            if (nip46LastError) {
              status.error = nip46LastError
              nip46LastError = null // Clear after reading (one-shot)
            }
            return { result: status }
          }

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
            _accountSwitching = true
            try {
              teardownCashu()
              const cleaned = await performAccountSwitch(params?.[0], {
                nwcClient, nwcNotifUnsub, remoteSigner,
              })
              nwcClient = cleaned.nwcClient
              nwcNotifUnsub = cleaned.nwcNotifUnsub
              remoteSigner = cleaned.remoteSigner
              return { result: { switched: true } }
            } finally {
              _accountSwitching = false
            }
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
            // Track export for backup reminder
            await chrome.storage.local.set({ [`backupExported_${acct.id}`]: Date.now() })
            return { result: { nsec: nip19.nsecEncode(hexToBytes(acct.secretHex)) } }
          }
          case 'CHECK_BACKUP_STATUS': {
            const acct = await getActiveAccount(_cachedPassword)
            if (!acct) return { result: { needsBackup: false } }
            const key = `backupExported_${acct.id}`
            const data = await chrome.storage.local.get(key)
            const exported = data[key]
            // Remind if local account older than 7 days and never exported
            const ageMs = Date.now() - (acct.createdAt * 1000)
            const needsBackup = acct.mode === 'local' && !exported && ageMs > 7 * 24 * 60 * 60 * 1000
            return { result: { needsBackup } }
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
              try { await removeAccount(_cachedPassword, accountId) } catch (e) { log.warn('nip46', 'CLEANUP_FAILED', { err: e?.message }) }
              const msg = err.message || ''
              if (/already.connect/i.test(msg)) {
                return { error: 'Session already active on signer. Please generate a new bunker URI from your signer app.' }
              }
              return { error: classifyError(err) }
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
              nip46LastError = null
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
                } catch { /* profile fetch is non-critical */ }
                await updateAccount(_cachedPassword, accountId, updates)
                await setActiveAccount(accountId)
              }).catch((err) => {
                _nostrConnectAbort = null
                // Only set error if not a user-initiated abort
                if (err?.name !== 'AbortError') {
                  nip46LastError = err?.message || 'Connection failed'
                }
              }).finally(() => {
                nip46Reconnecting = false
              })
              return { result: { uri, secret } }
            } catch (err) {
              nip46Reconnecting = false
              return { error: classifyError(err) }
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
            teardownNwc()
            try { await ensureNWC(); return { result: { connected: true } } }
            catch (err) { return { error: classifyError(err) } }
          }
          case 'DISCONNECT_WALLET': {
            const [walletId] = params || []
            teardownNwc()
            teardownCashu()
            if (walletId) {
              // Clean up Cashu proof store if it was a Cashu wallet
              const store = await getWalletSummaries(_cachedPassword)
              const w = store.find(s => s.id === walletId)
              if (w?.type === 'cashu') {
                await clearProofStore(walletId)
                await clearCashuTxHistory(walletId)
              }
              await removeWallet(walletId, _cachedPassword)
            } else {
              await clearAllWallets()
            }
            // Reconnect to next active wallet if one exists
            try {
              const next = await getActiveWallet(_cachedPassword)
              if (next?.type === 'nwc') await ensureNWC()
            } catch { /* no wallet left — fine */ }
            return { result: { disconnected: true } }
          }
          case 'GET_WALLET_STATUS': {
            const wallet = await getActiveWallet(_cachedPassword)
            try {
              if (wallet?.type === 'cashu') {
                const balance = await getCashuBalance(wallet.id, _cachedPassword)
                return { result: {
                  connected: true,
                  balance,
                  activeWallet: { id: wallet.id, name: wallet.name, type: 'cashu' },
                } }
              }
              if (wallet?.connectionUri) {
                const nwc = await ensureNWC()
                const bal = await nwc.getBalance()
                return { result: {
                  connected: true,
                  balance: Math.floor(bal.balance / 1000),
                  activeWallet: { id: wallet.id, name: wallet.name, type: 'nwc' },
                } }
              }
            } catch (err) { log.debug('wallet', 'STATUS_CHECK_FAILED', { err: err?.message }) }
            return { result: { connected: false, balance: null, activeWallet: null } }
          }
          case 'GET_WALLETS': {
            const summaries = await getWalletSummaries(_cachedPassword)
            return { result: summaries }
          }
          case 'SWITCH_WALLET': {
            const [switchId] = params || []
            teardownNwc()
            teardownCashu()
            await setActiveWallet(switchId, _cachedPassword)
            try {
              const balance = await walletGetBalance()
              return { result: { connected: true, balance } }
            } catch (err) { return { error: classifyError(err) } }
          }
          case 'RENAME_WALLET': {
            const [renameId, newName] = params || []
            await renameWallet(renameId, newName, _cachedPassword)
            return { result: { ok: true } }
          }
          case 'WALLET_GET_INFO': {
            const wType = await getActiveWalletType()
            if (wType === 'cashu') {
              const w = await getActiveWallet(_cachedPassword)
              return { result: { alias: w.name, methods: ['pay_invoice', 'make_invoice', 'get_balance'] } }
            }
            const nwc = await ensureNWC()
            const info = await nwc.getInfo()
            return { result: info }
          }
          case 'WALLET_GET_BALANCE': {
            const balance = await walletGetBalance()
            return { result: { balance } }
          }
          case 'WALLET_GET_BUDGET': {
            const wType = await getActiveWalletType()
            if (wType === 'cashu') return { result: null } // no budget concept
            const nwc = await ensureNWC()
            const budget = await nwc.getBudget()
            return { result: budget }
          }
          case 'WALLET_PAY_INVOICE': {
            const [invoice, amountSats] = params || []
            const payResult = await walletPayInvoice(invoice, amountSats)
            return { result: payResult }
          }
          case 'WALLET_MAKE_INVOICE': {
            const [amountSats, description] = params || []
            const inv = await walletMakeInvoice(amountSats, description)
            return { result: inv }
          }
          case 'WALLET_LOOKUP_INVOICE': {
            const [lookupParams] = params || []
            const wType = await getActiveWalletType()
            if (wType === 'cashu' && lookupParams?.quoteId) {
              const w = await getActiveWallet(_cachedPassword)
              return { result: await checkMintQuote(getCashuMint(w), lookupParams.quoteId) }
            }
            const nwc = await ensureNWC()
            const inv = await nwc.lookupInvoice(lookupParams)
            return { result: inv }
          }
          case 'WALLET_LIST_TRANSACTIONS': {
            const [txParams] = params || []
            const wType = await getActiveWalletType()
            if (wType === 'cashu') {
              const w = await getActiveWallet(_cachedPassword)
              return { result: await getCashuTransactions(w.id, txParams || {}) }
            }
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

          // ── Cashu-specific handlers ──
          case 'AUTO_CREATE_CASHU_WALLET': {
            const store = await getWalletSummaries(_cachedPassword)
            if (store.some(w => w.type === 'cashu')) return { result: { skipped: true } }
            const walletId = await addCashuWallet(DEFAULT_WALLET_NAME, [DEFAULT_MINT], _cachedPassword)
            // Publish wallet event to relays (non-blocking)
            const account = await getActiveAccount(_cachedPassword)
            if (account?.secretHex) {
              const walletPrivkey = bytesToHex(randomBytes(32))
              publishWalletEvent(
                hexToBytes(account.secretHex), walletPrivkey, [DEFAULT_MINT], account.pubkey,
              ).catch(err => log.warn('cashu', 'WALLET_EVENT_PUBLISH_FAILED', { err: err?.message }))
            }
            log.info('cashu', 'AUTO_CREATED', { walletId })
            return { result: { walletId } }
          }
          case 'CASHU_MINT_TOKENS': {
            const [mintUrl, amountSats, quoteId] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const result = await mintTokens(mintUrl, amountSats, quoteId, wallet.id, _cachedPassword)
            await recordCashuTx(wallet.id, {
              direction: 'in', amount: result.amountSats, description: 'Received via Lightning', state: 'settled',
            }).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'in', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            return { result: { amountSats: result.amountSats } }
          }
          case 'CASHU_CHECK_MINT_QUOTE': {
            const [mintUrl, quoteId] = params || []
            const result = await checkMintQuote(mintUrl, quoteId)
            return { result }
          }
          case 'CASHU_CREATE_TOKEN': {
            const [amountSats, memo] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const result = await createEcashToken(getCashuMint(wallet), amountSats, wallet.id, _cachedPassword, memo)
            await recordCashuTx(wallet.id, {
              direction: 'out', amount: result.amountSats, description: memo || 'Sent token', state: 'settled',
            }).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'out', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            return { result }
          }
          case 'CASHU_RECEIVE_TOKEN': {
            const [tokenStr] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const result = await receiveEcashToken(tokenStr, wallet.id, _cachedPassword)
            await recordCashuTx(wallet.id, {
              direction: 'in', amount: result.amountSats, description: 'Redeemed token', state: 'settled',
            }).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'in', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            return { result }
          }
          case 'CASHU_GET_MINT_INFO': {
            const [mintUrl] = params || []
            const info = await getMintInfo(mintUrl)
            return { result: info }
          }
          case 'CASHU_EXPORT_BACKUP': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const backup = await exportCashuBackup(wallet.id, _cachedPassword)
            return { result: backup }
          }
          case 'CASHU_IMPORT_BACKUP': {
            const [encryptedData] = params || []
            const parsed = await importCashuBackup(encryptedData, _cachedPassword)
            // Merge imported proofs into active wallet
            const wallet = await getActiveWallet(_cachedPassword)
            if (wallet?.type === 'cashu') {
              await addCashuProofs(wallet.id, parsed.proofs, _cachedPassword)
            }
            return { result: { imported: parsed.proofs.length, mints: parsed.mints } }
          }
          case 'CASHU_RESTORE_FROM_RELAY': {
            const account = await getActiveAccount(_cachedPassword)
            if (!account?.secretHex) return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const restored = await restoreFromRelays(hexToBytes(account.secretHex), account.pubkey)
            const wallet = await getActiveWallet(_cachedPassword)
            if (wallet?.type === 'cashu' && restored.proofs.length > 0) {
              await addCashuProofs(wallet.id, restored.proofs, _cachedPassword)
            }
            return { result: { proofCount: restored.proofs.length, mints: restored.walletData?.mints || [] } }
          }
          case 'CASHU_UPDATE_MINTS': {
            const [walletId, mints] = params || []
            await updateCashuMints(walletId, mints, _cachedPassword)
            return { result: { ok: true } }
          }

          // ── Zaps (NIP-57) ──
          case 'SEND_ZAP': {
            const { recipientPubkey, amountSats, lightningAddress, content } = params?.[0] || {}
            if (!lightningAddress || !amountSats) return { error: 'Missing zap parameters' }
            const account = await getActiveAccount(_cachedPassword)
            const amountMsats = amountSats * 1000

            // Try NIP-57 for local accounts
            if (account?.secretHex) {
              try {
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

                  const payResult = await walletPayInvoice(invoice, amountSats)
                  return { result: { preimage: payResult.preimage, nip57: true } }
                }
              } catch (err) { log.info('zap', 'NIP57_FALLBACK', { err: err?.message }) }
            }

            // Fallback: plain Lightning Address payment
            try {
              const inv = await fetchInvoice(lightningAddress, amountSats)
              const payResult = await walletPayInvoice(inv.invoice, amountSats)
              return { result: { preimage: payResult.preimage, nip57: false } }
            } catch (err) {
              return { error: classifyError(err) }
            }
          }

          // ── LNURL-withdraw (LUD-03) ──
          case 'LNURL_FETCH_WITHDRAW': {
            const [input] = params || []
            if (!input) return { error: 'No LNURL input provided' }
            try {
              const withdrawParams = await fetchLnurlWithdrawParams(input)
              return { result: withdrawParams }
            } catch (err) {
              return { error: classifyError(err) }
            }
          }
          case 'LNURL_EXECUTE_WITHDRAW': {
            const [withdrawParams, amountSats] = params || []
            if (!withdrawParams || !amountSats) return { error: 'Missing parameters' }
            try {
              // Generate an invoice from our wallet for the service to pay
              const invoiceResult = await walletMakeInvoice(amountSats, withdrawParams.defaultDescription || 'LNURL Withdraw')
              const invoice = invoiceResult.invoice || invoiceResult.request
              if (!invoice) throw new Error('Failed to create invoice')
              // Submit invoice to the LNURL service
              await executeLnurlWithdraw(withdrawParams, invoice)
              return { result: { invoice, amountSats } }
            } catch (err) {
              return { error: classifyError(err) }
            }
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

          // ── HTTP Auth (NIP-98) ──
          case 'SIGN_HTTP_AUTH': {
            const [url, method] = params || []
            if (!url || !method) return { error: 'Missing URL or method' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)
            const authEvent = createHttpAuthEvent({ url, method }, secretKey)
            const header = getAuthorizationHeader(authEvent)
            return { result: { header, event: authEvent } }
          }

          // ── Reports (NIP-56) ──
          case 'REPORT_EVENT': {
            const [targetEventId, targetPubkey, reportType, reason] = params || []
            if (!targetPubkey) return { error: 'No target' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)
            const targets = [{ type: reportType || 'spam', pubkey: targetPubkey }]
            if (targetEventId) targets[0].eventId = targetEventId
            const { createReportEvent } = await import('nostr-core')
            const report = createReportEvent(targets, secretKey, reason || '')
            const relays = await getPoolRelays(account.pubkey, 'account')
            const pool = getPool()
            await Promise.allSettled(relays.map(url => pool.publish([url], report)))
            return { result: { reported: true } }
          }

          // ── Reactions (NIP-25) ──
          case 'SEND_REACTION': {
            const [targetEventId, targetPubkey, emoji] = params || []
            if (!targetEventId) return { error: 'No target event' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)
            const reaction = createReactionEvent(
              { targetEventId, targetPubkey, reaction: emoji || '+' },
              secretKey
            )
            const relays = await getPoolRelays(account.pubkey, 'account')
            const pool = getPool()
            await Promise.allSettled(relays.map(url => pool.publish([url], reaction)))
            return { result: { sent: true } }
          }

          // ── Event deletion (NIP-09) ──
          case 'DELETE_EVENT': {
            const [eventId, reason] = params || []
            if (!eventId) return { error: 'No event ID' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)
            const deletion = nip09.createDeletionEvent(
              { eventIds: [eventId], reason: reason || '' },
              secretKey
            )
            const relays = await getPoolRelays(account.pubkey, 'account')
            const pool = getPool()
            await Promise.allSettled(relays.map(url => pool.publish([url], deletion)))
            return { result: { deleted: true, eventId } }
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

          // ── Debug log ──
          case 'GET_DEBUG_LOG':
            return { result: await getLogEntries() }
          case 'CLEAR_DEBUG_LOG':
            await clearLogEntries()
            return { result: { ok: true } }
          case 'EXPORT_DEBUG_LOG':
            return { result: await exportLogData() }

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
            if (!requestCoordinator.has(unlockReqId)) return { error: 'Unknown request' }
            try {
              const valid = await verifyPassword(password)
              if (!valid) return { error: 'WRONG_PASSWORD' }
              _cachedPassword = password
              await saveSession({ password, unlockedAt: Date.now() })
              rejectedOrigins.clear()
              await requestCoordinator.resolve(unlockReqId, true)
              return { result: { ok: true } }
            } catch (err) {
              return { error: classifyError(err) }
            }
          }

          // ── Permission prompt response ──
          case 'PERMISSION_RESPONSE': {
            const { requestId, decision, host, method, kind, setBudget } = params?.[0] || {}
            if (!requestCoordinator.has(requestId)) return { error: 'Unknown request' }
            // Clean up stored event data
            await requestCoordinator.clearEventData(requestId)
            const activeId = await getActiveAccountId()

            if (decision === 'allow_all') {
              // Grant all standard permissions for this host (never includes weblnSendPayment)
              for (const m of ALL_PERMISSION_METHODS) {
                await setPermission(host, m, 'allow', null, activeId)
              }
              await requestCoordinator.resolve(requestId, true)
            } else if (decision === 'deny_all') {
              // Block all methods for this host
              for (const m of [...ALL_PERMISSION_METHODS, 'weblnSendPayment']) {
                await setPermission(host, m, 'deny', null, activeId)
              }
              await requestCoordinator.resolve(requestId, false)
            } else if (decision === 'allow_always' || decision === 'deny_always') {
              await setPermission(host, method, decision === 'allow_always' ? 'allow' : 'deny', kind || null, activeId)
              await requestCoordinator.resolve(requestId, decision === 'allow_always')
            } else {
              await requestCoordinator.resolve(requestId, decision === 'allow_once')
            }

            // Set budget if user opted in during payment approval
            if (setBudget && setBudget > 0 && host && decision.startsWith('allow')) {
              try {
                await setAllowance(host, { budget: setBudget, spent: 0 })
                log.info('permissions', 'BUDGET_SET_FROM_PROMPT', { host, budget: setBudget })
              } catch (err) {
                log.warn('permissions', 'BUDGET_SET_FAILED', { host, err: err?.message })
              }
            }

            return { result: { ok: true } }
          }

          default:
            return { error: `Unknown message type: ${type}` }
        }
      } catch (err) {
        log.error('background', type, { err: err?.message })
        return { error: classifyError(err) }
      }
    }

    handle()
      .then(sendResponse)
      .catch((err) => {
        log.error('background', 'UNHANDLED', { type, err: err?.message })
        sendResponse({ error: classifyError(err) })
      })
    return true
  })
})
