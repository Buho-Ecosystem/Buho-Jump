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
import { encryptData, decryptData, encryptionNeedsUpgrade } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'
import { deriveNip06Identity, normalizeMnemonic } from './nostrIdentity.js'

const STORAGE_KEY = 'accounts'

function publicAccount(account) {
  if (!account) return null
  const { identitySeed: _identitySeed, ...visible } = account
  return visible
}

function identityCapabilities(account) {
  const hasSeed = account?.identitySeed?.type === 'bip39'
    && typeof account.identitySeed.mnemonic === 'string'

  if (hasSeed) {
    return {
      seedBacked: true,
      deriveNostrAccounts: { supported: true, reason: null },
      lightningLogin: { supported: true, reason: null },
    }
  }

  const reason = account?.mode === 'nip46' ? 'remote_signer' : 'recovery_words_required'
  return {
    seedBacked: false,
    deriveNostrAccounts: { supported: false, reason },
    lightningLogin: { supported: false, reason },
  }
}

function createIdentitySeed(words, backupConfirmed = false) {
  const root = deriveNip06Identity(words, 0)
  const identitySeed = {
    type: 'bip39',
    version: 1,
    identityId: root.pubkey,
    mnemonic: words,
    backupConfirmed,
  }
  root.secretKey.fill(0)
  return identitySeed
}

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
      const accounts = await decryptData(stored.encrypted, password)
      if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) {
        throw new Error('Invalid account vault shape')
      }
      if (encryptionNeedsUpgrade(stored.encrypted)) await writeAccounts(accounts, password)
      return accounts
    } catch (error) {
      throw vaultIntegrityError('Account vault', error)
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

/** Active account for extension pages, with the reusable mnemonic withheld. */
export async function getActiveAccountForClient(password) {
  return publicAccount(await getActiveAccount(password))
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
    keyOrigin: { type: 'generated-key' },
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
  const words = normalizeMnemonic(mnemonic)
  const derived = deriveNip06Identity(words, 0)
  const secretHex = bytesToHex(derived.secretKey)
  const pubkey = derived.pubkey
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || '',
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    keyOrigin: {
      type: 'nip06',
      accountIndex: derived.accountIndex,
      path: derived.path,
    },
    identitySeed: createIdentitySeed(words),
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await readAccounts(password)
  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  const nsec = nip19.nsecEncode(derived.secretKey)
  derived.secretKey.fill(0)

  return {
    ...publicAccount(account),
    npub: derived.npub,
    nsec,
    mnemonic,
  }
}

export async function importFromMnemonic(password, name, mnemonic, accountIndex = 0) {
  const words = normalizeMnemonic(mnemonic)
  const derived = deriveNip06Identity(words, accountIndex)
  const secretHex = bytesToHex(derived.secretKey)
  const pubkey = derived.pubkey

  // A repeated recovery should activate the existing identity, not create a
  // second encrypted copy of the same private key.
  const accounts = await readAccounts(password)
  const existing = Object.values(accounts).find(a => a.pubkey === pubkey)
  if (existing) {
    existing.identitySeed = createIdentitySeed(words, true)
    existing.keyOrigin = {
      type: 'nip06',
      accountIndex: derived.accountIndex,
      path: derived.path,
    }
    await writeAccounts(accounts, password)
    await setActiveAccount(existing.id)
    derived.secretKey.fill(0)
    return {
      ...publicAccount(existing),
      npub: nip19.npubEncode(pubkey),
    }
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
    keyOrigin: {
      type: 'nip06',
      accountIndex: derived.accountIndex,
      path: derived.path,
    },
    identitySeed: createIdentitySeed(words, true),
    createdAt: Math.floor(Date.now() / 1000),
  }

  accounts[id] = account
  await writeAccounts(accounts, password)
  await setActiveAccount(id)

  const nsec = nip19.nsecEncode(derived.secretKey)
  derived.secretKey.fill(0)

  return {
    ...publicAccount(account),
    npub: derived.npub,
    nsec,
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
    return publicAccount(existing)
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
    keyOrigin: { type: 'imported-key' },
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
    keyOrigin: { type: 'remote-signer' },
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
    keyOrigin: a.keyOrigin || null,
    identityId: a.identitySeed?.identityId || null,
    identityBackupConfirmed: a.identitySeed?.backupConfirmed === true,
    capabilities: identityCapabilities(a),
    lightningLoginSiteCount: Array.isArray(a.lightningLoginSites) ? a.lightningLoginSites.length : 0,
    isActive: a.id === activeId,
    createdAt: a.createdAt,
  }))
}

export function getIdentityCapabilities(account) {
  return identityCapabilities(account)
}

/**
 * Re-encrypt all accounts with a new password.
 * Called during password change alongside reEncryptWallets.
 */
export async function reEncryptAccounts(oldPassword, newPassword) {
  const accounts = await readAccounts(oldPassword)
  if (Object.keys(accounts).length === 0) {
    await chrome.storage.local.remove(STORAGE_KEY)
    return
  }
  await writeAccounts(accounts, newPassword)
}
