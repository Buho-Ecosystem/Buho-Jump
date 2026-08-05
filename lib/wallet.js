/**
 * Multi-wallet management — NWC, Cashu (NIP-60), and LNbits.
 *
 * Storage shape (encrypted blob in chrome.storage.local under `walletConfigs`):
 * {
 *   wallets: [
 *     // NWC wallet
 *     { id, type: 'nwc', name, connectionUri, createdAt },
 *     // Cashu wallet
 *     { id, type: 'cashu', name, mints: ['https://...'], unit: 'sat', createdAt },
 *     // LNbits wallet
 *     { id, type: 'lnbits', name, apiUrl, adminKey, lnbitsWalletId, createdAt },
 *   ],
 *   activeWalletId: "<id>" | null
 * }
 *
 * Connection URIs and proof references are encrypted at rest with the user's
 * session password using AES-256-GCM via lib/crypto.js.
 */

import { encryptData, decryptData, encryptionNeedsUpgrade } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'
import { requireSecureUrl } from './origins.js'
import { generateSecretKey, bytesToHex, getPublicKey, hexToBytes } from 'nostr-core'

const STORAGE_KEY = 'walletConfigs'
const LEGACY_KEY = 'walletConfig'

// ── Internal helpers ──

function generateId() {
  return crypto.randomUUID()
}

function normalizeCashuPrivkey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) throw new Error('Invalid Cashu wallet private key')
  const secretKey = hexToBytes(value)
  try {
    getPublicKey(secretKey)
    return value.toLowerCase()
  } catch {
    throw new Error('Invalid Cashu wallet private key')
  } finally {
    secretKey.fill(0)
  }
}

function emptyStore() {
  return { wallets: [], activeWalletId: null }
}

/**
 * Read and decrypt the wallet store. Returns the full object or an empty store.
 * Handles transparent migration from the legacy single-wallet format.
 */
async function readStore(password) {
  if (!password) return emptyStore()

  // Try new multi-wallet key first
  const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_KEY])

  if (data[STORAGE_KEY]?.encrypted) {
    try {
      const store = await decryptData(data[STORAGE_KEY].encrypted, password)
      if (!store || !Array.isArray(store.wallets)) throw new Error('Wallet vault has an invalid shape')
      // Normalize: ensure every wallet has a type (backwards compat)
      let storeChanged = false
      for (const w of store.wallets) {
        if (!w.type) w.type = 'nwc'
        if (w.type === 'cashu') {
          if (!w.cashuPrivkey) {
            w.cashuPrivkey = bytesToHex(generateSecretKey())
            storeChanged = true
          } else {
            const normalizedKey = normalizeCashuPrivkey(w.cashuPrivkey)
            if (normalizedKey !== w.cashuPrivkey) {
              w.cashuPrivkey = normalizedKey
              storeChanged = true
            }
          }
        }
      }
      if (storeChanged || encryptionNeedsUpgrade(data[STORAGE_KEY].encrypted)) await writeStore(store, password)
      return store
    } catch (error) {
      throw vaultIntegrityError('Wallet vault', error)
    }
  }

  // Migrate from legacy single-wallet format
  const legacy = data[LEGACY_KEY]
  if (legacy) {
    const migrated = await migrateLegacy(legacy, password)
    if (migrated) return migrated
  }

  return emptyStore()
}

/**
 * Encrypt and persist the wallet store.
 */
async function writeStore(store, password) {
  if (!password) throw new Error('Password required to save wallet config')
  const encrypted = await encryptData(store, password)
  await verifiedSet(STORAGE_KEY, { encrypted })
}

/**
 * Migrate legacy `walletConfig` to the new multi-wallet format.
 * Preserves the existing connection, removes the old key only after success.
 */
async function migrateLegacy(legacy, password) {
  let connectionUri = null

  // Legacy unencrypted format
  if (legacy.connectionUri) {
    connectionUri = legacy.connectionUri
  }
  // Legacy encrypted format
  else if (legacy.encrypted && password) {
    try {
      const decrypted = await decryptData(legacy.encrypted, password)
      connectionUri = decrypted?.connectionUri
    } catch (error) {
      throw vaultIntegrityError('Legacy wallet vault', error)
    }
  }

  if (!connectionUri) return null

  const store = {
    wallets: [{
      id: generateId(),
      name: 'My Wallet',
      connectionUri,
      createdAt: Date.now(),
    }],
    activeWalletId: null,
  }
  store.activeWalletId = store.wallets[0].id

  // Write new format, then remove legacy key
  await writeStore(store, password)
  await chrome.storage.local.remove(LEGACY_KEY)

  return store
}

// ── Public API ──

/**
 * Get the full wallet store (wallets array + activeWalletId).
 * Each wallet in the returned array has: id, name, connectionUri, createdAt.
 */
export async function getWalletStore(password) {
  return readStore(password)
}

