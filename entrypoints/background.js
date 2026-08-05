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

import { finalizeEvent, getPublicKey, hexToBytes, bytesToHex, randomBytes, nip19, nip42, nip57, nip59, nip09, createHttpAuthEvent, getAuthorizationHeader, NWC, createSecretKeySigner, fetchPayRequest, fetchInvoice, decodeBolt11 } from 'nostr-core'
import { validatePaymentInvoice } from '../lib/invoiceValidation.js'
import { withStorageRollback } from '../lib/storageTransaction.js'
import { mnemonicToSeedSync } from '@scure/bip39'
import {
  getActiveAccount,
  getActiveAccountForClient,
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
import { proveLightningLogin, submitLightningLogin } from '../lib/lightningAuth.js'
import {
  checkPermission,
  setPermission,
  getPermissions,
  removePermission,
  removeDomainPermissions,
  clearAllPermissions,
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
  reEncryptWallets, clearAllWallets, addCashuWallet,
  addCashuMint, bindCashuWalletOwner, setCashuWalletPrivkey,
  addLnbitsWallet, validateNwcConnectionUri,
} from '../lib/wallet.js'
import {
  lnbitsConnect, lnbitsGetBalance, lnbitsMakeInvoice,
  lnbitsPayInvoice, lnbitsCheckPayment, lnbitsListPayments,
  createLnbitsWs,
} from '../lib/lnbits.js'
import {
  getCashuBalance, getProofSets,
  getRelayEventIds, getRelayMintStates, setRelayEventIds, mergeCashuCounters,
  clearProofStore, reEncryptProofStore, readProofStore,
} from '../lib/cashu-store.js'
import {
  createMintQuote, checkMintQuote, waitForMintQuote, mintTokens, meltTokens,
  createEcashToken, receiveEcashToken, recoverExternalProofs,
  restoreDeterministicProofs, recoverPendingCashuProofs, hasVolatileCashuRecovery,
  resolvePendingCashuMelt, getMintInfo, teardownCashu,
} from '../lib/cashu-engine.js'
import {
  cashuRecoveryKey, clearCashuRecovery, hasCashuRecovery, reEncryptCashuRecovery,
} from '../lib/cashu-recovery.js'
import {
  cashuMeltJournalKey, clearCashuMeltJournal, hasCashuMeltJournal, readCashuMeltJournal,
  reEncryptCashuMeltJournal,
} from '../lib/cashu-melt-journal.js'
import {
  cashuMintJournalKey, clearCashuMintJournal, hasCashuMintJournal,
  listCashuMintQuotes, removeCashuMintQuote, reEncryptCashuMintJournal,
  saveCashuMintQuote,
} from '../lib/cashu-mint-journal.js'
import {
  publishWalletEvent, publishTokenEvent, publishHistoryEvent,
  deleteTokenEvents, restoreFromRelays,
  publishMintBackupEvent, fetchMintBackup,
} from '../lib/cashu-sync.js'
import { exportCashuBackup, importCashuBackup } from '../lib/cashu-backup.js'
import {
  buildPaymentRequest, makePaymentRequestId, decodePaymentRequestInfo,
  buildPaymentPayload, parsePaymentPayload, payloadToToken, looksLikePaymentPayload,
} from '../lib/cashu-payment-request.js'
import { getDecodedToken } from '@cashu/cashu-ts'
import { fetchLnurlWithdrawParams, executeLnurlWithdraw } from '../lib/lnurl.js'
import {
  recordCashuTx, updateCashuTx, getCashuTx, getCashuTransactions, clearCashuTxHistory,
  reEncryptCashuTxHistory,
} from '../lib/cashu-transactions.js'
import {
  saveTransactionMetadata,
  getTransactionMetadata,
  enrichTransactionsWithMetadata,
  removeWalletTransactionMetadataEverywhere,
  removeAccountTransactionMetadata,
  reEncryptTransactionMetadata,
  clearAllTransactionMetadata,
} from '../lib/transactionMetadata.js'
import { DEFAULT_MINT, DEFAULT_WALLET_NAME } from '../lib/cashu-constants.js'
import {
  getAllowances, getAllowance, setAllowance, setAllowanceEnabled,
  recordSpend, reserveSpend, refundSpend, removeAllowance, resetAllowanceSpend,
} from '../lib/allowances.js'
import { publishProfile, fetchProfile } from '../lib/profile.js'
import { discoverNip06Identities } from '../lib/nostrIdentity.js'
import {
  getRelayConfig, getPoolRelays, setPoolRelays,
  addRelay as addRelayToPool, removeRelay as removeRelayFromPool,
  resetPoolToDefaults, fetchNip65, fetchRelayInfo,
  createNip65Event, DEFAULT_ACCOUNT_RELAYS,
} from '../lib/relays.js'
import { getPool, setAuthHandler } from '../lib/relayPool.js'
import { connectBunker, createNostrConnectURI, awaitNostrConnect, parseConnectionURI } from '../lib/nip46-bridge.js'
import { openPromptWindow } from '../lib/browser/capabilities.js'
import { buildNutbitsDeepLink, rotateCallbackToken, verifyCallbackToken } from '../lib/nutbits.js'
import { notifyDm, notifyPayment, notifyBudgetSpend, setupNotificationClickHandler } from '../lib/notifications.js'
import { startNotificationPoller } from '../lib/notificationPoller.js'
import { saveSession, getSession, clearSession } from '../lib/session.js'
import { performAccountSwitch } from '../lib/accountSwitch.js'
import { log, getLogEntries, clearLog as clearLogEntries, exportLog as exportLogData } from '../lib/logger.js'
import { createRequestCoordinator, PROMPT_CONTEXT_PREFIX, PROMPT_EVENT_PREFIX } from '../lib/background/requestCoordinator.js'
import { createPermissionSession } from '../lib/background/permissionSession.js'
import { normalizeWebOrigin, requireSecureUrl } from '../lib/origins.js'
import { checkPasswordRateLimit, clearPasswordFailures, recordPasswordFailure } from '../lib/authRateLimit.js'
import {
  validateCryptoPayload,
  validateInvoice,
  validateKeysend,
  validateSats,
  validateUnsignedEvent,
} from '../lib/background/publicRequestValidation.js'

// ── In-memory state ──────────────────────────────────────────────
let nwcClient = null
let nwcNotifUnsub = null // NIP-47 notification subscription cleanup
// Gift-wrap event ids already redeemed as payment-request payments. Bounded;
// after a worker restart the proof store still rejects double redemption.
const processedRequestPayments = new Set()
let lnbitsWsHandle = null // LNbits WebSocket handle (from createLnbitsWs)
let remoteSigner = null
let remoteSignerAccountId = null
let _cachedPassword = null // In-memory cache of session password
let rejectedOrigins = new Set() // Anti-spam: tracks rejected origins
let _nostrConnectAbort = null // AbortController for pending nostrconnect flow
let _accountSwitching = false // Guard against in-flight requests during account switch
const requestCoordinator = createRequestCoordinator()
const permissionSession = createPermissionSession()
const BACKUP_CHALLENGE_PREFIX = 'backup_challenge_'

async function createBackupChallenge(account, backupValue, kind) {
  const token = crypto.randomUUID()
  let challenge
  let expected
  if (kind === 'mnemonic') {
    const words = backupValue.split(' ')
    const indices = new Set()
    while (indices.size < Math.min(3, words.length)) {
      indices.add(randomBytes(1)[0] % words.length)
    }
    const ordered = [...indices].sort((a, b) => a - b)
    challenge = { type: 'words', indices: ordered }
    expected = ordered.map(index => words[index].toLowerCase())
  } else {
    challenge = { type: 'suffix', length: 6 }
    expected = [backupValue.slice(-6).toLowerCase()]
  }
  await chrome.storage.session.set({
    [`${BACKUP_CHALLENGE_PREFIX}${token}`]: {
      accountId: account.id,
      expected,
      expiresAt: Date.now() + 10 * 60 * 1000,
    },
  })
  return { token, ...challenge }
}

async function confirmBackupChallenge(accountId, token, answers) {
  if (!accountId || !token || !Array.isArray(answers)) return false
  const key = `${BACKUP_CHALLENGE_PREFIX}${token}`
  const data = await chrome.storage.session.get(key)
  await chrome.storage.session.remove(key)
  const challenge = data[key]
  if (!challenge || challenge.accountId !== accountId || Date.now() > challenge.expiresAt) return false
  const clean = answers.map(value => String(value || '').trim().toLowerCase())
  if (clean.length !== challenge.expected.length) return false
  let difference = 0
  for (let index = 0; index < clean.length; index++) {
    const actual = new TextEncoder().encode(clean[index])
    const expected = new TextEncoder().encode(challenge.expected[index])
    difference |= actual.length ^ expected.length
    for (let byte = 0; byte < Math.max(actual.length, expected.length); byte++) {
      difference |= (actual[byte] || 0) ^ (expected[byte] || 0)
    }
  }
  return difference === 0
}

// ── Error classification ─────────────────────────────────────────
/** Map raw errors to structured codes for the frontend. */
function classifyError(err) {
  if (err?.code === 'VAULT_INTEGRITY') return 'VAULT_INTEGRITY'
  if (err?.code === 'REQUEST_LIMIT') return 'REQUEST_LIMIT'
  if (err?.code === 'INVALID_REQUEST') return 'INVALID_REQUEST'
  if (err?.code === 'INVOICE_AMOUNT_REQUIRED') return 'INVOICE_AMOUNT_REQUIRED'
  if (err?.code === 'INVOICE_ALREADY_PAID') return 'INVOICE_ALREADY_PAID'
  if (err?.code === 'CASHU_RECOVERY_REQUIRED') return 'CASHU_RECOVERY_REQUIRED'
  if (err?.code === 'CASHU_STORAGE_FATAL') return 'CASHU_STORAGE_FATAL'
  if (err?.code === 'CASHU_PAYMENT_PENDING') return 'CASHU_PAYMENT_PENDING'
  if (err?.code === 'CASHU_INVOICE_PENDING') return 'CASHU_INVOICE_PENDING'
  if (err?.code === 'CASHU_RESTORE_CONFLICT') return 'CASHU_RESTORE_CONFLICT'
  if (err?.code === 'CASHU_MINT_BALANCE') return 'CASHU_MINT_BALANCE'
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

async function authenticateMasterPassword(password) {
  const limit = await checkPasswordRateLimit()
  if (!limit.allowed) return { valid: false, error: `TOO_MANY_ATTEMPTS:${limit.retryAfter}` }
  const valid = typeof password === 'string' && await verifyPassword(password)
  if (valid) {
    await clearPasswordFailures()
    return { valid: true, error: null }
  }
  const afterFailure = await recordPasswordFailure()
  return {
    valid: false,
    error: afterFailure.allowed ? 'WRONG_PASSWORD' : `TOO_MANY_ATTEMPTS:${afterFailure.retryAfter}`,
  }
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters'
  }
  if (password.length > 1024) return 'Password is too long'
  return null
}

function sanitizeProfileInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid profile')
  const text = (field, max) => typeof value[field] === 'string'
    ? Array.from(value[field].trim()).slice(0, max).join('')
    : ''
  const secureImage = (field) => {
    const candidate = text(field, 2048)
    if (!candidate) return ''
    try { return requireSecureUrl(candidate).toString() } catch { throw new Error(`${field} must use HTTPS`) }
  }
  const profile = {
    name: text('name', 80),
    display_name: text('display_name', 80),
    about: text('about', 1_000),
    picture: secureImage('picture'),
    banner: secureImage('banner'),
    nip05: text('nip05', 320),
    lud16: text('lud16', 320),
  }
  if (profile.nip05 && !/^[^\s@]+@[^\s@]+$/.test(profile.nip05)) throw new Error('Enter a valid NIP-05 address')
  if (profile.lud16 && !/^[^\s@]+@[^\s@]+$/.test(profile.lud16)) throw new Error('Enter a valid Lightning address')
  return profile
}

// ── Session restore (service worker wake-up) ─────────────────────
let _sessionLoadPromise = null

async function ensureSessionLoaded() {
  if (_sessionLoadPromise) return _sessionLoadPromise
  _sessionLoadPromise = (async () => {
    const session = await getSession()
    if (!session) {
      log.debug('session', 'NO_SESSION')
      if (_cachedPassword !== null) await clearUnlockedSessionState()
      return
    }
    // Check auto-lock expiry
    const { autoLockMinutes } = await chrome.storage.local.get('autoLockMinutes')
    const minutes = autoLockMinutes ?? 0
    if (minutes > 0) {
      const elapsed = (Date.now() - session.unlockedAt) / 1000 / 60
      if (elapsed >= minutes) {
        await clearUnlockedSessionState()
        return
      }
    }
    _cachedPassword = session.password
  })()
  try { await _sessionLoadPromise } finally { _sessionLoadPromise = null }
}

