/**
 * Account management — create, import, switch Nostr identities.
 *
 * Secrets (secretHex, nip46ClientSecretHex) are encrypted at rest
 * using AES-256-GCM via lib/crypto.js, following the same pattern
 * as lib/wallet.js. All functions that read or write accounts
 * require the session password.
 *
 * Migration: if stored `accounts` is a plain object (no `.encrypted`
 * key), it is auto-encrypted on first read after upgrade.
 */

import { generateSecretKey, getPublicKey, nip06, nip19, bytesToHex, hexToBytes } from 'nostr-core'
import { encryptData, decryptData } from './crypto.js'
import { verifiedSet } from './storage.js'

const STORAGE_KEY = 'accounts'

// ── Encrypted storage helpers (mirrors wallet.js pattern) ──

/**
 * Read and decrypt accounts from storage.
 * Handles migration from legacy plaintext format.
 */
async function readAccounts(password) {
  if (!password) return {}

  const data = await chrome.storage.local.get(STORAGE_KEY)
  const stored = data[STORAGE_KEY]

  if (!stored) return {}

  // New encrypted format: { encrypted: "base64_blob" }
  if (stored.encrypted) {
    try {
      return await decryptData(stored.encrypted, password)
    } catch {
      return {}
    }
  }

  // Legacy plaintext format — migrate to encrypted
  if (typeof stored === 'object' && !stored.encrypted) {
    try {
      await writeAccounts(stored, password)
    } catch { /* migration failed — will retry next read */ }
    return stored
  }

  return {}
}

/**
 * Encrypt and persist accounts to storage.
 */
async function writeAccounts(accounts, password) {
  if (!password) throw new Error('Password required to save accounts')
  const encrypted = await encryptData(accounts, password)
  await verifiedSet(STORAGE_KEY, { encrypted })
}

// ── Public API ──

export async function getAccounts(password) {
  return readAccounts(password)
}

export async function getActiveAccountId() {
  const data = await chrome.storage.local.get('activeAccountId')
  return data.activeAccountId || null
}

export async function getActiveAccount(password) {
  const accounts = await getAccounts(password)
  const activeId = await getActiveAccountId()
  return activeId ? accounts[activeId] || null : null
}

export async function setActiveAccount(accountId) {
  await chrome.storage.local.set({ activeAccountId: accountId })
}

export async function createLocalAccount(password, name) {
  const secretKey = generateSecretKey()
  const secretHex = bytesToHex(secretKey)
  const pubkey = getPublicKey(secretKey)
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || '',
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await readAccounts(password)
  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey),
  }
}

export async function createAccountWithMnemonic(password, name) {
  const mnemonic = nip06.generateMnemonic(12)
  const derived = nip06.mnemonicToKey(mnemonic)
  const secretHex = bytesToHex(derived.secretKey)
  const pubkey = derived.publicKey
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || '',
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await readAccounts(password)
  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(derived.secretKey),
    mnemonic,
  }
}

export async function importFromMnemonic(password, name, mnemonic) {
  const words = mnemonic.trim().toLowerCase()
  if (!nip06.validateMnemonic(words)) {
    throw new Error('Invalid recovery words')
  }

  const derived = nip06.mnemonicToKey(words)
  const secretHex = bytesToHex(derived.secretKey)
  const pubkey = derived.publicKey
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || '',
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await readAccounts(password)
  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(derived.secretKey),
  }
}

export async function importAccount(password, name, nsecOrHex) {
  let secretHex

  if (nsecOrHex.startsWith('nsec')) {
    const decoded = nip19.decode(nsecOrHex)
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
    secretHex = bytesToHex(decoded.data)
  } else {
    if (!/^[0-9a-f]{64}$/i.test(nsecOrHex)) throw new Error('Invalid hex key')
    secretHex = nsecOrHex.toLowerCase()
  }

  const pubkey = getPublicKey(hexToBytes(secretHex))

  // Check for duplicate — same pubkey already imported
  const accounts = await readAccounts(password)
  const existing = Object.values(accounts).find(a => a.pubkey === pubkey)
  if (existing) {
    // Switch to the existing account instead of creating a duplicate
    await setActiveAccount(existing.id)
    return existing
  }

  const id = crypto.randomUUID()
  const account = {
    id,
    name: name || '',
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(hexToBytes(secretHex)),
  }
}

export async function createNip46Account(password, name) {
  const clientSecret = generateSecretKey()
  const clientSecretHex = bytesToHex(clientSecret)
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || '',
    pubkey: null,
    secretHex: null,
    mode: 'nip46',
    nip46Session: null,
    nip46ClientSecretHex: clientSecretHex,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await readAccounts(password)
  accounts[id] = account
  await writeAccounts(accounts, password)

  return account
}

export async function updateAccount(password, accountId, updates) {
  const accounts = await readAccounts(password)
  if (!accounts[accountId]) return null
  Object.assign(accounts[accountId], updates)
  await writeAccounts(accounts, password)
  return accounts[accountId]
}

export async function removeAccount(password, accountId) {
  const accounts = await readAccounts(password)
  delete accounts[accountId]
  await writeAccounts(accounts, password)

  const activeId = await getActiveAccountId()
  if (activeId === accountId) {
    const remaining = Object.keys(accounts)
    await setActiveAccount(remaining.length > 0 ? remaining[0] : null)
  }
}

export async function getAccountSummaries(password) {
  const accounts = await readAccounts(password)
  const activeId = await getActiveAccountId()

  return Object.values(accounts).map((a) => ({
    id: a.id,
    name: a.name,
    pubkey: a.pubkey,
    npub: a.pubkey ? nip19.npubEncode(a.pubkey) : null,
    mode: a.mode,
    isActive: a.id === activeId,
    createdAt: a.createdAt,
  }))
}

/**
 * Re-encrypt all accounts with a new password.
 * Called during password change alongside reEncryptWallets.
 */
export async function reEncryptAccounts(oldPassword, newPassword) {
  const accounts = await readAccounts(oldPassword)
  if (Object.keys(accounts).length === 0) return
  await writeAccounts(accounts, newPassword)
}