/**
 * Get a summary list of wallets (no URIs exposed — safe for popup).
 * Returns [{ id, name, isActive, createdAt }].
 */
export async function getWalletSummaries(password) {
  const store = await readStore(password)
  return store.wallets.map(w => ({
    id: w.id,
    name: w.name,
    type: w.type || 'nwc',
    ...(w.type === 'cashu' ? { mints: [...(w.mints || [])] } : {}),
    ...(w.type === 'cashu' && w.ownerAccountId ? { ownerAccountId: w.ownerAccountId } : {}),
    isActive: w.id === store.activeWalletId,
    createdAt: w.createdAt,
  }))
}

/**
 * Get the active wallet config (id, name, connectionUri) or null.
 */
export async function getActiveWallet(password) {
  const store = await readStore(password)
  if (!store.activeWalletId) return null
  return store.wallets.find(w => w.id === store.activeWalletId) || null
}

/**
 * Add a new wallet and set it as active.
 * Returns the created wallet's id.
 * Validates NWC URI structure before storing.
 */
export async function addWallet(connectionUri, name, password) {
  validateNwcConnectionUri(connectionUri)
  const store = await readStore(password)

  const wallet = {
    id: generateId(),
    type: 'nwc',
    name: name || `Wallet ${store.wallets.length + 1}`,
    connectionUri,
    createdAt: Date.now(),
  }

  store.wallets.push(wallet)
  store.activeWalletId = wallet.id
  await writeStore(store, password)
  return wallet.id
}

export function validateNwcConnectionUri(connectionUri) {
  // Validate NWC URI structure: scheme + pubkey + secret + at least one relay
  if (!connectionUri || !connectionUri.startsWith('nostr+walletconnect://')) {
    throw new Error('Invalid wallet connection string')
  }
  try {
    const parsed = new URL(connectionUri.replace('nostr+walletconnect://', 'https://'))
    if (!/^[0-9a-f]{64}$/i.test(parsed.hostname)) throw new Error('Missing wallet key')
    if (!/^[0-9a-f]{64}$/i.test(parsed.searchParams.get('secret') || '')) throw new Error('Missing secret')
    const relays = parsed.searchParams.getAll('relay')
    if (!relays.length || relays.some((relay) => {
      try {
        const url = new URL(relay)
        return url.protocol !== 'wss:' || !!url.username || !!url.password
      } catch {
        return true
      }
    })) throw new Error('Missing secure relay')
  } catch (e) {
    throw new Error('Invalid wallet connection string')
  }
  return connectionUri
}

/**
 * Remove a wallet by id. If it was the active wallet, activates the next
 * available wallet (or sets activeWalletId to null).
 */
export async function removeWallet(walletId, password) {
  const store = await readStore(password)
  const idx = store.wallets.findIndex(w => w.id === walletId)
  if (idx === -1) return

  store.wallets.splice(idx, 1)

  if (store.activeWalletId === walletId) {
    store.activeWalletId = store.wallets[0]?.id || null
  }

  await writeStore(store, password)
}

/**
 * Set the active wallet by id.
 */
export async function setActiveWallet(walletId, password) {
  const store = await readStore(password)
  const exists = store.wallets.some(w => w.id === walletId)
  if (!exists) throw new Error('Wallet not found')

  store.activeWalletId = walletId
  await writeStore(store, password)
}

/**
 * Rename a wallet.
 */
export async function renameWallet(walletId, name, password) {
  const store = await readStore(password)
  const wallet = store.wallets.find(w => w.id === walletId)
  if (!wallet) throw new Error('Wallet not found')

  wallet.name = name
  await writeStore(store, password)
}

/**
 * Re-encrypt the entire wallet store with a new password.
 * Called during password change to avoid losing access.
 */
export async function reEncryptWallets(oldPassword, newPassword) {
  const store = await readStore(oldPassword)
  // Nothing to re-encrypt if there are no wallets
  if (store.wallets.length === 0) {
    // Clean up any stale storage key
    await chrome.storage.local.remove(STORAGE_KEY)
    return
  }
  await writeStore(store, newPassword)
}

/**
 * Check if any wallet is currently active.
 */
export async function hasActiveWallet(password) {
  const wallet = await getActiveWallet(password)
  if (!wallet) return false
  return wallet.type === 'nwc' || wallet.type === 'cashu' || wallet.type === 'lnbits'
}

/**
 * Remove all wallets (full reset).
 */
export async function clearAllWallets() {
  await chrome.storage.local.remove([STORAGE_KEY, LEGACY_KEY])
}

// ── Cashu wallet helpers ──

/**
 * Add a Cashu wallet and set it as active.
 * @param {string} name - wallet display name
 * @param {string[]} mints - array of mint URLs
 * @param {string} password - session password
 * @returns {string} wallet id
 */