async function clearUnlockedSessionState() {
  _cachedPassword = null
  await clearSession()
  permissionSession.clear()
  await requestCoordinator.resolveWhere(
    () => true,
    false,
    { removeEventData: true, closePrompt: true },
  )
  teardownNwc()
  teardownCashu()
  teardownLnbitsWs()
  if (remoteSigner) { try { remoteSigner.close() } catch {} remoteSigner = null }
  remoteSignerAccountId = null
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

// Payment methods always require per-transaction approval — never auto-approve from stored perms
const PAYMENT_METHODS = ['weblnSendPayment', 'weblnKeysend']

async function requestPermission(origin, method, kind, eventData, meta) {
  const activeId = await getActiveAccountId()
  if (!activeId) return { allowed: false, profileId: null }
  const isPayment = PAYMENT_METHODS.includes(method)
  const scope = {
    profileId: activeId,
    tabId: meta?.tabId,
    origin,
    method,
    kind: method === 'signEvent' ? kind : null,
  }

  // Payment prompts always show — never auto-approve from stored perms
  if (!isPayment) {
    const existing = await checkPermission(origin, method, kind, activeId)
    if (existing === 'allow') return { allowed: true, profileId: activeId }
    if (existing === 'deny') return { allowed: false, profileId: activeId }
    if (permissionSession.hasGrant(scope)) return { allowed: true, profileId: activeId }
  }

  const allowed = await permissionSession.coalesce(scope, ({ queuedBehind = 0 } = {}) => {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      requestCoordinator.register(requestId, resolve, { ...scope, isPayment })

      Promise.all([
        requestCoordinator.setEventData(requestId, eventData),
        requestCoordinator.persistContext(requestId, { ...scope, isPayment, createdAt: Date.now() }),
      ]).then(() => {
        // Build prompt URL from trusted request context. The response contains
        // only the unguessable request id and the user's decision.
        const siteTitle = meta?.siteTitle || ''
        const siteFavicon = meta?.siteFavicon || ''
        const url = chrome.runtime.getURL(
          `/prompt.html?requestId=${requestId}&origin=${encodeURIComponent(origin)}&method=${encodeURIComponent(method)}&kind=${kind ?? ''}&profileId=${encodeURIComponent(activeId)}&siteTitle=${encodeURIComponent(siteTitle)}&siteFavicon=${encodeURIComponent(siteFavicon)}&queued=${queuedBehind}`
        )

        const isTallPrompt = method === 'signEvent' || isPayment
        const promptHeight = isTallPrompt ? 600 : 520
        return openPromptWindow(url, { width: 420, height: promptHeight })
      }).then((win) => {
        requestCoordinator.attachWindowClose(requestId, win, false)
      }).catch((err) => {
        log.warn('permissions', 'OPEN_PROMPT_FAILED', { requestId, err: err?.message })
        requestCoordinator.resolve(requestId, false, { removeEventData: true }).catch(() => {})
      })
    })
  })
  if (!allowed) permissionSession.cancelLane(scope)
  return { allowed: !!allowed, profileId: activeId }
}

