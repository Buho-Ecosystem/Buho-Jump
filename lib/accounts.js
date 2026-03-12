/**
 * Account management — create, import, switch Nostr identities.
 * Each account stores an encrypted secret key and optional NIP-46 session.
 */

import { generateSecretKey, getPublicKey, nip19, bytesToHex, hexToBytes } from 'nostr-core'

/**
 * Account structure:
 * {
 *   id: string,          // UUID
 *   name: string,        // Display name
 *   pubkey: string,      // Hex public key
 *   secretHex: string,   // Hex secret key (local accounts)
 *   mode: 'local' | 'nip46',  // Signing mode
 *   nip46Session: { signerPubkey, relays, bunkerUri } | null,
 *   nip46ClientSecretHex: string | null,  // NIP-46 client keypair
 *   createdAt: number,
 * }
 */

export async function getAccounts() {
  const data = await chrome.storage.local.get('accounts')
  return data.accounts || {}
}

export async function getActiveAccountId() {
  const data = await chrome.storage.local.get('activeAccountId')
  return data.activeAccountId || null
}

export async function getActiveAccount() {
  const accounts = await getAccounts()
  const activeId = await getActiveAccountId()
  return activeId ? accounts[activeId] || null : null
}

export async function setActiveAccount(accountId) {
  await chrome.storage.local.set({ activeAccountId: accountId })
}

export async function createLocalAccount(name) {
  const secretKey = generateSecretKey()
  const secretHex = bytesToHex(secretKey)
  const pubkey = getPublicKey(secretKey)
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || 'Account ' + id.slice(0, 4),
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await getAccounts()
  accounts[id] = account
  await chrome.storage.local.set({ accounts })

  // Always activate newly created account
  await setActiveAccount(id)

  // Return account with nsec for backup display (one-time)
  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey),
  }
}

export async function importAccount(name, nsecOrHex) {
  let secretHex

  if (nsecOrHex.startsWith('nsec')) {
    const decoded = nip19.decode(nsecOrHex)
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec')
    secretHex = bytesToHex(decoded.data)
  } else {
    // Assume hex
    if (!/^[0-9a-f]{64}$/i.test(nsecOrHex)) throw new Error('Invalid hex key')
    secretHex = nsecOrHex.toLowerCase()
  }

  const pubkey = getPublicKey(hexToBytes(secretHex))
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || 'Imported ' + id.slice(0, 4),
    pubkey,
    secretHex,
    mode: 'local',
    nip46Session: null,
    nip46ClientSecretHex: null,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await getAccounts()
  accounts[id] = account
  await chrome.storage.local.set({ accounts })

  // Always activate newly imported account
  await setActiveAccount(id)

  return {
    ...account,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(hexToBytes(secretHex)),
  }
}

export async function createNip46Account(name, bunkerUri) {
  const clientSecret = generateSecretKey()
  const clientSecretHex = bytesToHex(clientSecret)
  const id = crypto.randomUUID()

  const account = {
    id,
    name: name || 'Remote Signer',
    pubkey: null, // Set after connection
    secretHex: null,
    mode: 'nip46',
    nip46Session: null,
    nip46ClientSecretHex: clientSecretHex,
    createdAt: Math.floor(Date.now() / 1000),
  }

  const accounts = await getAccounts()
  accounts[id] = account
  await chrome.storage.local.set({ accounts })

  return account
}

export async function updateAccount(accountId, updates) {
  const accounts = await getAccounts()
  if (!accounts[accountId]) return null
  Object.assign(accounts[accountId], updates)
  await chrome.storage.local.set({ accounts })
  return accounts[accountId]
}

export async function removeAccount(accountId) {
  const accounts = await getAccounts()
  delete accounts[accountId]
  await chrome.storage.local.set({ accounts })

  const activeId = await getActiveAccountId()
  if (activeId === accountId) {
    const remaining = Object.keys(accounts)
    await setActiveAccount(remaining.length > 0 ? remaining[0] : null)
  }
}

export async function getAccountSummaries() {
  const accounts = await getAccounts()
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