export async function addCashuWallet(name, mints, password, ownerAccountId = null, restoredPrivkey = null) {
  const store = await readStore(password)
  const secureMints = [...new Set((mints || []).map(mint => requireSecureUrl(mint, { allowLoopback: true }).toString().replace(/\/$/, '')))]
  if (secureMints.length === 0 || secureMints.length > 20) throw new Error('Cashu wallet needs 1 to 20 secure mints')
  const privateKey = restoredPrivkey != null
    ? normalizeCashuPrivkey(restoredPrivkey)
    : bytesToHex(generateSecretKey())

  const wallet = {
    id: generateId(),
    type: 'cashu',
    name: name || 'My Wallet',
    mints: secureMints,
    cashuPrivkey: privateKey,
    ownerAccountId: typeof ownerAccountId === 'string' ? ownerAccountId : null,
    unit: 'sat',
    createdAt: Date.now(),
  }

  store.wallets.push(wallet)
  store.activeWalletId = wallet.id
  await writeStore(store, password)
  return wallet.id
}

export async function setCashuWalletPrivkey(walletId, cashuPrivkey, password) {
  const privateKey = normalizeCashuPrivkey(cashuPrivkey)
  const store = await readStore(password)
  const wallet = store.wallets.find(item => item.id === walletId && item.type === 'cashu')
  if (!wallet) throw new Error('Cashu wallet not found')
  wallet.cashuPrivkey = privateKey
  await writeStore(store, password)
  return wallet.cashuPrivkey
}

export async function bindCashuWalletOwner(walletId, accountId, password) {
  if (typeof accountId !== 'string' || !accountId) throw new Error('Account ID required')
  const store = await readStore(password)
  const wallet = store.wallets.find(w => w.id === walletId)
  if (!wallet || wallet.type !== 'cashu') throw new Error('Cashu wallet not found')
  if (wallet.ownerAccountId && wallet.ownerAccountId !== accountId) return wallet.ownerAccountId
  wallet.ownerAccountId = accountId
  await writeStore(store, password)
  return accountId
}

// ── LNbits wallet helpers ──

/**
 * Add an LNbits wallet and set it as active.
 * @param {string} apiUrl - LNbits instance URL (e.g. "https://legend.lnbits.com")
 * @param {string} adminKey - Admin API key
 * @param {string} lnbitsWalletId - Wallet ID returned by LNbits
 * @param {string} name - display name
 * @param {string} password - session password
 * @returns {string} wallet id
 */
export async function addLnbitsWallet(apiUrl, adminKey, lnbitsWalletId, name, password) {
  const store = await readStore(password)
  const secureApiUrl = requireSecureUrl(apiUrl, { allowLoopback: true }).toString().replace(/\/$/, '')
  if (typeof adminKey !== 'string' || !adminKey || adminKey.length > 4096) throw new Error('Invalid LNbits API key')
  if (typeof lnbitsWalletId !== 'string' || !lnbitsWalletId || lnbitsWalletId.length > 256) throw new Error('Invalid LNbits wallet ID')

  const wallet = {
    id: generateId(),
    type: 'lnbits',
    name: name || 'LNbits Wallet',
    apiUrl: secureApiUrl,
    adminKey,
    lnbitsWalletId,
    createdAt: Date.now(),
  }

  store.wallets.push(wallet)
  store.activeWalletId = wallet.id
  await writeStore(store, password)
  return wallet.id
}

/**
 * Update mint list for a Cashu wallet.
 */
export async function updateCashuMints(walletId, mints, password) {
  const store = await readStore(password)
  const wallet = store.wallets.find(w => w.id === walletId)
  if (!wallet || wallet.type !== 'cashu') throw new Error('Cashu wallet not found')
  const secureMints = [...new Set((mints || []).map(mint => requireSecureUrl(mint, { allowLoopback: true }).toString().replace(/\/$/, '')))]
  if (secureMints.length === 0 || secureMints.length > 20) throw new Error('Cashu wallet needs 1 to 20 secure mints')
  wallet.mints = secureMints
  if (!wallet.cashuPrivkey) wallet.cashuPrivkey = bytesToHex(generateSecretKey())
  await writeStore(store, password)
}

/** Add a mint and optionally make it the preferred mint without dropping old funds. */
export async function addCashuMint(walletId, mintUrl, password, { preferred = false } = {}) {
  const store = await readStore(password)
  const wallet = store.wallets.find(w => w.id === walletId)
  if (!wallet || wallet.type !== 'cashu') throw new Error('Cashu wallet not found')
  const mint = requireSecureUrl(mintUrl, { allowLoopback: true }).toString().replace(/\/$/, '')
  const existing = (wallet.mints || []).filter(value => value !== mint)
  wallet.mints = preferred ? [mint, ...existing] : [...existing, mint]
  if (wallet.mints.length > 20) throw new Error('Cashu wallet supports at most 20 mints')
  if (!wallet.cashuPrivkey) wallet.cashuPrivkey = bytesToHex(generateSecretKey())
  await writeStore(store, password)
  return wallet.mints
}