// ── NIP-46 connection management ─────────────────────────────────
async function ensureRemoteSigner(accountId = null) {
  const expectedId = accountId || await getActiveAccountId()
  if (remoteSigner?.connected && remoteSignerAccountId === expectedId) return remoteSigner
  if (remoteSigner && remoteSignerAccountId !== expectedId) {
    try { await remoteSigner.disconnect?.() } catch {}
    remoteSigner = null
    remoteSignerAccountId = null
  }

  const account = (await getAccounts(_cachedPassword))[expectedId]
  if (!account || account.mode !== 'nip46') return null
  if (!account.nip46Session?.bunkerUri || !account.nip46ClientSecretHex) return null

  nip46Reconnecting = true
  try {
    remoteSigner = await connectBunker(
      account.nip46Session.bunkerUri,
      account.nip46ClientSecretHex
    )
    remoteSignerAccountId = expectedId
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
async function getSigner(accountId = null) {
  const expectedId = accountId || await getActiveAccountId()
  const account = (await getAccounts(_cachedPassword))[expectedId]
  if (!account) return null

  if (account.mode === 'local' && account.secretHex) {
    return createSecretKeySigner(hexToBytes(account.secretHex))
  }

  if (account.mode === 'nip46') {
    return ensureRemoteSigner(expectedId)
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
  const title = typeof sender?.tab?.title === 'string'
    ? Array.from(sender.tab.title).slice(0, 200).join('')
    : ''
  const favicon = (() => {
    const value = sender?.tab?.favIconUrl
    if (typeof value !== 'string' || value.length > 4096) return ''
    try {
      const url = new URL(value)
      return ['https:', 'data:'].includes(url.protocol) ? value : ''
    } catch { return '' }
  })()
  return {
    tabId: sender?.tab?.id,
    siteTitle: title,
    siteFavicon: favicon,
  }
}

function getSenderOrigin(sender) {
  const value = sender?.url || sender?.tab?.url || ''
  const origin = normalizeWebOrigin(value)
  if (!origin || !sender?.tab?.id) {
    const error = new Error('Request did not come from a supported website tab')
    error.code = 'INVALID_REQUEST'
    throw error
  }
  return origin
}

async function handleGetPublicKey(sender) {
  const origin = getSenderOrigin(sender)
  await requireUnlocked(origin)
  const { allowed, profileId } = await requestPermission(origin, 'getPublicKey', null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner(profileId)
  if (!signer) return { error: 'NO_SIGNER' }
  return { result: await signer.getPublicKey() }
}

async function handleSignEvent(params, sender) {
  const origin = getSenderOrigin(sender)
  await requireUnlocked(origin)
  const event = validateUnsignedEvent(params[0])
  const { allowed, profileId } = await requestPermission(origin, 'signEvent', event.kind, event, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner(profileId)
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
  const origin = getSenderOrigin(sender)
  await requireUnlocked(origin)
  const [pubkey, text] = validateCryptoPayload(params[0], params[1], { decrypt: type.endsWith('_DECRYPT') })
  const method = type.toLowerCase()
  const { allowed, profileId } = await requestPermission(origin, method, null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }

  const signer = await getSigner(profileId)
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

// ── LNbits WebSocket lifecycle ───────────────────────────────────

function teardownLnbitsWs() {
  if (lnbitsWsHandle) { lnbitsWsHandle.close(); lnbitsWsHandle = null }
}

/**
 * Connect LNbits WebSocket for real-time payment notifications.
 * Delegates connection management (reconnect, backoff) to lib/lnbits.js.
 */
function connectLnbitsWs(wallet) {
  teardownLnbitsWs()
  if (!wallet?.apiUrl || !wallet?.lnbitsWalletId) return
  lnbitsWsHandle = createLnbitsWs(
    wallet,
    (amountSats, hash) => notifyPayment(amountSats, hash),
    { log: (level, ...args) => log[level]?.(...args) },
  )
}

// ── Unified wallet router (NWC or Cashu) ────────────────────────

async function getActiveWalletType() {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) return null
  return wallet.type || 'nwc'
}

async function getCashuOwner(wallet) {
  const accounts = await getAccounts(_cachedPassword)
  let ownerId = wallet.ownerAccountId
  if (!ownerId || !accounts[ownerId]) {
    ownerId = await getActiveAccountId()
    if (!ownerId || !accounts[ownerId]) return null
    await bindCashuWalletOwner(wallet.id, ownerId, _cachedPassword)
    wallet.ownerAccountId = ownerId
  }
  return accounts[ownerId]
}

async function getCashuSeed(wallet) {
  const owner = await getCashuOwner(wallet)
  const mnemonic = owner?.identitySeed?.mnemonic
  return typeof mnemonic === 'string' && mnemonic ? mnemonicToSeedSync(mnemonic) : null
}

/**
 * Scan incoming NIP-17 gift wraps for NUT-18 payment payloads and redeem
 * them. Two modes:
 *   - live poll (requestId set): stop at the first relevant payment and
 *     return it, surfacing new-mint payments for user review.
 *   - sweep (redeemAll): redeem every payment from mints this wallet
 *     already uses; new-mint payments are left for the request screen.
 * Only mints the wallet already uses are contacted automatically.
 */
async function scanIncomingRequestPayments(wallet, owner, { requestId = null, redeemAll = false } = {}) {
  const secretKey = hexToBytes(owner.secretHex)
  const relays = await getPoolRelays(owner.pubkey, 'chat').catch(() => [])
  if (!relays.length) return { received: false }
  // Gift wraps randomize created_at up to two days back, so the filter
  // window must reach that far; the processed set and the proof store keep
  // replays out.
  const since = Math.floor(Date.now() / 1000) - 172_800
  const events = await getPool().querySync(
    relays,
    { kinds: [1059], '#p': [owner.pubkey], since },
    { maxWait: 8000 },
  )
  let redeemedTotal = 0
  let redeemedCount = 0
  for (const event of events) {
    if (processedRequestPayments.has(event.id)) continue
    let rumor
    try { rumor = nip59.unwrap(event, secretKey) } catch { continue }
    if (rumor?.kind !== 14 || !looksLikePaymentPayload(rumor.content)) continue
    const payload = parsePaymentPayload(rumor.content)
    if (!payload.valid) continue
    if (requestId && payload.id && payload.id !== requestId) continue
    // Never contact a mint this wallet does not use without the user
    // seeing it first.
    if (!(wallet.mints || []).includes(payload.mint)) {
      if (redeemAll) continue
      if (processedRequestPayments.size > 500) processedRequestPayments.clear()
      processedRequestPayments.add(event.id)
      return {
        received: true,
        needsReview: true,
        token: payloadToToken(payload),
        amountSats: payload.amountSats,
        mint: payload.mint,
        mintHost: payload.mintHost,
      }
    }
    if (processedRequestPayments.size > 500) processedRequestPayments.clear()
    processedRequestPayments.add(event.id)
    try {
      await recoverCashuState(wallet)
      const result = await receiveEcashToken(
        payloadToToken(payload),
        wallet.id,
        _cachedPassword,
        await getCashuSeed(wallet),
        wallet.cashuPrivkey,
      )
      await recordCashuTx(wallet.id, {
        direction: 'in', amount: result.amountSats,
        description: payload.memo || 'Payment request', state: 'settled',
      }, _cachedPassword).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
      syncCashuToRelays(wallet, 'in', result.amountSats).catch(err =>
        log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
      )
      redeemedTotal += result.amountSats
      redeemedCount += 1
      if (!redeemAll) return { received: true, amountSats: result.amountSats }
    } catch (err) {
      // Leave the event unprocessed so a later scan can retry.
      processedRequestPayments.delete(event.id)
      log.warn('cashu', 'REQUEST_PAYMENT_REDEEM_FAILED', { err: err?.message })
    }
  }
  return { received: redeemedCount > 0, count: redeemedCount, amountSats: redeemedTotal }
}

// Sweep at most every 5 minutes; the wallet-open status call triggers it.
let _lastRequestPaymentSweep = 0
function sweepRequestPaymentsSoon(wallet) {
  const now = Date.now()
  if (now - _lastRequestPaymentSweep < 300_000) return
  _lastRequestPaymentSweep = now
  getCashuOwner(wallet)
    .then(owner => owner?.secretHex
      ? scanIncomingRequestPayments(wallet, owner, { redeemAll: true })
      : null)
    .then(result => {
      if (result?.count > 0) {
        log.info('cashu', 'REQUEST_PAYMENTS_SWEPT', { count: result.count, amount: result.amountSats })
        // Notify only after the mint verified and we actually redeemed the
        // proofs, so the amount shown is real money, not a spoofable claim.
        notifyPayment(result.amountSats).catch(() => {})
      }
    })
    .catch(err => log.debug('cashu', 'REQUEST_SWEEP_FAILED', { err: err?.message }))
}

/**
 * Publish the NUT-27 mint list backup for this wallet (fire and forget).
 * Reads the wallet fresh so the just-updated mint list is what gets saved.
 */
async function syncMintBackup(wallet) {
  try {
    const owner = await getCashuOwner(wallet)
    const seed = await getCashuSeed(wallet)
    if (!owner?.pubkey || !seed) return
    const current = await getActiveWallet(_cachedPassword)
    if (!current || current.id !== wallet.id) return
    await publishMintBackupEvent(seed, current.mints || [], owner.pubkey)
  } catch (err) {
    log.warn('cashu', 'MINT_BACKUP_FAILED', { err: err?.message })
  }
}

async function getCashuMintCandidates(wallet, minimumSats = 0) {
  const sets = await getProofSets(wallet.id, _cachedPassword, getCashuMint(wallet))
  const balances = new Map(sets.map(set => [
    set.mint,
    set.proofs.reduce((sum, proof) => sum + proof.amount, 0),
  ]))
  const all = [...new Set([...(wallet.mints || []), ...sets.map(set => set.mint)].filter(Boolean))]
  const eligible = all.filter(mint => (balances.get(mint) || 0) >= minimumSats)
  return eligible.length > 0 ? eligible : all.slice(0, 1)
}

async function getCashuSpendableSnapshot(wallet) {
  const sets = await getProofSets(wallet.id, _cachedPassword, getCashuMint(wallet))
  const pending = await readCashuMeltJournal(wallet.id, _cachedPassword)
  const reservedSecrets = new Set(pending?.inputSecrets || [])
  const balances = sets.map(set => ({
    mint: set.mint,
    balance: set.proofs.reduce((sum, proof) =>
      sum + (reservedSecrets.has(proof.secret) ? 0 : proof.amount), 0),
  }))
  return {
    balances,
    total: balances.reduce((sum, item) => sum + item.balance, 0),
    paymentPending: !!pending,
  }
}

async function recoverCashuState(wallet, { throwOnPending = true } = {}) {
  const melt = await resolvePendingCashuMelt(
    wallet.id,
    _cachedPassword,
    await getCashuSeed(wallet),
  )
  if (melt.resolved && melt.transactionId) {
    await updateCashuTx(wallet.id, melt.transactionId, {
      state: melt.paid ? 'settled' : 'failed',
      feesPaid: melt.feeSats || 0,
    }, _cachedPassword)
  }
  if (melt.resolved && melt.paid) {
    syncCashuToRelays(wallet, 'out', 0).catch(() => {})
  }
  if (melt.pending && throwOnPending) {
    const error = new Error('Cashu payment is still pending')
    error.code = 'CASHU_PAYMENT_PENDING'
    throw error
  }
  const result = await recoverPendingCashuProofs(
    wallet.id,
    _cachedPassword,
    await getCashuSeed(wallet),
    wallet.cashuPrivkey,
  )
  if (result.recovered) {
    if (result.mint) await addCashuMint(wallet.id, result.mint, _cachedPassword)
    syncCashuToRelays(await getActiveWallet(_cachedPassword), 'in', result.amountSats || 0).catch(() => {})
  }
  return { ...result, paymentPending: !!melt.pending, paymentResolved: !!melt.resolved }
}

async function cashuQuoteTransactionId(quoteId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quoteId))
  return `cashu-mint-${bytesToHex(new Uint8Array(digest))}`
}

async function recoverPendingCashuMintQuotes(wallet) {
  const quotes = await listCashuMintQuotes(wallet.id, _cachedPassword)
  const seed = await getCashuSeed(wallet)
  let recoveredAmount = 0
  let recoveredQuotes = 0
  let needsAttention = 0

  for (const quote of quotes) {
    try {
      const status = await checkMintQuote(
        quote.mint, quote.quoteId, wallet.id, _cachedPassword, seed,
      )
      if (status.state === 'PAID' || status.paid) {
        const minted = await mintTokens(
          quote.mint,
          quote.amountSats,
          quote.quoteId,
          wallet.id,
          _cachedPassword,
          seed,
          wallet.cashuPrivkey,
        )
        // Proofs are durable once mintTokens returns. Clear the quote before
        // writing optional history so a history failure cannot block the wallet.
        await removeCashuMintQuote(wallet.id, _cachedPassword, quote.quoteId)
        await recordCashuTx(wallet.id, {
          direction: 'in',
          amount: minted.amountSats,
          description: 'Recovered Lightning deposit',
          state: 'settled',
          paymentHash: await cashuQuoteTransactionId(quote.quoteId),
        }, _cachedPassword).catch(error =>
          log.warn('cashu', 'RECOVERED_MINT_TX_RECORD_FAILED', { err: error?.message })
        )
        recoveredAmount += minted.amountSats
        recoveredQuotes += 1
        continue
      }
      if (status.state === 'ISSUED') {
        if (seed) {
          const restored = await restoreDeterministicProofs(
            quote.mint, wallet.id, _cachedPassword, seed,
          )
          if (restored.proofs > 0) {
            await removeCashuMintQuote(wallet.id, _cachedPassword, quote.quoteId)
            recoveredAmount += restored.amountSats
            recoveredQuotes += 1
            continue
          }
        }
        needsAttention += 1
        continue
      }
      if (status.state === 'UNPAID'
        && quote.expiry > 0
        && quote.expiry <= Math.floor(Date.now() / 1000)) {
        await removeCashuMintQuote(wallet.id, _cachedPassword, quote.quoteId)
      }
    } catch (error) {
      log.warn('cashu', 'MINT_QUOTE_RECOVERY_FAILED', { err: error?.message })
    }
  }

  const remaining = await listCashuMintQuotes(wallet.id, _cachedPassword)
  if (recoveredQuotes > 0) syncCashuToRelays(wallet, 'in', recoveredAmount).catch(() => {})
  return {
    incomingPending: remaining.length > 0,
    incomingQuotes: remaining.length,
    incomingNeedsAttention: needsAttention,
    incomingRecovered: recoveredQuotes,
    incomingRecoveredAmount: recoveredAmount,
  }
}

/**
 * After a Cashu proof mutation, publish updated token state to relays and record history.
 * Publishes current proofs as a new token event, records history with token event ID,
 * and optionally deletes old token events for spent proofs.
 */
async function syncCashuToRelays(wallet, direction, amountSats) {
  try {
    const account = await getCashuOwner(wallet)
    if (!account?.secretHex) return
    const secretKey = hexToBytes(account.secretHex)
    await publishWalletEvent(
      secretKey,
      wallet.cashuPrivkey,
      wallet.mints || [],
      account.pubkey,
    )
    const proofSets = await getProofSets(wallet.id, _cachedPassword, getCashuMint(wallet))
    const relayStates = await getRelayMintStates(wallet.id, _cachedPassword)
    const proofsByMint = new Map(proofSets.map(set => [set.mint, set.proofs]))
    const mints = new Set([
      ...proofSets.map(set => set.mint),
      ...relayStates.map(state => state.mint),
    ])
    const tokenIds = []
    for (const mint of mints) {
      const proofs = proofsByMint.get(mint) || []
      const oldIds = await getRelayEventIds(wallet.id, _cachedPassword, mint)
      const tokenEventId = proofs.length > 0
        ? await publishTokenEvent(secretKey, mint, proofs, account.pubkey, oldIds)
        : null
      if (tokenEventId) {
        tokenIds.push(tokenEventId)
        await setRelayEventIds(wallet.id, _cachedPassword, mint, [tokenEventId])
        if (oldIds.length > 0) await deleteTokenEvents(secretKey, oldIds, account.pubkey)
      } else if (proofs.length === 0 && oldIds.length > 0) {
        const deleted = await deleteTokenEvents(secretKey, oldIds, account.pubkey)
        if (deleted) await setRelayEventIds(wallet.id, _cachedPassword, mint, [])
      }
    }
    await publishHistoryEvent(secretKey, direction, amountSats, tokenIds, account.pubkey)
  } catch (err) {
    log.warn('cashu', 'RELAY_SYNC_FAILED', { direction, err: err?.message })
  }
}

function getCashuMint(wallet) {
  if (!wallet.mints?.length) throw new Error('No mint configured for this wallet')
  return wallet.mints[0]
}

function normalizeCashuMintList(candidates) {
  const mints = []
  for (const candidate of candidates || []) {
    try {
      const mint = requireSecureUrl(candidate, { allowLoopback: true }).toString().replace(/\/$/, '')
      if (!mints.includes(mint) && mints.length < 20) mints.push(mint)
    } catch { /* ignore invalid external mint metadata */ }
  }
  return mints
}

function isValidCashuPrivkey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) return false
  const secretKey = hexToBytes(value)
  try {
    getPublicKey(secretKey)
    return true
  } catch {
    return false
  } finally {
    secretKey.fill(0)
  }
}

async function adoptRestoredCashuPrivkey(wallet, restoredPrivkey) {
  if (!restoredPrivkey || restoredPrivkey === wallet.cashuPrivkey) return false
  if (!isValidCashuPrivkey(restoredPrivkey)) throw new Error('Invalid Cashu receiving key')
  const localBalance = await getCashuBalance(wallet.id, _cachedPassword, wallet.mints?.[0])
  const hasLocalState = localBalance > 0
    || hasVolatileCashuRecovery(wallet.id)
    || await hasCashuRecovery(wallet.id)
    || await hasCashuMeltJournal(wallet.id)
    || await hasCashuMintJournal(wallet.id)
  if (hasLocalState) {
    const error = new Error('Cashu receiving key restore conflicts with local wallet state')
    error.code = 'CASHU_RESTORE_CONFLICT'
    throw error
  }
  const normalizedKey = await setCashuWalletPrivkey(wallet.id, restoredPrivkey, _cachedPassword)
  wallet.cashuPrivkey = normalizedKey
  return true
}

function requireConfiguredCashuMint(wallet, mintUrl) {
  const normalized = requireSecureUrl(mintUrl, { allowLoopback: true }).toString().replace(/\/$/, '')
  const configured = new Set((wallet.mints || []).map(mint =>
    requireSecureUrl(mint, { allowLoopback: true }).toString().replace(/\/$/, '')
  ))
  if (!configured.has(normalized)) {
    const error = new Error('Cashu mint is not configured for this wallet')
    error.code = 'INVALID_REQUEST'
    throw error
  }
  return normalized
}

async function walletPayInvoice(invoice, amountSats) {
  const validatedInvoice = validatePaymentInvoice(invoice, amountSats)
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) throw new Error('No wallet connected')
  if (wallet.type === 'lnbits') {
    return await lnbitsPayInvoice(
      wallet.apiUrl,
      wallet.adminKey,
      invoice,
      validatedInvoice.decoded.amountMsat == null ? validatedInvoice.amountSats : undefined,
    )
  }
  if (wallet.type === 'cashu') {
    await recoverCashuState(wallet)
    const decodedInvoice = validatedInvoice.decoded
    const amount = validatedInvoice.amountSats
    const seed = await getCashuSeed(wallet)
    const mintCandidates = await getCashuMintCandidates(wallet, amount)

    // Record pending tx BEFORE attempting payment
    const paymentHash = decodedInvoice?.paymentHash || ''
    if (paymentHash && (await getCashuTx(wallet.id, paymentHash, _cachedPassword))?.state === 'settled') {
      const error = new Error('This Lightning invoice was already paid')
      error.code = 'INVOICE_ALREADY_PAID'
      throw error
    }
    const txId = await recordCashuTx(wallet.id, {
      direction: 'out', amount, description: 'Lightning payment', state: 'pending', paymentHash,
    }, _cachedPassword)

    try {
      let result
      let lastBalanceError
      for (const mintUrl of mintCandidates) {
        try {
          result = await meltTokens(
            mintUrl,
            invoice,
            wallet.id,
            _cachedPassword,
            seed,
            { transactionId: txId },
          )
          break
        } catch (error) {
          if (error?.code !== 'CASHU_MINT_BALANCE') throw error
          lastBalanceError = error
        }
      }
      if (!result) throw lastBalanceError || new Error('No Cashu mint can cover this payment')
      // Mark settled on success
      await updateCashuTx(wallet.id, txId, {
        state: 'settled',
        feesPaid: result.feeSats || 0,
      }, _cachedPassword).catch(err =>
        log.warn('cashu', 'TX_UPDATE_FAILED', { txId, err: err?.message })
      )
      // Sync proof state to relays (fire-and-forget)
      syncCashuToRelays(wallet, 'out', amount).catch(err =>
        log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
      )
      return result
    } catch (err) {
      // A storage recovery error can happen after the mint paid the invoice.
      // Keep that transaction pending instead of presenting a false failure.
      const state = ['CASHU_RECOVERY_REQUIRED', 'CASHU_STORAGE_FATAL', 'CASHU_PAYMENT_PENDING'].includes(err?.code)
        ? 'pending'
        : 'failed'
      await updateCashuTx(wallet.id, txId, { state }, _cachedPassword).catch(updErr =>
        log.warn('cashu', 'TX_UPDATE_FAILED', { txId, err: updErr?.message })
      )
      throw err
    }
  }
  return await withNwcRetry(nwc => nwc.payInvoice(
    invoice,
    validatedInvoice.decoded.amountMsat == null ? validatedInvoice.amountMsat : undefined,
  ))
}

async function walletMakeInvoice(amountSats, description) {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) throw new Error('No wallet connected')
  if (wallet.type === 'lnbits') {
    return await lnbitsMakeInvoice(wallet.apiUrl, wallet.adminKey, amountSats, description)
  }
  if (wallet.type === 'cashu') {
    const mintUrl = getCashuMint(wallet)
    const q = await createMintQuote(
      mintUrl,
      amountSats,
      wallet.id,
      _cachedPassword,
      await getCashuSeed(wallet),
      wallet.cashuPrivkey,
    )
    await saveCashuMintQuote(wallet.id, _cachedPassword, {
      mint: mintUrl,
      quoteId: q.quote,
      amountSats,
      expiry: Number(q.expiry) || 0,
    })
    return { invoice: q.request, quoteId: q.quote, expiry: q.expiry, mintUrl }
  }
  return await withNwcRetry(nwc => nwc.makeInvoice({ amount: amountSats * 1000, description: description || '' }))
}

