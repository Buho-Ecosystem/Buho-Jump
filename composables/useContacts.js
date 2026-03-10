/**
 * Contacts composable — follow list (kind 3), profile metadata (kind 0),
 * NIP-05 resolution, and contact search.
 *
 * Contacts are scoped per-account. Call resetContacts() when switching
 * accounts so the follow list reloads for the new pubkey.
 */

import { ref } from 'vue'
import { nip19 } from 'nostr-core'
import { getPool } from '../lib/relayPool.js'
import { getPoolRelays, DEFAULT_ACCOUNT_RELAYS } from '../lib/relays.js'

const profileCache = new Map()
const contacts = ref([])
const loading = ref(false)
let loadedForPubkey = null // tracks which account's follow list is loaded

export function useContacts() {
  /**
   * Load follow list (kind 3) for a pubkey, then batch-fetch profiles.
   */
  async function loadFollowList(pubkey) {
    loading.value = true
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
      const pubkeys = latest.tags
        .filter(t => t[0] === 'p' && t[1])
        .map(t => t[1])

      // Batch-fetch profiles
      await fetchProfiles(pubkeys)

      contacts.value = pubkeys.map(pk => ({
        pubkey: pk,
        profile: profileCache.get(pk) || null,
        npub: nip19.npubEncode(pk),
      }))
    } catch {
      contacts.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Batch-fetch kind 0 profiles, cache results.
   */
  async function fetchProfiles(pubkeys) {
    const missing = pubkeys.filter(pk => !profileCache.has(pk))
    if (missing.length === 0) return

    try {
      const pool = getPool()
      const events = await pool.querySync(DEFAULT_ACCOUNT_RELAYS, {
        kinds: [0],
        authors: missing,
      }, { maxWait: 5000 })

      // Group by author, take latest
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
    } catch { /* relay error */ }
  }

  /**
   * Get a single profile (cached or fetched).
   */
  async function fetchProfile(pubkey) {
    if (profileCache.has(pubkey)) return profileCache.get(pubkey)
    await fetchProfiles([pubkey])
    return profileCache.get(pubkey) || null
  }

  /**
   * Get a cached profile synchronously (no fetch).
   */
  function getCachedProfile(pubkey) {
    return profileCache.get(pubkey) || null
  }

  /**
   * Resolve user input to a pubkey.
   * Supports: npub, nprofile, hex, NIP-05 (user@domain).
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

    // NIP-05 resolution (user@domain or _@domain)
    if (input.includes('@')) {
      const atIdx = input.lastIndexOf('@')
      const name = input.slice(0, atIdx)
      const domain = input.slice(atIdx + 1)
      if (!name || !domain) return null
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(
          `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
          { signal: controller.signal }
        )
        clearTimeout(timeout)
        if (!res.ok) return null
        const data = await res.json()
        if (data.names?.[name]) return data.names[name]
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
      const nip05 = c.profile?.nip05 || ''
      return name.toLowerCase().includes(q) ||
        nip05.toLowerCase().includes(q) ||
        c.npub.includes(q) ||
        c.pubkey.includes(q)
    })
  }

  /**
   * Reset contacts state on account switch.
   * Clears the follow list so it reloads for the new account.
   */
  function resetContacts() {
    contacts.value = []
    loadedForPubkey = null
    loading.value = false
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
