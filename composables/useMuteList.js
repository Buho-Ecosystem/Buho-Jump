/**
 * Per-account mute list — hides conversations from muted pubkeys.
 *
 * Storage: `muteList_<accountPubkey>` → string[] (hex pubkeys)
 * Optional NIP-51 sync: publish kind 10000 mute list to relays.
 */

import { ref } from 'vue'
import { nip51, hexToBytes } from 'nostr-core'
import { getPool } from '../lib/relayPool.js'
import { getPoolRelays, DEFAULT_ACCOUNT_RELAYS } from '../lib/relays.js'

const mutedPubkeys = ref([])
let loadedForPubkey = null

export function useMuteList() {
  function storageKey(accountPubkey) {
    return `muteList_${accountPubkey}`
  }

  async function load(accountPubkey) {
    if (!accountPubkey) { mutedPubkeys.value = []; return }
    if (accountPubkey === loadedForPubkey) return
    loadedForPubkey = accountPubkey
    try {
      const key = storageKey(accountPubkey)
      const data = await chrome.storage.local.get(key)
      mutedPubkeys.value = data[key] || []
    } catch {
      mutedPubkeys.value = []
    }
  }

  async function persist(accountPubkey) {
    if (!accountPubkey) return
    await chrome.storage.local.set({
      [storageKey(accountPubkey)]: [...mutedPubkeys.value],
    })
  }

  async function mute(accountPubkey, pubkey) {
    if (mutedPubkeys.value.includes(pubkey)) return
    mutedPubkeys.value = [...mutedPubkeys.value, pubkey]
    await persist(accountPubkey)
  }

  async function unmute(accountPubkey, pubkey) {
    mutedPubkeys.value = mutedPubkeys.value.filter(p => p !== pubkey)
    await persist(accountPubkey)
  }

  function isMuted(pubkey) {
    return mutedPubkeys.value.includes(pubkey)
  }

  function reset() {
    mutedPubkeys.value = []
    loadedForPubkey = null
  }

  /**
   * Publish mute list to relays as NIP-51 kind 10000.
   * Requires the account's secret key (local accounts only).
   */
  async function publishToRelays(secretHex, accountPubkey) {
    if (!secretHex || mutedPubkeys.value.length === 0) return { published: 0 }

    const items = mutedPubkeys.value.map(pk => ({ tag: 'p', value: pk }))
    const event = nip51.createListEvent(
      { kind: 10000, publicItems: items },
      hexToBytes(secretHex)
    )

    const pool = getPool()
    const relays = await getPoolRelays(accountPubkey, 'account').catch(() => DEFAULT_ACCOUNT_RELAYS)
    try {
      const accepted = await pool.publish(relays, event)
      return { published: accepted.length }
    } catch {
      return { published: 0 }
    }
  }

  /**
   * Fetch mute list from relays (NIP-51 kind 10000) and merge with local.
   */
  async function fetchFromRelays(accountPubkey) {
    const pool = getPool()
    const relays = await getPoolRelays(accountPubkey, 'account').catch(() => DEFAULT_ACCOUNT_RELAYS)
    const events = await pool.querySync(relays, {
      kinds: [10000],
      authors: [accountPubkey],
      limit: 1,
    }, { maxWait: 5000 })

    if (events.length === 0) return

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
    const parsed = nip51.parseList(latest)
    const remotePubkeys = nip51.getPubkeys(parsed)

    // Merge: add any remote mutes we don't have locally
    const localSet = new Set(mutedPubkeys.value)
    let added = 0
    for (const pk of remotePubkeys) {
      if (!localSet.has(pk)) {
        localSet.add(pk)
        added++
      }
    }
    if (added > 0) {
      mutedPubkeys.value = [...localSet]
      await persist(accountPubkey)
    }
    return { merged: added }
  }

  return {
    mutedPubkeys,
    load,
    mute,
    unmute,
    isMuted,
    reset,
    publishToRelays,
    fetchFromRelays,
  }
}