async function walletGetBalance() {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) return 0
  if (wallet.type === 'cashu') return (await getCashuSpendableSnapshot(wallet)).total
  if (wallet.type === 'lnbits') return await lnbitsGetBalance(wallet.apiUrl, wallet.adminKey)
  const bal = await withNwcRetry(nwc => nwc.getBalance())
  return Math.floor(bal.balance / 1000)
}

// ── NWC / WebLN Handlers ─────────────────────────────────────────
async function ensureNWC() {
  if (_accountSwitching) throw new Error('Account switch in progress')
  if (nwcClient?.connected) return nwcClient
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet?.connectionUri) throw new Error('No wallet connected')
  validateNwcConnectionUri(wallet.connectionUri)
  teardownNwc()
  nwcClient = new NWC(wallet.connectionUri)
  await nwcClient.connect()
  subscribeNwcNotifications()
  return nwcClient
}

/**
 * Check if an error looks like a transient connection failure.
 * Covers relay socket errors, NWC publish/reply timeouts, and the
 * "no relay accepted the event" publish failure from nostr-core.
 */
function isConnectionError(err) {
  const msg = err?.message?.toLowerCase() || ''
  return msg.includes('closed') || msg.includes('disconnect')
    || msg.includes('timeout') || msg.includes('not connected')
    || msg.includes('no relay accepted')
}

/**
 * Execute an NWC operation with automatic reconnect on connection failure.
 * Retries once with a 1s backoff on transient errors.
 *
 * Every NWC call must go through this wrapper: the client's `connected` flag
 * can go stale on a half-open socket (laptop sleep, network switch), in which
 * case the operation times out and only a teardown + fresh connect recovers.
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
    try {
      const nwc = await ensureNWC()
      return await operation(nwc)
    } catch (retryErr) {
      // Don't leave a half-dead client behind for the next call to trust
      if (isConnectionError(retryErr)) teardownNwc()
      throw retryErr
    }
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
  // subscribeNotifications re-subscribes on relay close (unlike client.on),
  // so the subscription survives relay reconnects within a worker lifetime.
  client.subscribeNotifications((event) => {
    if (client !== nwcClient) return // Stale subscription — ignore
    const payment = event.notification
    const amountSats = payment?.amount ? Math.floor(payment.amount / 1000) : 0
    const hash = payment?.payment_hash || ''
    if (amountSats > 0) {
      notifyPayment(amountSats, hash)
    }
  }, ['payment_received'])
    .then((unsub) => {
      if (client !== nwcClient) { try { unsub() } catch { /* best-effort */ } return }
      nwcNotifUnsub = unsub
    })
    .catch((err) => {
      log.info('wallet', 'NOTIF_SUB_UNSUPPORTED', { err: err?.message })
    })
}

async function handleWeblnEnable(sender) {
  const origin = getSenderOrigin(sender)
  await requireUnlocked(origin)
  const { allowed } = await requestPermission(origin, 'weblnEnable', null, null, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const wType = await getActiveWalletType()
    if (wType === 'cashu' || wType === 'lnbits') return { result: { enabled: true } }
    await ensureNWC()
    return { result: { enabled: true } }
  } catch (err) { return { error: classifyError(err) } }
}

async function requireWeblnEnabled(sender) {
  const origin = getSenderOrigin(sender)
  await requireUnlocked(origin)
  const { allowed } = await requestPermission(origin, 'weblnEnable', null, null, getSiteMeta(sender))
  if (!allowed) return null
  return origin
}

