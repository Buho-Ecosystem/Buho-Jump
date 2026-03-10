/**
 * Relay management — per-account relay config, NIP-65, NIP-11.
 *
 * Three relay pools per account: account, wallet, chat.
 * Storage: `relayConfig_<pubkey>` → { account: string[], wallet: string[], chat: string[] }
 */

import { getPool } from './relayPool.js'

// ── Default relay presets ──

export const DEFAULT_ACCOUNT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://relay.nostr.band',
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

// ── NIP-65 (kind 10002) ──

const KIND_RELAY_LIST = 10002

export function parseNip65Event(event) {
  if (!event || event.kind !== KIND_RELAY_LIST) return { read: [], write: [], both: [] }

  const read = []
  const write = []
  const both = []

  for (const tag of event.tags) {
    if (tag[0] !== 'r') continue
    const url = tag[1]
    if (!url) continue
    const marker = tag[2]
    if (marker === 'read') read.push(url)
    else if (marker === 'write') write.push(url)
    else both.push(url)
  }

  return { read, write, both }
}

export function createNip65Event(relayList, pubkey) {
  const tags = []
  for (const url of relayList.both || []) tags.push(['r', url])
  for (const url of relayList.read || []) tags.push(['r', url, 'read'])
  for (const url of relayList.write || []) tags.push(['r', url, 'write'])

  return {
    kind: KIND_RELAY_LIST,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }
}

export async function fetchNip65(pubkey, relayUrls) {
  const pool = getPool()
  const events = await pool.querySync(relayUrls, {
    kinds: [KIND_RELAY_LIST],
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
  const nip65 = await getCachedNip65(pubkey)
  if (!nip65) return []
  return [...nip65.write, ...nip65.both]
}

export async function getInboxRelays(pubkey) {
  const nip65 = await getCachedNip65(pubkey)
  if (!nip65) return []
  return [...nip65.read, ...nip65.both]
}

// ── NIP-11 relay info ──

const relayInfoCache = new Map()
const NIP11_CACHE_TTL = 30 * 60 * 1000

export async function fetchRelayInfo(url) {
  // Check cache
  const cached = relayInfoCache.get(url)
  if (cached && Date.now() - cached.ts < NIP11_CACHE_TTL) return cached.data

  try {
    // Convert wss:// → https://
    const httpUrl = url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      relayInfoCache.set(url, { data: null, ts: Date.now() })
      return null
    }

    const info = await res.json()
    relayInfoCache.set(url, { data: info, ts: Date.now() })
    return info
  } catch {
    relayInfoCache.set(url, { data: null, ts: Date.now() })
    return null
  }
}
