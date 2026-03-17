/**
 * Relay management — per-account relay config, NIP-65, NIP-11.
 *
 * Three relay pools per account: account, wallet, chat.
 * Storage: `relayConfig_<pubkey>` → { account: string[], wallet: string[], chat: string[] }
 *
 * NIP-65 and NIP-11 protocol logic delegated to nostr-core.
 */

import { nip65, nip11 } from 'nostr-core'
import { getPool } from './relayPool.js'

// ── Default relay presets ──

export const DEFAULT_ACCOUNT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://purplepag.es',
  'wss://relay.snort.social',
]

export const DEFAULT_WALLET_RELAYS = [
  'wss://relay.getalby.com/v1',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

export const DEFAULT_CHAT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://auth.nostr1.com',
]

const POOL_DEFAULTS = {
  account: DEFAULT_ACCOUNT_RELAYS,
  wallet: DEFAULT_WALLET_RELAYS,
  chat: DEFAULT_CHAT_RELAYS,
}

// ── Storage helpers ──

function storageKey(pubkey) {
  return `relayConfig_${pubkey}`
}

export async function getRelayConfig(pubkey) {
  const key = storageKey(pubkey)
  const data = await chrome.storage.local.get(key)
  return data[key] || {
    account: [...DEFAULT_ACCOUNT_RELAYS],
    wallet: [...DEFAULT_WALLET_RELAYS],
    chat: [...DEFAULT_CHAT_RELAYS],
  }
}

export async function getPoolRelays(pubkey, pool) {
  const config = await getRelayConfig(pubkey)
  return config[pool] || POOL_DEFAULTS[pool] || []
}

export async function setPoolRelays(pubkey, pool, urls) {
  const config = await getRelayConfig(pubkey)
  config[pool] = urls
  await chrome.storage.local.set({ [storageKey(pubkey)]: config })
}

export async function addRelay(pubkey, pool, url) {
  const normalized = validateRelayUrl(url)
  if (!normalized) throw new Error('Invalid relay URL')
  const config = await getRelayConfig(pubkey)
  const list = config[pool] || []
  // Check duplicates with normalized comparison (strip trailing slash)
  const normalizedSet = new Set(list.map(u => u.replace(/\/$/, '')))
  if (normalizedSet.has(normalized.replace(/\/$/, ''))) throw new Error('Duplicate relay')
  list.push(normalized)
  config[pool] = list
  await chrome.storage.local.set({ [storageKey(pubkey)]: config })
  return config
}

export async function removeRelay(pubkey, pool, url) {
  const config = await getRelayConfig(pubkey)
  config[pool] = (config[pool] || []).filter(r => r !== url)
  await chrome.storage.local.set({ [storageKey(pubkey)]: config })
  return config
}

export async function resetPoolToDefaults(pubkey, pool) {
  const config = await getRelayConfig(pubkey)
  config[pool] = [...(POOL_DEFAULTS[pool] || [])]
  await chrome.storage.local.set({ [storageKey(pubkey)]: config })
  return config
}

// ── URL validation ──

export function validateRelayUrl(url) {
  if (!url || typeof url !== 'string') return null
  let u = url.trim()

  // Auto-prefix wss:// if missing
  if (!u.startsWith('wss://') && !u.startsWith('ws://')) {
    u = 'wss://' + u
  }
  // Reject ws:// (insecure)
  if (u.startsWith('ws://')) return null

  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'wss:') return null
    if (!parsed.hostname || parsed.hostname.length < 3) return null
    // Normalize: remove trailing slash unless there's a path
    let result = parsed.toString()
    if (result.endsWith('/') && parsed.pathname === '/') {
      result = result.slice(0, -1)
    }
    return result
  } catch {
    return null
  }
}

// ── NIP-65 (kind 10002) — via nostr-core ──

/**
 * Parse a NIP-65 relay list event into { read, write, both } URL arrays.
 * Uses nostr-core's nip65.parseRelayList internally.
 */
export function parseNip65Event(event) {
  if (!event || event.kind !== 10002) return { read: [], write: [], both: [] }

  const relays = nip65.parseRelayList(event)
  const read = []
  const write = []
  const both = []

  for (const r of relays) {
    if (r.read && r.write) both.push(r.url)
    else if (r.read) read.push(r.url)
    else if (r.write) write.push(r.url)
  }

  return { read, write, both }
}

/**
 * Create a NIP-65 relay list event template.
 * Accepts { both, read, write } URL arrays → converts to nostr-core format.
 */
export function createNip65Event(relayList) {
  const relays = [
    ...(relayList.both || []).map(url => ({ url, read: true, write: true })),
    ...(relayList.read || []).map(url => ({ url, read: true, write: false })),
    ...(relayList.write || []).map(url => ({ url, read: false, write: true })),
  ]
  return nip65.createRelayListEventTemplate(relays)
}

/**
 * Fetch the latest NIP-65 relay list for a pubkey.
 */
export async function fetchNip65(pubkey, relayUrls) {
  const pool = getPool()
  const events = await pool.querySync(relayUrls, {
    kinds: [10002],
    authors: [pubkey],
    limit: 1,
  }, { maxWait: 5000 })

  if (events.length === 0) return null
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
  return parseNip65Event(latest)
}

// ── NIP-65 outbox/inbox with in-memory cache (15min TTL) ──

const nip65Cache = new Map()
const NIP65_CACHE_TTL = 15 * 60 * 1000

async function getCachedNip65(pubkey, fallbackRelays) {
  const cached = nip65Cache.get(pubkey)
  if (cached && Date.now() - cached.ts < NIP65_CACHE_TTL) return cached.data

  const relays = fallbackRelays || DEFAULT_ACCOUNT_RELAYS
  try {
    const result = await fetchNip65(pubkey, relays)
    // Cache both hits and misses to avoid repeated lookups
    nip65Cache.set(pubkey, { data: result, ts: Date.now() })
    return result
  } catch {
    return null
  }
}

export async function getOutboxRelays(pubkey) {
  const relayList = await getCachedNip65(pubkey)
  if (!relayList) return []
  return [...relayList.write, ...relayList.both]
}

export async function getInboxRelays(pubkey) {
  const relayList = await getCachedNip65(pubkey)
  if (!relayList) return []
  return [...relayList.read, ...relayList.both]
}

// ── NIP-11 relay info — via nostr-core ──

const relayInfoCache = new Map()
const NIP11_CACHE_TTL = 30 * 60 * 1000

export async function fetchRelayInfo(url) {
  const cached = relayInfoCache.get(url)
  if (cached && Date.now() - cached.ts < NIP11_CACHE_TTL) return cached.data

  try {
    const info = await nip11.fetchRelayInfo(url)
    relayInfoCache.set(url, { data: info, ts: Date.now() })
    return info
  } catch {
    relayInfoCache.set(url, { data: null, ts: Date.now() })
    return null
  }
}