async function handleWeblnGetInfo(sender) {
  const origin = await requireWeblnEnabled(sender)
  if (!origin) return { error: 'PERMISSION_DENIED' }
  try {
    const wType = await getActiveWalletType()
    if (wType === 'cashu') {
      const w = await getActiveWallet(_cachedPassword)
      return { result: { alias: w?.name || 'Buho', methods: ['pay_invoice', 'make_invoice', 'get_balance'] } }
    }
    if (wType === 'lnbits') {
      const w = await getActiveWallet(_cachedPassword)
      return { result: { alias: w?.name || 'LNbits', methods: ['pay_invoice', 'make_invoice', 'get_balance', 'list_transactions'] } }
    }
    const info = await withNwcRetry(nwc => nwc.getInfo())
    return { result: info }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnSendPayment(params, sender) {
  const origin = await requireWeblnEnabled(sender)
  if (!origin) return { error: 'PERMISSION_DENIED' }

  const invoice = validateInvoice(params[0])
  if (!safeDecode11(invoice)) return { error: 'INVALID_REQUEST' }
  const amountSats = parseBolt11Amount(invoice)
  const reservation = amountSats ? await reserveSpend(origin, amountSats) : null
  if (reservation) {
    try {
      const result = await walletPayInvoice(invoice, amountSats)
      const updated = reservation.entry
      notifyBudgetSpend(origin, amountSats, updated.budget - updated.spent).catch(() => {})
      return { result: { preimage: result.preimage } }
    } catch (err) {
      await refundSpend(origin, reservation.reservationId).catch(() => {})
      return { error: classifyError(err) }
    }
  }

  const allowance = await getAllowance(origin)
  const paymentMeta = { amountSats, budgetSats: allowance?.budget || null, spentSats: allowance?.spent || 0 }
  const { allowed } = await requestPermission(origin, 'weblnSendPayment', null, paymentMeta, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const result = await walletPayInvoice(invoice, amountSats)
    if (amountSats) await recordSpend(origin, amountSats)
    return { result: { preimage: result.preimage } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnMakeInvoice(params, sender) {
  const origin = await requireWeblnEnabled(sender)
  if (!origin) return { error: 'PERMISSION_DENIED' }
  try {
    const args = params[0]
    const amount = validateSats(typeof args === 'number' ? args : args?.amount)
    const description = typeof args === 'object' ? args?.defaultMemo || '' : ''
    if (typeof description !== 'string' || new TextEncoder().encode(description).byteLength > 4096) {
      return { error: 'INVALID_REQUEST' }
    }
    const inv = await walletMakeInvoice(amount, description)
    return { result: { paymentRequest: inv.invoice } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnGetBalance(sender) {
  const origin = await requireWeblnEnabled(sender)
  if (!origin) return { error: 'PERMISSION_DENIED' }
  try {
    const balance = await walletGetBalance()
    return { result: { balance } }
  } catch (err) { return { error: classifyError(err) } }
}

async function handleWeblnKeysend(params, sender) {
  const origin = await requireWeblnEnabled(sender)
  if (!origin) return { error: 'PERMISSION_DENIED' }

  const { destination, amount: amountSats, customRecords } = validateKeysend(params[0])

  // Permission check + budget (same flow as sendPayment)
  const reservation = await reserveSpend(origin, amountSats)
  if (reservation) {
    try {
      const result = await walletKeysend(destination, amountSats, customRecords)
      const updated = reservation.entry
      notifyBudgetSpend(origin, amountSats, updated.budget - updated.spent).catch(() => {})
      return { result }
    } catch (err) {
      await refundSpend(origin, reservation.reservationId).catch(() => {})
      return { error: classifyError(err) }
    }
  }

  const allowance = await getAllowance(origin)
  const paymentMeta = { amountSats, budgetSats: allowance?.budget || null, spentSats: allowance?.spent || 0 }
  const { allowed } = await requestPermission(origin, 'weblnKeysend', null, paymentMeta, getSiteMeta(sender))
  if (!allowed) return { error: 'PERMISSION_DENIED' }
  try {
    const result = await walletKeysend(destination, amountSats, customRecords)
    if (amountSats) await recordSpend(origin, amountSats)
    return { result }
  } catch (err) { return { error: classifyError(err) } }
}

async function walletKeysend(destination, amountSats, customRecords) {
  const wType = await getActiveWalletType()
  if (wType !== 'nwc') {
    // Cashu and LNbits backends don't support spontaneous keysend payments.
    throw new Error('Keysend is only supported with NWC wallets')
  }
  // Convert WebLN customRecords (string keys → int, string values) to NWC tlv_records
  const tlvRecords = customRecords
    ? Object.entries(customRecords).map(([k, v]) => ({
        type: parseInt(k, 10),
        value: v,
      }))
    : undefined
  return await withNwcRetry(nwc => nwc.payKeysend({
    pubkey: destination,
    amount: amountSats * 1000, // sats → msats
    tlv_records: tlvRecords,
  }))
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
  if (remoteSigner?.connected && remoteSignerAccountId === account.id) return

  nip46Reconnecting = true
  try {
    remoteSigner = await connectBunker(
      account.nip46Session.bunkerUri,
      account.nip46ClientSecretHex
    )
    remoteSignerAccountId = account.id
  } catch (err) {
    log.warn('nip46', 'PROACTIVE_RECONNECT_FAILED', { err: err?.message })
    remoteSigner = null
    remoteSignerAccountId = null
  } finally {
    nip46Reconnecting = false
  }
}

export default defineBackground(() => {
  // Content scripts never need direct vault access. Restrict both persistent
  // and session storage to extension pages/workers wherever the browser offers
  // the access-level API.
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
  chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
  // Older versions could persist an unlock fallback containing the master
  // password. It is no longer supported; remove it immediately on upgrade.
  chrome.storage.local.remove('_sessionFallback').catch(() => {})

  // Sweep abandoned prompt data without deleting a still-open prompt after an
  // MV3 worker restart. Context lives in memory-only session storage.
  Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]).then(([local, session]) => {
    const now = Date.now()
    const liveIds = new Set()
    const staleContexts = []
    for (const [key, context] of Object.entries(session)) {
      if (!key.startsWith(PROMPT_CONTEXT_PREFIX)) continue
      const requestId = key.slice(PROMPT_CONTEXT_PREFIX.length)
      if (Number.isFinite(context?.createdAt) && now - context.createdAt <= 5 * 60 * 1000) liveIds.add(requestId)
      else staleContexts.push(key)
    }
    const staleEvents = Object.keys(session).filter(key =>
      key.startsWith(PROMPT_EVENT_PREFIX)
      && !liveIds.has(key.slice(PROMPT_EVENT_PREFIX.length)),
    )
    const staleSessionKeys = [...staleContexts, ...staleEvents]
    if (staleSessionKeys.length) chrome.storage.session.remove(staleSessionKeys)
    // Remove prompt payloads left on disk by pre-hardening releases.
    const legacyEvents = Object.keys(local).filter(key => key.startsWith(PROMPT_EVENT_PREFIX))
    if (legacyEvents.length) chrome.storage.local.remove(legacyEvents)
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
      const origin = normalizeWebOrigin(tab.url)
      if (!origin) { chrome.action.setBadgeText({ tabId, text: '' }); return }
      const activeId = await getActiveAccountId()
      const perms = await getPermissions(activeId)
      const hostPerms = perms[origin]
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
  chrome.tabs.onRemoved.addListener((tabId) => {
    permissionSession.clearTab(tabId)
    requestCoordinator.resolveWhere(
      context => context?.tabId === tabId,
      false,
      { removeEventData: true, closePrompt: true },
    ).catch(() => {})
  })

  // ── Prompt keepalive ports ──
  // Each open prompt window holds a Port named `prompt:<requestId>`. While the
  // port is connected it keeps the service worker (Chrome) / event page
  // (Firefox) alive, so the in-memory requestCoordinator pending map and the
  // handler awaiting the user's decision survive the unlock + approval flow.
  // When the window closes, the port disconnects and we resolve the pending
  // request with a deny/false fallback (idempotent with attachWindowClose).
  // Registered synchronously so a connect that respawns the worker is caught.
  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name?.startsWith('prompt:')) return
    let trustedPrompt = false
    try {
      const senderUrl = new URL(port.sender?.url || '')
      trustedPrompt = port.sender?.id === chrome.runtime.id
        && senderUrl.origin === new URL(chrome.runtime.getURL('/')).origin
        && senderUrl.pathname.endsWith('/prompt.html')
    } catch { /* untrusted */ }
    if (!trustedPrompt) {
      port.disconnect()
      return
    }
    const requestId = port.name.slice('prompt:'.length)
    port.onMessage.addListener(() => {}) // no-op; page pings reset the idle timer
    port.onDisconnect.addListener(() => {
      if (requestCoordinator.has(requestId)) {
        requestCoordinator.resolve(requestId, false, { removeEventData: true }).catch(() => {})
      }
    })
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, params } = message

    const handle = async () => {
      try {
        const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin
        const messageOrigin = (() => {
          try { return sender?.url ? new URL(sender.url).origin : null } catch { return null }
        })()
        const fromThisExtension = sender?.id === chrome.runtime.id
        const fromExtensionPage = fromThisExtension && messageOrigin === extensionOrigin
        const fromContentScript = fromThisExtension
          && !!sender?.tab?.id
          && !!normalizeWebOrigin(sender?.url || sender?.tab?.url || '')

        // ── Public routes (from content scripts) ──
        if (type === 'PUBLIC') {
          if (!fromContentScript) return { error: 'UNAUTHORIZED_SENDER' }
          const { action, params: publicParams } = params?.[0] || {}

          // Anti-spam: reject if origin was previously denied
          const origin = getSenderOrigin(sender)
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

        // The injection probe is the only non-PUBLIC message accepted from a
        // content script. The claimed host must match the sender frame.
        if (type === 'SHOULD_INJECT') {
          if (!fromContentScript) return { error: 'UNAUTHORIZED_SENDER', inject: false }
          const requestedHost = message.host || ''
          const actualHost = new URL(sender.url || sender.tab.url).hostname
          if (!requestedHost || requestedHost !== actualHost) return { error: 'INVALID_REQUEST', inject: false }
          return { inject: !(await isBlocked(actualHost)) }
        }

        if (!fromExtensionPage) return { error: 'UNAUTHORIZED_SENDER' }

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
            const passwordError = validateNewPassword(pw)
            if (passwordError) return { error: passwordError }
            if (await isPasswordSet()) return { error: 'PASSWORD_ALREADY_SET' }
            await setupPassword(pw)
            await clearPasswordFailures()
            _cachedPassword = pw
            await saveSession({ password: pw, unlockedAt: Date.now() })
            return { result: { ok: true } }
          }
          case 'UNLOCK': {
            const pw = params?.[0]
            const authentication = await authenticateMasterPassword(pw)
            if (!authentication.valid) return { error: authentication.error }
            _cachedPassword = pw
            await saveSession({ password: pw, unlockedAt: Date.now() })
            rejectedOrigins.clear()
            return { result: { ok: true } }
          }
          case 'LOCK':
            await clearUnlockedSessionState()
            return { result: { ok: true } }
          case 'CHANGE_PASSWORD': {
            const [oldPw, newPw] = params || []
            const passwordError = validateNewPassword(newPw)
            if (passwordError) return { error: passwordError }
            // Verify old password first
            const authentication = await authenticateMasterPassword(oldPw)
            if (!authentication.valid) return { error: authentication.error }
            // Re-encrypt data BEFORE updating the password hash.
            // If re-encryption fails, data stays accessible with the old password.
            // Collect Cashu wallet IDs BEFORE re-encryption (using old password)
            const cashuWallets = (await getWalletSummaries(oldPw))
              .filter(w => w.type === 'cashu')
            const migrationKeys = [
              'accounts', 'walletConfigs', 'transactionMetadata',
              'passwordHash', 'passwordSalt', 'passwordKdf',
              ...cashuWallets.flatMap(wallet => [
                `cashuProofs_${wallet.id}`,
                `cashuTxHistory_${wallet.id}`,
                cashuRecoveryKey(wallet.id),
                cashuMeltJournalKey(wallet.id),
                cashuMintJournalKey(wallet.id),
              ]),
            ]
            await withStorageRollback(chrome.storage.local, migrationKeys, async () => {
              await reEncryptAccounts(oldPw, newPw)
              await reEncryptWallets(oldPw, newPw)
              await reEncryptTransactionMetadata(oldPw, newPw)
              for (const wallet of cashuWallets) {
                await reEncryptProofStore(wallet.id, oldPw, newPw, wallet.mints?.[0])
                await reEncryptCashuTxHistory(wallet.id, oldPw, newPw)
                await reEncryptCashuRecovery(wallet.id, oldPw, newPw)
                await reEncryptCashuMeltJournal(wallet.id, oldPw, newPw)
                await reEncryptCashuMintJournal(wallet.id, oldPw, newPw)
              }
              // The verifier changes last, after every vault can use newPw.
              await changePassword(oldPw, newPw)
            })
            // Cached Cashu counter sources still reference the old password.
            teardownCashu()
            _cachedPassword = newPw
            await saveSession({ password: newPw, unlockedAt: Date.now() })
            return { result: { ok: true } }
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
            const minutes = Number(params?.[0])
            if (![0, 1, 5, 15, 30].includes(minutes)) return { error: 'INVALID_REQUEST' }
            await chrome.storage.local.set({ autoLockMinutes: minutes })
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
          case 'GET_NWC_STATUS': {
            // Actively verify instead of reading the in-memory flag: the
            // client dies with every service-worker restart, so a missing
            // client means "not dialed yet", not "disconnected".
            try {
              const wType = await getActiveWalletType()
              if (wType !== 'nwc') return { result: { connected: !!wType } }
              await ensureNWC()
              return { result: { connected: true } }
            } catch {
              return { result: { connected: false } }
            }
          }

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
            return { result: await getActiveAccountForClient(_cachedPassword) }
          case 'GET_ACCOUNTS':
            return { result: await getAccountSummaries(_cachedPassword) }
          case 'CREATE_ACCOUNT':
            return { result: await createLocalAccount(_cachedPassword, params?.[0]) }
          case 'CREATE_ACCOUNT_MNEMONIC':
            return { result: await createAccountWithMnemonic(_cachedPassword, params?.[0]) }
          case 'IMPORT_ACCOUNT':
            return { result: await importAccount(_cachedPassword, params?.[0], params?.[1]) }
          case 'DISCOVER_MNEMONIC_IDENTITIES':
            return { result: await discoverNip06Identities(params?.[0]) }
          case 'IMPORT_FROM_MNEMONIC':
            return { result: await importFromMnemonic(_cachedPassword, params?.[0], params?.[1], params?.[2] ?? 0) }
          case 'PERFORM_LIGHTNING_LOGIN': {
            const account = await getActiveAccount(_cachedPassword)
            if (!account) return { error: 'NO_ACCOUNT' }
            if (!account.identitySeed?.mnemonic) {
              return {
                error: account.mode === 'nip46'
                  ? 'LIGHTNING_LOGIN_REMOTE_SIGNER'
                  : 'LIGHTNING_LOGIN_RECOVERY_WORDS_REQUIRED',
              }
            }

            const proof = proveLightningLogin(account.identitySeed.mnemonic, params?.[0])
            const result = await submitLightningLogin(proof.callbackUrl)
            if (result.ok || result.requestSent) {
              const now = Math.floor(Date.now() / 1000)
              const sites = Array.isArray(account.lightningLoginSites)
                ? account.lightningLoginSites.filter((site) => (site?.origin || `https://${site?.domain}`) !== proof.challenge.origin)
                : []
              const previous = account.lightningLoginSites?.find((site) =>
                (site?.origin || `https://${site?.domain}`) === proof.challenge.origin
              )
              sites.unshift({
                domain: proof.challenge.domain,
                origin: proof.challenge.origin,
                firstLoginAt: previous?.firstLoginAt || now,
                lastLoginAt: now,
                loginCount: (previous?.loginCount || 0) + 1,
                lastAction: proof.challenge.action,
                linkingPubkey: proof.linkingPubkey,
              })
              await updateAccount(_cachedPassword, account.id, { lightningLoginSites: sites.slice(0, 100) })
            }
            return {
              result: {
                ...result,
                domain: proof.challenge.domain,
                action: proof.challenge.action,
              },
            }
          }
          case 'GET_LIGHTNING_LOGIN_SITES': {
            const account = await getActiveAccount(_cachedPassword)
            const sites = Array.isArray(account?.lightningLoginSites) ? account.lightningLoginSites : []
            return { result: sites.slice(0, 100).map(site => ({
              origin: site.origin || (site.domain ? `https://${site.domain}` : ''),
              domain: site.domain || '',
              firstLoginAt: site.firstLoginAt || 0,
              lastLoginAt: site.lastLoginAt || 0,
              loginCount: site.loginCount || 0,
              lastAction: site.lastAction || 'login',
            })).filter(site => normalizeWebOrigin(site.origin)) }
          }
          case 'CLEAR_LIGHTNING_LOGIN_SITES': {
            const account = await getActiveAccount(_cachedPassword)
            if (!account) return { error: 'NO_ACCOUNT' }
            await updateAccount(_cachedPassword, account.id, { lightningLoginSites: [] })
            return { result: { cleared: true } }
          }
          case 'CREATE_NIP46_ACCOUNT':
            return { result: await createNip46Account(_cachedPassword, params?.[0]) }
          case 'SWITCH_ACCOUNT': {
            _accountSwitching = true
            try {
              const previousAccountId = await getActiveAccountId()
              permissionSession.clear()
              await requestCoordinator.resolveWhere(
                context => context?.profileId === previousAccountId,
                false,
                { removeEventData: true, closePrompt: true },
              )
              teardownCashu()
              const cleaned = await performAccountSwitch(params?.[0], {
                nwcClient, nwcNotifUnsub, remoteSigner,
              })
              nwcClient = cleaned.nwcClient
              nwcNotifUnsub = cleaned.nwcNotifUnsub
              remoteSigner = cleaned.remoteSigner
              remoteSignerAccountId = null
              return { result: { switched: true } }
            } finally {
              _accountSwitching = false
            }
          }
          case 'REMOVE_ACCOUNT': {
            const accountId = params?.[0]
            const ownedCashuWallets = (await getWalletSummaries(_cachedPassword))
              .filter(wallet => wallet.type === 'cashu' && wallet.ownerAccountId === accountId)
            for (const wallet of ownedCashuWallets) {
              if (hasVolatileCashuRecovery(wallet.id) || await hasCashuRecovery(wallet.id)) {
                return { error: 'CASHU_RECOVERY_REQUIRED' }
              }
              if (await hasCashuMeltJournal(wallet.id)) return { error: 'CASHU_PAYMENT_PENDING' }
              if (await hasCashuMintJournal(wallet.id)) return { error: 'CASHU_INVOICE_PENDING' }
              const balance = await getCashuBalance(wallet.id, _cachedPassword, wallet.mints?.[0])
              if (balance > 0) return { error: 'CASHU_BALANCE_REMAINS' }
            }
            await requestCoordinator.resolveWhere(
              context => context?.profileId === accountId,
              false,
              { removeEventData: true, closePrompt: true },
            )
            permissionSession.clearProfile(accountId)
            await removeAccountTransactionMetadata(_cachedPassword, accountId)
            await clearAllPermissions(accountId)
            await chrome.storage.local.remove(`backupExported_${accountId}`)
            for (const wallet of ownedCashuWallets) {
              await clearProofStore(wallet.id)
              await clearCashuTxHistory(wallet.id)
              await clearCashuRecovery(wallet.id)
              await clearCashuMeltJournal(wallet.id)
              await clearCashuMintJournal(wallet.id)
              await removeWalletTransactionMetadataEverywhere(_cachedPassword, wallet.id)
              await removeWallet(wallet.id, _cachedPassword)
            }
            await removeAccount(_cachedPassword, accountId)
            if (remoteSigner) { await remoteSigner.disconnect(); remoteSigner = null }
            remoteSignerAccountId = null
            return { result: { removed: true } }
          }
          case 'EXPORT_NSEC': {
            const password = params?.[0]
            const authentication = await authenticateMasterPassword(password)
            if (!authentication.valid) return { error: authentication.error }
            const acct = await getActiveAccount(_cachedPassword)
            if (!acct || acct.mode !== 'local' || !acct.secretHex) {
              return { error: 'No local key to export' }
            }
            return { result: { nsec: nip19.nsecEncode(hexToBytes(acct.secretHex)) } }
          }
          case 'EXPORT_IDENTITY_BACKUP': {
            const password = params?.[0]
            const authentication = await authenticateMasterPassword(password)
            if (!authentication.valid) return { error: authentication.error }
            const acct = await getActiveAccount(_cachedPassword)
            if (!acct || acct.mode !== 'local') return { error: 'No local identity to export' }
            if (acct.identitySeed?.mnemonic) {
              const value = acct.identitySeed.mnemonic
              return { result: {
                kind: 'mnemonic',
                value,
                accountId: acct.id,
                challenge: await createBackupChallenge(acct, value, 'mnemonic'),
              } }
            }
            if (!acct.secretHex) return { error: 'No recovery key available' }
            const value = nip19.nsecEncode(hexToBytes(acct.secretHex))
            return { result: {
              kind: 'nsec',
              value,
              accountId: acct.id,
              challenge: await createBackupChallenge(acct, value, 'nsec'),
            } }
          }
          case 'BEGIN_IDENTITY_BACKUP_VERIFICATION': {
            const accountId = params?.[0]
            const acct = (await getAccounts(_cachedPassword))[accountId]
            if (!acct || acct.mode !== 'local') return { error: 'Local identity not found' }
            const kind = acct.identitySeed?.mnemonic ? 'mnemonic' : 'nsec'
            const value = kind === 'mnemonic'
              ? acct.identitySeed.mnemonic
              : nip19.nsecEncode(hexToBytes(acct.secretHex))
            return { result: await createBackupChallenge(acct, value, kind) }
          }
          case 'CONFIRM_IDENTITY_BACKUP': {
            const [accountId, token, answers] = params || []
            const acct = (await getAccounts(_cachedPassword))[accountId]
            if (!acct || acct.mode !== 'local') return { error: 'Local identity not found' }
            if (!(await confirmBackupChallenge(accountId, token, answers))) {
              return { error: 'BACKUP_VERIFICATION_FAILED' }
            }
            if (acct.identitySeed?.mnemonic) {
              await updateAccount(_cachedPassword, accountId, {
                identitySeed: { ...acct.identitySeed, backupConfirmed: true },
              })
            }
            await chrome.storage.local.set({ [`backupExported_${accountId}`]: Date.now() })
            return { result: { confirmed: true } }
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
              remoteSignerAccountId = null
              const parsed = parseConnectionURI(bunkerUri)
              const clientSecret = (await getAccounts(_cachedPassword))[accountId]?.nip46ClientSecretHex
              if (!clientSecret) return { error: 'Account missing client secret key' }
              const signer = await connectBunker(bunkerUri, clientSecret)
              remoteSigner = signer
              remoteSignerAccountId = accountId
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
            remoteSignerAccountId = null
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
                remoteSignerAccountId = accountId
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
            const profileData = sanitizeProfileInput(params?.[0])
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
          case 'NUTBITS_CONNECT': {
            const deepLink = buildNutbitsDeepLink()
            await chrome.tabs.create({ url: deepLink })
            return { result: { opened: true } }
          }
          case 'NUTBITS_CALLBACK': {
            const [{ value, token } = {}] = params || []
            if (!verifyCallbackToken(token)) return { error: 'INVALID_REQUEST' }
            rotateCallbackToken()
            if (typeof value !== 'string' || !value) return { error: 'No wallet connection was returned' }
            const nwcString = decodeURIComponent(value)
            const walletId = await addWallet(nwcString, 'NUTbits', _cachedPassword)
            teardownNwc()
            try {
              await ensureNWC()
            } catch (error) {
              await removeWallet(walletId, _cachedPassword).catch(() => {})
              throw error
            }
            return { result: { connected: true } }
          }
          case 'NWC_DEEPLINK_CONNECT':
          case 'CONNECT_WALLET': {
            const [uri, walletName] = params || []
            await addWallet(uri, walletName || null, _cachedPassword)
            teardownNwc()
            try { await ensureNWC(); return { result: { connected: true } } }
            catch (err) { return { error: classifyError(err) } }
          }
          case 'CONNECT_LNBITS': {
            const [apiUrl, adminKey, walletName] = params || []
            try {
              const info = await lnbitsConnect(apiUrl, adminKey)
              await addLnbitsWallet(apiUrl, adminKey, info.id, walletName || info.name, _cachedPassword)
              // Start WebSocket for real-time notifications
              const w = await getActiveWallet(_cachedPassword)
              if (w?.type === 'lnbits') connectLnbitsWs(w)
              return { result: { connected: true, balance: info.balance, name: info.name } }
            } catch (err) { return { error: classifyError(err) } }
          }
          case 'DISCONNECT_WALLET': {
            const [walletId] = params || []
            const storedWallets = await getWalletSummaries(_cachedPassword)
            const cashuTargets = walletId
              ? storedWallets.filter(wallet => wallet.id === walletId && wallet.type === 'cashu')
              : storedWallets.filter(wallet => wallet.type === 'cashu')
            for (const cashuWallet of cashuTargets) {
              if (hasVolatileCashuRecovery(cashuWallet.id)
                || await hasCashuRecovery(cashuWallet.id)) {
                return { error: 'CASHU_RECOVERY_REQUIRED' }
              }
              if (await hasCashuMeltJournal(cashuWallet.id)) {
                return { error: 'CASHU_PAYMENT_PENDING' }
              }
              if (await hasCashuMintJournal(cashuWallet.id)) {
                return { error: 'CASHU_INVOICE_PENDING' }
              }
              const balance = await getCashuBalance(
                cashuWallet.id,
                _cachedPassword,
                cashuWallet.mints?.[0],
              )
              if (balance > 0) return { error: 'CASHU_BALANCE_REMAINS' }
            }
            teardownNwc()
            teardownCashu()
            teardownLnbitsWs()
            if (walletId) {
              // Clean up Cashu proof store if it was a Cashu wallet
              const store = await getWalletSummaries(_cachedPassword)
              const w = store.find(s => s.id === walletId)
              if (w?.type === 'cashu') {
                await clearProofStore(walletId)
                await clearCashuTxHistory(walletId)
                await clearCashuRecovery(walletId)
                await clearCashuMeltJournal(walletId)
                await clearCashuMintJournal(walletId)
              }
              await removeWalletTransactionMetadataEverywhere(_cachedPassword, walletId)
              await removeWallet(walletId, _cachedPassword)
            } else {
              const wallets = await getWalletSummaries(_cachedPassword)
              for (const wallet of wallets) {
                if (wallet.type !== 'cashu') continue
                await clearProofStore(wallet.id)
                await clearCashuTxHistory(wallet.id)
                await clearCashuRecovery(wallet.id)
                await clearCashuMeltJournal(wallet.id)
                await clearCashuMintJournal(wallet.id)
              }
              await clearAllTransactionMetadata()
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
            const activeWallet = wallet
              ? { id: wallet.id, name: wallet.name, type: wallet.type || 'nwc' }
              : null
            try {
              if (wallet?.type === 'cashu') {
                // Catch request payments that arrived while the wallet was
                // closed (fire and forget, throttled inside).
                sweepRequestPaymentsSoon(wallet)
                const snapshot = await getCashuSpendableSnapshot(wallet)
                const recoveryPending = hasVolatileCashuRecovery(wallet.id)
                  || await hasCashuRecovery(wallet.id)
                const incomingPending = await hasCashuMintJournal(wallet.id)
                return { result: {
                  connected: true,
                  balance: snapshot.total,
                  activeWallet,
                  recoveryPending,
                  paymentPending: snapshot.paymentPending,
                  incomingPending,
                } }
              }
              if (wallet?.type === 'lnbits') {
                if (!lnbitsWsHandle) connectLnbitsWs(wallet) // Reconnect WS if needed
                const balance = await lnbitsGetBalance(wallet.apiUrl, wallet.adminKey)
                return { result: { connected: true, balance, activeWallet } }
              }
              if (wallet?.connectionUri) {
                const bal = await withNwcRetry(nwc => nwc.getBalance())
                return { result: {
                  connected: true,
                  balance: Math.floor(bal.balance / 1000),
                  activeWallet,
                } }
              }
            } catch (err) {
              if (err?.code === 'VAULT_INTEGRITY') throw err
              log.debug('wallet', 'STATUS_CHECK_FAILED', { err: err?.message })
            }
            // Keep the wallet identity on transient failures so the UI shows a
            // reconnecting state instead of the "no wallet" empty screen.
            return { result: { connected: false, balance: null, activeWallet } }
          }
          case 'GET_WALLETS': {
            const summaries = await getWalletSummaries(_cachedPassword)
            return { result: summaries }
          }
          case 'SWITCH_WALLET': {
            const [switchId] = params || []
            teardownNwc()
            teardownCashu()
            teardownLnbitsWs()
            await setActiveWallet(switchId, _cachedPassword)
            try {
              const w = await getActiveWallet(_cachedPassword)
              if (w?.type === 'lnbits') connectLnbitsWs(w)
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
            if (wType === 'lnbits') {
              const w = await getActiveWallet(_cachedPassword)
              return { result: { alias: w.name, methods: ['pay_invoice', 'make_invoice', 'get_balance', 'list_transactions'] } }
            }
            const info = await withNwcRetry(nwc => nwc.getInfo())
            return { result: info }
          }
          case 'WALLET_GET_BALANCE': {
            const balance = await walletGetBalance()
            return { result: { balance } }
          }
          case 'WALLET_GET_BUDGET': {
            const wType = await getActiveWalletType()
            if (wType === 'cashu' || wType === 'lnbits') return { result: null }
            const budget = await withNwcRetry(nwc => nwc.getBudget())
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
              return { result: await checkMintQuote(
                getCashuMint(w),
                lookupParams.quoteId,
                w.id,
                _cachedPassword,
                await getCashuSeed(w),
              ) }
            }
            if (wType === 'lnbits' && lookupParams?.payment_hash) {
              const w = await getActiveWallet(_cachedPassword)
              return { result: await lnbitsCheckPayment(w.apiUrl, w.adminKey, lookupParams.payment_hash) }
            }
            const inv = await withNwcRetry(nwc => nwc.lookupInvoice(lookupParams))
            return { result: inv }
          }
          case 'WALLET_LIST_TRANSACTIONS': {
            const [txParams] = params || []
            const wType = await getActiveWalletType()
            const accountId = await getActiveAccountId()
            if (wType === 'cashu') {
              const w = await getActiveWallet(_cachedPassword)
              const result = await getCashuTransactions(w.id, txParams || {}, _cachedPassword)
              result.transactions = await enrichTransactionsWithMetadata(
                _cachedPassword, accountId, w.id, result.transactions,
              )
              return { result }
            }
            if (wType === 'lnbits') {
              const w = await getActiveWallet(_cachedPassword)
              const raw = await lnbitsListPayments(w.apiUrl, w.adminKey, txParams || {})
              // Normalise to NWC-compatible format (amounts in msats, wrapped in { transactions })
              const txs = (raw || []).map(p => ({
                type: p.amount > 0 ? 'incoming' : 'outgoing',
                invoice: p.bolt11,
                description: p.memo || '',
                amount: Math.abs(p.amount),  // already msats from LNbits
                fees_paid: p.fee || 0,
                created_at: p.time,
                settled_at: p.status === 'success' ? p.time : undefined,
                payment_hash: p.checking_id || p.payment_hash,
                state: p.status === 'success' ? 'settled' : (p.status === 'failed' ? 'failed' : 'pending'),
              }))
              return { result: { transactions: await enrichTransactionsWithMetadata(
                _cachedPassword, accountId, w.id, txs,
              ) } }
            }
            const wallet = await getActiveWallet(_cachedPassword)
            const result = await withNwcRetry(nwc => nwc.listTransactions(txParams || {}))
            if (Array.isArray(result?.transactions)) {
              result.transactions = await enrichTransactionsWithMetadata(
                _cachedPassword, accountId, wallet?.id, result.transactions,
              )
            }
            return { result }
          }
          case 'SAVE_TRANSACTION_METADATA': {
            const [transactionId, metadata] = params || []
            const accountId = await getActiveAccountId()
            const wallet = await getActiveWallet(_cachedPassword)
            if (!accountId || !wallet?.id) return { error: 'NO_WALLET' }
            return { result: await saveTransactionMetadata(
              _cachedPassword, accountId, wallet.id, transactionId, metadata,
            ) }
          }
          case 'GET_TRANSACTION_METADATA': {
            const [transactionId] = params || []
            const accountId = await getActiveAccountId()
            const wallet = await getActiveWallet(_cachedPassword)
            if (!accountId || !wallet?.id) return { result: null }
            return { result: await getTransactionMetadata(
              _cachedPassword, accountId, wallet.id, transactionId,
            ) }
          }
          case 'WALLET_PAY_KEYSEND': {
            const [keysendParams] = params || []
            const wType = await getActiveWalletType()
            if (wType !== 'nwc') return { error: 'NOT_SUPPORTED' }
            const ksResult = await withNwcRetry(nwc => nwc.payKeysend(keysendParams))
            return { result: ksResult }
          }
          case 'WALLET_SIGN_MESSAGE': {
            const [msg] = params || []
            const wType = await getActiveWalletType()
            if (wType !== 'nwc') return { error: 'NOT_SUPPORTED' }
            const sigResult = await withNwcRetry(nwc => nwc.signMessage(msg))
            return { result: sigResult }
          }

          // ── Cashu-specific handlers ──
          case 'AUTO_CREATE_CASHU_WALLET': {
            const store = await getWalletSummaries(_cachedPassword)
            const account = await getActiveAccount(_cachedPassword)
            if (!account) return { error: 'NO_ACCOUNT' }
            if (store.some(w => w.type === 'cashu' && w.ownerAccountId === account.id)) {
              return { result: { skipped: true } }
            }
            let restoredWallet = null
            if (account.secretHex) {
              try {
                restoredWallet = (await restoreFromRelays(
                  hexToBytes(account.secretHex), account.pubkey,
                )).walletData
              } catch (error) {
                log.warn('cashu', 'AUTO_RESTORE_FAILED', { err: error?.message })
              }
            }
            const restoredMints = normalizeCashuMintList(restoredWallet?.mints)
            const restoredPrivkey = isValidCashuPrivkey(restoredWallet?.privkey)
              ? restoredWallet.privkey
              : null
            const walletId = await addCashuWallet(
              DEFAULT_WALLET_NAME,
              restoredMints.length > 0 ? restoredMints : [DEFAULT_MINT],
              _cachedPassword,
              account.id,
              restoredPrivkey,
            )
            log.info('cashu', 'AUTO_CREATED', { walletId })
            return { result: { walletId, restoredWalletState: !!restoredPrivkey } }
          }
          case 'CASHU_MINT_TOKENS': {
            const [mintUrl, amountSats, quoteId] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            await recoverCashuState(wallet)
            const configuredMint = requireConfiguredCashuMint(wallet, mintUrl)
            const result = await mintTokens(
              configuredMint,
              amountSats,
              quoteId,
              wallet.id,
              _cachedPassword,
              await getCashuSeed(wallet),
              wallet.cashuPrivkey,
            )
            // mintTokens returns only after the proofs are stored safely.
            await removeCashuMintQuote(wallet.id, _cachedPassword, quoteId)
            await recordCashuTx(wallet.id, {
              direction: 'in', amount: result.amountSats, description: 'Received via Lightning', state: 'settled',
              paymentHash: await cashuQuoteTransactionId(quoteId),
            }, _cachedPassword).catch(err =>
              log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message })
            )
            syncCashuToRelays(wallet, 'in', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            return { result: { amountSats: result.amountSats } }
          }
          case 'CASHU_CHECK_MINT_QUOTE': {
            const [mintUrl, quoteId] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const configuredMint = requireConfiguredCashuMint(wallet, mintUrl)
            const result = await checkMintQuote(
              configuredMint,
              quoteId,
              wallet.id,
              _cachedPassword,
              await getCashuSeed(wallet),
            )
            return { result }
          }
          case 'CASHU_WAIT_MINT_QUOTE': {
            const [mintUrl, quoteId] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const configuredMint = requireConfiguredCashuMint(wallet, mintUrl)
            return { result: await waitForMintQuote(
              configuredMint,
              quoteId,
              wallet.id,
              _cachedPassword,
              await getCashuSeed(wallet),
            ) }
          }
          case 'CASHU_CREATE_TOKEN': {
            const [amountSats, memo] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            await recoverCashuState(wallet)
            const seed = await getCashuSeed(wallet)
            const candidates = await getCashuMintCandidates(wallet, Number(amountSats))
            let result
            let lastBalanceError
            for (const mintUrl of candidates) {
              try {
                result = await createEcashToken(mintUrl, amountSats, wallet.id, _cachedPassword, memo, seed)
                break
              } catch (error) {
                if (error?.code !== 'CASHU_MINT_BALANCE') throw error
                lastBalanceError = error
              }
            }
            if (!result) throw lastBalanceError || new Error('No Cashu mint can cover this token')
            await recordCashuTx(wallet.id, {
              direction: 'out', amount: result.amountSats, description: memo || 'Sent token', state: 'settled',
            }, _cachedPassword).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'out', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            return { result }
          }
          case 'CASHU_RECEIVE_TOKEN': {
            const [tokenStr] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            await recoverCashuState(wallet)
            const result = await receiveEcashToken(
              tokenStr,
              wallet.id,
              _cachedPassword,
              await getCashuSeed(wallet),
              wallet.cashuPrivkey,
            )
            await addCashuMint(wallet.id, result.mint, _cachedPassword)
            await recordCashuTx(wallet.id, {
              direction: 'in', amount: result.amountSats, description: 'Redeemed token', state: 'settled',
            }, _cachedPassword).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'in', result.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            syncMintBackup(wallet)
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
          case 'CASHU_PREVIEW_IMPORT_BACKUP': {
            const [encryptedData, backupPassword] = params || []
            if (typeof encryptedData !== 'string' || encryptedData.length > 15_000_000) {
              return { error: 'INVALID_REQUEST' }
            }
            if (backupPassword != null
              && (typeof backupPassword !== 'string' || !backupPassword || backupPassword.length > 1024)) {
              return { error: 'INVALID_REQUEST' }
            }
            const parsed = await importCashuBackup(encryptedData, backupPassword || _cachedPassword)
            return { result: {
              mints: [...new Set([
                ...parsed.mints,
                ...parsed.proofSets.map(set => set.mint),
              ])],
              proofCount: parsed.proofSets.reduce((sum, set) => sum + set.proofs.length, 0),
              exportedAt: parsed.exportedAt,
              hasReceivingKey: !!parsed.cashuPrivkey,
            } }
          }
          case 'CASHU_IMPORT_BACKUP': {
            const [encryptedData, backupPassword] = params || []
            if (typeof encryptedData !== 'string' || encryptedData.length > 15_000_000) {
              return { error: 'INVALID_REQUEST' }
            }
            if (backupPassword != null
              && (typeof backupPassword !== 'string' || !backupPassword || backupPassword.length > 1024)) {
              return { error: 'INVALID_REQUEST' }
            }
            const parsed = await importCashuBackup(encryptedData, backupPassword || _cachedPassword)
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const receivingKeyRestored = await adoptRestoredCashuPrivkey(
              wallet, parsed.cashuPrivkey,
            )
            const seed = await getCashuSeed(wallet)
            await mergeCashuCounters(wallet.id, _cachedPassword, parsed.counters)
            let imported = 0
            for (const set of parsed.proofSets) {
              const recovered = await recoverExternalProofs(
                set.mint,
                set.proofs,
                wallet.id,
                _cachedPassword,
                seed,
                wallet.cashuPrivkey,
              )
              imported += recovered.proofs
              await addCashuMint(wallet.id, set.mint, _cachedPassword)
            }
            for (const mint of parsed.mints) await addCashuMint(wallet.id, mint, _cachedPassword)
            if (imported > 0) syncCashuToRelays(await getActiveWallet(_cachedPassword), 'in', 0).catch(() => {})
            return { result: { imported, mints: parsed.mints, receivingKeyRestored } }
          }
          case 'CASHU_PREVIEW_RELAY_RESTORE': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const account = await getCashuOwner(wallet)
            if (!account?.secretHex) return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const restored = await restoreFromRelays(hexToBytes(account.secretHex), account.pubkey)
            const mints = normalizeCashuMintList([
              ...(Array.isArray(restored.walletData?.mints) ? restored.walletData.mints : []),
              ...restored.proofSets.map(set => set.mint),
            ])
            return { result: {
              mints,
              proofCount: restored.proofSets.reduce((sum, set) => sum + set.proofs.length, 0),
              hasReceivingKey: isValidCashuPrivkey(restored.walletData?.privkey),
            } }
          }
          case 'CASHU_RESTORE_FROM_RELAY': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const account = await getCashuOwner(wallet)
            if (!account?.secretHex) return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const restored = await restoreFromRelays(hexToBytes(account.secretHex), account.pubkey)
            const restoredPrivkey = isValidCashuPrivkey(restored.walletData?.privkey)
              ? restored.walletData.privkey.toLowerCase()
              : null
            const receivingKeyRestored = await adoptRestoredCashuPrivkey(wallet, restoredPrivkey)
            const seed = await getCashuSeed(wallet)
            let proofCount = 0
            for (const set of restored.proofSets) {
              const recovered = await recoverExternalProofs(
                set.mint,
                set.proofs,
                wallet.id,
                _cachedPassword,
                seed,
                wallet.cashuPrivkey,
              )
              proofCount += recovered.proofs
              await addCashuMint(wallet.id, set.mint, _cachedPassword)
            }
            const restoredMints = normalizeCashuMintList(restored.walletData?.mints)
            for (const candidate of restoredMints) {
              await addCashuMint(wallet.id, candidate, _cachedPassword)
            }
            syncMintBackup(wallet)
            return { result: { proofCount, mints: restoredMints, receivingKeyRestored } }
          }
          case 'CASHU_PREVIEW_MINT_BACKUP': {
            // NUT-27: look up the mint list saved under this wallet's
            // recovery words and report mints not configured locally yet.
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const owner = await getCashuOwner(wallet)
            const seed = await getCashuSeed(wallet)
            if (!seed) return { error: 'CASHU_SEED_REQUIRED' }
            const backup = await fetchMintBackup(seed, owner?.pubkey).catch(() => null)
            const configured = new Set(wallet.mints || [])
            return { result: {
              mints: (backup?.mints || []).filter(mint => !configured.has(mint)),
              savedAt: backup?.timestamp || 0,
            } }
          }
          case 'CASHU_RESTORE_DETERMINISTIC': {
            const [extraMints] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const seed = await getCashuSeed(wallet)
            if (!seed) return { error: 'CASHU_SEED_REQUIRED' }
            // Mints the user chose to bring back from the NUT-27 backup.
            if (Array.isArray(extraMints)) {
              for (const candidate of extraMints.slice(0, 20)) {
                await addCashuMint(wallet.id, candidate, _cachedPassword)
              }
            }
            const current = await getActiveWallet(_cachedPassword)
            let proofCount = 0
            let amountSats = 0
            for (const mint of current?.mints || []) {
              const restored = await restoreDeterministicProofs(
                mint,
                wallet.id,
                _cachedPassword,
                seed,
              )
              proofCount += restored.proofs
              amountSats += restored.amountSats
            }
            if (proofCount > 0) syncCashuToRelays(wallet, 'in', amountSats).catch(() => {})
            if (Array.isArray(extraMints) && extraMints.length > 0) syncMintBackup(wallet)
            return { result: { proofCount, amountSats } }
          }
          case 'CASHU_RECOVER_PENDING': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const proofRecovery = await recoverCashuState(wallet, { throwOnPending: false })
            const incomingRecovery = await recoverPendingCashuMintQuotes(wallet)
            return { result: { ...proofRecovery, ...incomingRecovery } }
          }
          case 'GET_CASHU_MINT_URL': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (wallet?.type === 'cashu' && wallet.mints?.length) {
              return { result: wallet.mints[0] }
            }
            return { result: null }
          }
          case 'CASHU_GET_MINT_BALANCES': {
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const snapshot = await getCashuSpendableSnapshot(wallet)
            const balances = new Map(snapshot.balances.map(set => [set.mint, set.balance]))
            const mints = [...new Set([...(wallet.mints || []), ...snapshot.balances.map(set => set.mint)])]
            return { result: mints.map((mint, index) => ({
              mint,
              balance: balances.get(mint) || 0,
              preferred: index === 0,
            })) }
          }
          case 'CASHU_UPDATE_MINTS': {
            const [walletId, mints] = params || []
            if (!Array.isArray(mints) || mints.length !== 1) return { error: 'INVALID_REQUEST' }
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu' || wallet.id !== walletId) return { error: 'NO_WALLET' }
            const updatedMints = await addCashuMint(walletId, mints[0], _cachedPassword, { preferred: true })
            const owner = await getCashuOwner(wallet)
            const updatedWallet = await getActiveWallet(_cachedPassword)
            if (owner?.secretHex) {
              publishWalletEvent(
                hexToBytes(owner.secretHex),
                updatedWallet.cashuPrivkey,
                updatedMints,
                owner.pubkey,
              ).catch(() => {})
            }
            syncMintBackup(wallet)
            return { result: { ok: true, mints: updatedMints } }
          }

          // ── Cashu payment requests (NUT-18 / NUT-26) ──
          case 'CASHU_CREATE_PAYMENT_REQUEST': {
            const [amountSats, memo] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const owner = await getCashuOwner(wallet)
            if (!owner?.secretHex) return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            if (amountSats != null && (!Number.isSafeInteger(amountSats) || amountSats <= 0)) {
              return { error: 'INVALID_REQUEST' }
            }
            // 140 matches the payload memo cap so nothing is silently cut off.
            if (memo != null && (typeof memo !== 'string' || memo.length > 140)) {
              return { error: 'INVALID_REQUEST' }
            }
            const relays = (await getPoolRelays(owner.pubkey, 'chat').catch(() => [])).slice(0, 3)
            const id = makePaymentRequestId()
            const encoded = buildPaymentRequest({
              id,
              amountSats: amountSats ?? null,
              description: memo || '',
              mints: wallet.mints || [],
              nprofile: nip19.nprofileEncode({ pubkey: owner.pubkey, relays }),
            })
            return { result: { encoded, id } }
          }
          case 'CASHU_CHECK_REQUEST_PAYMENT': {
            const [requestId] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            const owner = await getCashuOwner(wallet)
            if (!owner?.secretHex) return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            return { result: await scanIncomingRequestPayments(wallet, owner, { requestId }) }
          }
          case 'CASHU_PAY_REQUEST': {
            const [encoded, chosenAmountSats, memo] = params || []
            const wallet = await getActiveWallet(_cachedPassword)
            if (!wallet || wallet.type !== 'cashu') return { error: 'NO_WALLET' }
            // 140 matches the payload memo cap so nothing is silently cut off.
            if (memo != null && (typeof memo !== 'string' || memo.length > 140)) {
              return { error: 'INVALID_REQUEST' }
            }
            const info = decodePaymentRequestInfo(encoded)
            if (!info.valid || info.locked) return { error: 'INVALID_REQUEST' }
            const amountSats = info.amountSats ?? Number(chosenAmountSats)
            if (!Number.isSafeInteger(amountSats) || amountSats <= 0) return { error: 'INVALID_REQUEST' }

            // Everything that can refuse the payment runs before any money moves.
            const transport = info.transports.find(entry => entry.type === 'nostr')
              || info.transports.find(entry => entry.type === 'post')
            if (!transport) return { error: 'REQUEST_NO_TRANSPORT' }
            const owner = await getCashuOwner(wallet)
            if (transport.type === 'nostr' && !owner?.secretHex) {
              return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            }
            await recoverCashuState(wallet)
            const snapshot = await getCashuSpendableSnapshot(wallet)
            const balances = new Map(snapshot.balances.map(entry => [entry.mint, entry.balance]))
            // The request's mint list is strict (NUT-18): only pay from one
            // of those mints. Without a list, any funded mint works.
            const accepted = info.mints.length
              ? info.mints
              : [...new Set([...(wallet.mints || []), ...balances.keys()])]
            if (info.mints.length && !accepted.some(mint => (balances.get(mint) || 0) > 0)) {
              return { error: 'REQUEST_MINT_MISMATCH' }
            }
            const mintUrl = accepted.find(mint => (balances.get(mint) || 0) >= amountSats)
            if (!mintUrl) {
              const error = new Error('Insufficient balance at the accepted mints')
              error.code = 'CASHU_MINT_BALANCE'
              throw error
            }

            const seed = await getCashuSeed(wallet)
            // includeFees: the receiver must net the requested amount (NUT-18).
            const created = await createEcashToken(
              mintUrl, amountSats, wallet.id, _cachedPassword, memo, seed, { includeFees: true },
            )
            const payloadJson = JSON.stringify(buildPaymentPayload({
              id: info.id,
              memo,
              mint: mintUrl,
              proofs: getDecodedToken(created.token).proofs,
            }))

            let delivered = false
            let deliveryError = ''
            if (transport.type === 'post') {
              try {
                const response = await fetch(transport.url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: payloadJson,
                  signal: AbortSignal.timeout(15_000),
                })
                delivered = response.ok
                if (!response.ok) deliveryError = `HTTP ${response.status}`
              } catch (err) {
                deliveryError = err?.message || 'Network error'
              }
            } else {
              const secretKey = hexToBytes(owner.secretHex)
              const rumor = nip59.createRumor({
                kind: 14,
                content: payloadJson,
                tags: [['p', transport.pubkey]],
                created_at: Math.floor(Date.now() / 1000),
              }, owner.pubkey)
              const seal = nip59.createSeal(rumor, secretKey, transport.pubkey)
              const wrap = nip59.createWrap(seal, transport.pubkey)
              // No self-copy on purpose: the payload is wallet plumbing, not
              // a chat message the payer should see in their own thread.
              const ownRelays = await getPoolRelays(owner.pubkey, 'chat').catch(() => [])
              const relays = [...new Set([...(transport.relays || []), ...ownRelays])]
                .filter(url => typeof url === 'string' && url.startsWith('wss://'))
                .slice(0, 8)
              const pool = getPool()
              const results = await Promise.allSettled(relays.map(url => pool.publish([url], wrap)))
              delivered = results.some(entry => entry.status === 'fulfilled')
              if (!delivered) deliveryError = 'No relay accepted the message'
            }

            await recordCashuTx(wallet.id, {
              direction: 'out', amount: created.amountSats,
              description: memo || info.description || 'Payment request', state: 'settled',
            }, _cachedPassword).catch(err => log.warn('cashu', 'TX_RECORD_FAILED', { err: err?.message }))
            syncCashuToRelays(wallet, 'out', created.amountSats).catch(err =>
              log.warn('cashu', 'RELAY_SYNC_FAILED', { err: err?.message })
            )
            if (delivered) {
              return { result: { delivered: true, amountSats: created.amountSats } }
            }
            // The sats already left this wallet as the token below. Hand it
            // back so the user can share it manually or redeem it again.
            return { result: {
              delivered: false,
              token: created.token,
              amountSats: created.amountSats,
              deliveryError,
            } }
          }

          // ── Zaps (NIP-57) ──
          case 'SEND_ZAP': {
            const { recipientPubkey, amountSats, lightningAddress, content, payRequest } = params?.[0] || {}
            const addressMatch = typeof lightningAddress === 'string'
              ? lightningAddress.trim().match(/^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i)
              : null
            if (!/^[0-9a-f]{64}$/i.test(recipientPubkey || '')
              || !addressMatch
              || !Number.isSafeInteger(amountSats) || amountSats <= 0 || amountSats > 100_000_000
              || typeof content !== 'undefined' && (typeof content !== 'string' || content.length > 500)) {
              return { error: 'INVALID_REQUEST' }
            }
            const account = await getActiveAccount(_cachedPassword)
            const amountMsats = amountSats * 1000

            // Try NIP-57 for local accounts
            if (account?.secretHex) {
              try {
                const [, name, domain] = addressMatch
                const lnurlPayUrl = `https://${domain}/.well-known/lnurlp/${name}`
                let payReq = payRequest
                if (payReq) {
                  const callback = requireSecureUrl(payReq.callback).toString()
                  if (payReq.tag !== 'payRequest'
                    || !Number.isSafeInteger(payReq.minSendable)
                    || !Number.isSafeInteger(payReq.maxSendable)
                    || amountMsats < payReq.minSendable || amountMsats > payReq.maxSendable) {
                    throw new Error('Invalid LNURL pay request')
                  }
                  payReq = { ...payReq, callback }
                } else {
                  payReq = await fetchPayRequest(lnurlPayUrl)
                }
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
          case 'TOGGLE_ALLOWANCE':
            await setAllowanceEnabled(params?.[0], params?.[1])
            return { result: { ok: true } }
          case 'GET_ACTIVE_TAB_INFO': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.url || tab.url.startsWith('chrome') || tab.url.startsWith('about') || tab.url.startsWith('moz-extension')) {
              return { result: null }
            }
            try {
              const url = new URL(tab.url)
              return { result: { origin: url.origin, host: url.host, title: tab.title, favIconUrl: tab.favIconUrl } }
            } catch { return { result: null } }
          }

          // ── Permissions ──
          case 'GET_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            return { result: await getPermissions(activeId) }
          }
          case 'GET_SESSION_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            return { result: permissionSession.listGrants(activeId) }
          }
          case 'REVOKE_SESSION_PERMISSION':
            return { result: { removed: permissionSession.revoke(params?.[0]) } }
          case 'CLEAR_SESSION_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            const origin = params?.[0]
            if (origin) permissionSession.clearOrigin(activeId, origin)
            else permissionSession.clear()
            return { result: { removed: true } }
          }
          case 'REMOVE_PERMISSION': {
            const activeId = await getActiveAccountId()
            await removePermission(params?.[0], params?.[1], activeId)
            return { result: { removed: true } }
          }
          case 'REMOVE_DOMAIN_PERMISSIONS': {
            const activeId = await getActiveAccountId()
            await removeDomainPermissions(params?.[0], activeId)
            permissionSession.clearOrigin(activeId, params?.[0])
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
            const [targetEventId, recipientPubkey, emoji] = params || []
            if (!targetEventId || !recipientPubkey) return { error: 'Missing parameters' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)

            // Create kind 7 reaction as a rumor, then gift-wrap for DM privacy
            const reactionTemplate = {
              kind: 7,
              content: emoji || '+',
              tags: [['e', targetEventId], ['p', recipientPubkey]],
              created_at: Math.floor(Date.now() / 1000),
            }
            const rumor = nip59.createRumor(reactionTemplate, account.pubkey)
            // Wrap for recipient
            const sealR = nip59.createSeal(rumor, secretKey, recipientPubkey)
            const wrapR = nip59.createWrap(sealR, recipientPubkey)
            // Self-copy
            const sealS = nip59.createSeal(rumor, secretKey, account.pubkey)
            const wrapS = nip59.createWrap(sealS, account.pubkey)

            const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => [])
            const pool = getPool()
            await Promise.allSettled([
              ...chatRelays.map(url => pool.publish([url], wrapR)),
              ...chatRelays.map(url => pool.publish([url], wrapS)),
            ])
            return { result: { sent: true, reactionId: rumor.id } }
          }

          // ── Event deletion (NIP-09, gift-wrapped for DM privacy) ──
          case 'DELETE_EVENT': {
            const [eventId, recipientPubkey, reason] = params || []
            if (!eventId) return { error: 'No event ID' }
            const account = await getActiveAccount(_cachedPassword)
            if (!account || account.mode !== 'local') return { error: 'LOCAL_ACCOUNT_REQUIRED' }
            const secretKey = hexToBytes(account.secretHex)

            // If recipientPubkey provided, send as gift-wrapped rumor (DM context)
            if (recipientPubkey) {
              const deletionTemplate = {
                kind: 5,
                content: reason || '',
                tags: [['e', eventId]],
                created_at: Math.floor(Date.now() / 1000),
              }
              const rumor = nip59.createRumor(deletionTemplate, account.pubkey)
              const sealR = nip59.createSeal(rumor, secretKey, recipientPubkey)
              const wrapR = nip59.createWrap(sealR, recipientPubkey)
              const sealS = nip59.createSeal(rumor, secretKey, account.pubkey)
              const wrapS = nip59.createWrap(sealS, account.pubkey)

              const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => [])
              const pool = getPool()
              await Promise.allSettled([
                ...chatRelays.map(url => pool.publish([url], wrapR)),
                ...chatRelays.map(url => pool.publish([url], wrapS)),
              ])
              return { result: { deleted: true, eventId } }
            }

            // Public deletion (non-DM context)
            const deletion = nip09.createDeletionEvent(
              { targets: [{ type: 'event', id: eventId }], reason: reason || '' },
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
          case 'NOTIFY_PAYMENT': {
            const { amountSats, paymentHash } = params?.[0] || {}
            await notifyPayment(amountSats, paymentHash)
            return { result: { ok: true } }
          }

          // ── Unlock prompt response ──
          case 'UNLOCK_RESPONSE': {
            const { requestId: unlockReqId, password } = params?.[0] || {}
            try {
              const authentication = await authenticateMasterPassword(password)
              if (!authentication.valid) return { error: authentication.error }
              _cachedPassword = password
              await saveSession({ password, unlockedAt: Date.now() })
              rejectedOrigins.clear()
              // Resolve the waiting request if its coordinator entry survived. If
              // the worker was recycled between opening the prompt and now, the
              // entry is gone and resolve() is a harmless no-op, but the unlock
              // itself persisted (chrome.storage.session), so the dApp's retry
              // succeeds without re-prompting. (No early `has()` reject: a correct
              // password must never be silently dropped.)
              await requestCoordinator.resolve(unlockReqId, true)
              return { result: { ok: true } }
            } catch (err) {
              return { error: classifyError(err) }
            }
          }

          // ── Permission prompt response ──
          case 'PERMISSION_RESPONSE': {
            const payload = params?.[0] || {}
            const { requestId, decision, setBudget } = payload
            const validDecisions = new Set([
              'allow_session', 'allow_once', 'deny_once',
              'allow_always', 'deny_always', 'allow_all', 'deny_all',
            ])
            if (!requestId || !validDecisions.has(decision)) return { error: 'INVALID_PERMISSION_RESPONSE' }

            // Never trust scope fields from the prompt URL or response. This
            // context was created by the background and persisted in memory-only
            // session storage so it survives an MV3 worker restart.
            const scope = requestCoordinator.getContext(requestId)
              || await requestCoordinator.getPersistedContext(requestId)
            if (!scope || Date.now() - scope.createdAt > 5 * 60 * 1000) {
              await requestCoordinator.clearPromptData(requestId)
              return { error: 'EXPIRED_PERMISSION_REQUEST' }
            }
            const { profileId, origin, method, kind } = scope
            if (!profileId || !origin || !method) return { error: 'INVALID_PERMISSION_SCOPE' }

            // Persist a user-selected budget before waking the payment handler,
            // so its just-approved payment is counted against the new limit.
            if (setBudget && decision.startsWith('allow')) {
              try {
                const safeBudget = validateSats(setBudget)
                await setAllowance(origin, safeBudget)
                log.info('permissions', 'BUDGET_SET_FROM_PROMPT', { origin, budget: safeBudget })
              } catch (err) {
                log.warn('permissions', 'BUDGET_SET_FAILED', { origin, err: err?.message })
              }
            }

            if (decision === 'allow_all') {
              // Grant all standard permissions for this exact origin.
              for (const m of ALL_PERMISSION_METHODS) {
                await setPermission(origin, m, 'allow', null, profileId)
              }
              await requestCoordinator.resolve(requestId, true)
            } else if (decision === 'deny_all') {
              for (const m of [...ALL_PERMISSION_METHODS, ...PAYMENT_METHODS]) {
                await setPermission(origin, m, 'deny', null, profileId)
              }
              await requestCoordinator.resolve(requestId, false)
            } else if (decision === 'allow_session') {
              if (!scope.isPayment) permissionSession.grant(scope)
              await requestCoordinator.resolve(requestId, true)
            } else if (decision === 'allow_always' || decision === 'deny_always') {
              await setPermission(origin, method, decision === 'allow_always' ? 'allow' : 'deny', kind ?? null, profileId)
              await requestCoordinator.resolve(requestId, decision === 'allow_always')
            } else {
              await requestCoordinator.resolve(requestId, decision === 'allow_once')
            }

            await requestCoordinator.clearPromptData(requestId)

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
