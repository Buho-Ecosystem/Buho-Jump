/**
 * Contacts composable — follow list (kind 3), profile metadata (kind 0),
 * NIP-05 resolution, and contact search.
 *
 * Contacts are scoped per-account. Call resetContacts() when switching
 * accounts so the follow list reloads for the new pubkey.
 */

import { ref } from 'vue'
import { nip02, nip05, nip19 } from 'nostr-core'
import { getPool } from '../lib/relayPool.js'
import { getPoolRelays, DEFAULT_ACCOUNT_RELAYS } from '../lib/relays.js'

const profileCache = new Map()
const contacts = ref([])
const loading = ref(false)
const error = ref(null)  // i18n key or null — set when loadFollowList fails
let loadedForPubkey = null
let profileCacheLoaded = false

// ── Profile cache persistence ──

async function loadProfileCache() {
  if (profileCacheLoaded) return
  profileCacheLoaded = true
  try {
    const data = await chrome.storage.local.get('profileCache')
    if (data.profileCache) {
      for (const [pk, profile] of Object.entries(data.profileCache)) {
        if (!profileCache.has(pk)) profileCache.set(pk, profile)
      }
    }
  } catch { /* storage read failed */ }
}

let persistProfileTimer = null
function persistProfileCache() {
  if (persistProfileTimer) return // debounce
  persistProfileTimer = setTimeout(async () => {
    persistProfileTimer = null
    try {
      const obj = {}
      for (const [pk, profile] of profileCache) obj[pk] = profile
      await chrome.storage.local.set({ profileCache: obj })
    } catch { /* storage write failed */ }
  }, 2000)
}

export function useContacts() {
  /**
   * Load follow list (kind 3) for a pubkey, then batch-fetch profiles.
   */
  async function loadFollowList(pubkey) {
    if (loading.value) return // prevent concurrent loads
    loading.value = true
    await loadProfileCache() // Restore cached profiles from storage
    error.value = null
    loadedForPubkey = pubkey
    try {
      const pool = getPool()
      const relays = await getPoolRelays(pubkey, 'account').catch(() => DEFAULT_ACCOUNT_RELAYS)
      const events = await pool.querySync(relays, {
        kinds: [3],
        authors: [pubkey],
        limit: 1,
      }, { maxWait: 5000 })

      if (events.length === 0) {
        contacts.value = []
        return
      }

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
      const pubkeys = nip02.getFollowedPubkeys(latest)

      // Batch-fetch profiles using account relays, not hardcoded defaults
      await fetchProfiles(pubkeys, relays)

      contacts.value = pubkeys.map(pk => ({
        pubkey: pk,
        profile: profileCache.get(pk) || null,
        npub: nip19.npubEncode(pk),
      }))
    } catch {
      contacts.value = []
      error.value = 'chat.contactsLoadFailed'
    } finally {
      loading.value = false
    }
  }

  /**
   * Batch-fetch kind 0 profiles, cache results.
   * Uses provided relays or falls back to account defaults.
   */
  async function fetchProfiles(pubkeys, relays) {
    const missing = pubkeys.filter(pk => !profileCache.has(pk))
    if (missing.length === 0) return

    const useRelays = relays || DEFAULT_ACCOUNT_RELAYS
    try {
      const pool = getPool()
      const events = await pool.querySync(useRelays, {
        kinds: [0],
        authors: missing,
      }, { maxWait: 5000 })

      const latest = {}
      for (const e of events) {
        if (!latest[e.pubkey] || e.created_at > latest[e.pubkey].created_at) {
          latest[e.pubkey] = e
        }
      }

      for (const [pk, e] of Object.entries(latest)) {
        try {
          profileCache.set(pk, JSON.parse(e.content))
        } catch { /* malformed profile */ }
      }
      persistProfileCache()
    } catch { /* relay error */ }
  }

  /**
   * Get a single profile (cached or fetched).
   */
  async function fetchProfile(pubkey) {
    await loadProfileCache()
    if (profileCache.has(pubkey)) return profileCache.get(pubkey)
    await fetchProfiles([pubkey])
    return profileCache.get(pubkey) || null
  }

  /**
   * Get a cached profile synchronously (no fetch).
   */
  function getCachedProfile(pubkey) {
    // Note: loadProfileCache is async; on first call before load, returns null.
    // Callers should use fetchProfile() for guaranteed results.
    return profileCache.get(pubkey) || null
  }

  /**
   * Resolve user input to a pubkey.
   * Supports: npub, nprofile, hex, NIP-05 (user@domain).
   * NIP-05 resolution has a 10-second timeout.
   */
  async function resolveInput(input) {
    input = input.trim()

    if (input.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type === 'npub') return decoded.data
      } catch { /* invalid npub */ }
    }

    if (input.startsWith('nprofile1')) {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type === 'nprofile') return decoded.data.pubkey
      } catch { /* invalid nprofile */ }
    }

    if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase()

    // NIP-05 resolution with 10s timeout
    if (input.includes('@')) {
      try {
        const result = await Promise.race([
          nip05.queryNip05(input),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('NIP-05 lookup timed out')), 10000)
          ),
        ])
        if (result?.pubkey) return result.pubkey
      } catch { /* NIP-05 lookup failed or timed out */ }
    }

    return null
  }

  /**
   * Filter contacts by search query (name, nip05, npub, pubkey).
   */
  function searchContacts(query) {
    if (!query) return contacts.value
    const q = query.toLowerCase()
    return contacts.value.filter(c => {
      const name = c.profile?.display_name || c.profile?.name || ''
      const identity = c.profile?.nip05 || ''
      return name.toLowerCase().includes(q) ||
        identity.toLowerCase().includes(q) ||
        c.npub.includes(q) ||
        c.pubkey.includes(q)
    })
  }

  /**
   * Reset contacts state on account switch.
   */
  function resetContacts() {
    contacts.value = []
    profileCache.clear()
    loadedForPubkey = null
    loading.value = false
    error.value = null
  }

  /**
   * Check if follow list needs loading for the given pubkey.
   */
  function needsLoad(pubkey) {
    return pubkey !== loadedForPubkey
  }

  return {
    contacts,
    loading,
    error,
    loadFollowList,
    fetchProfile,
    fetchProfiles,
    getCachedProfile,
    resolveInput,
    searchContacts,
    resetContacts,
    needsLoad,
  }
}
