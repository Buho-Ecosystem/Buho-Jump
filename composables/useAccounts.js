/**
 * Account composable — reactive account state for popup UI.
 * Handles create, import, NIP-46, switch, remove, and profile publishing.
 */

import { ref, computed } from 'vue'
import { useMessaging } from './useMessaging.js'

const accounts = ref([])
const nip46Status = ref({ connected: false, reconnecting: false })
const { send } = useMessaging()

export function useAccounts() {
  const activeAccount = computed(() => accounts.value.find((a) => a.isActive) || null)

  async function load() {
    try {
      accounts.value = await send('GET_ACCOUNTS') || []
    } catch {
      // Don't throw — a failed refresh shouldn't block account creation flows
    }
  }

  async function create(name) {
    const result = await send('CREATE_ACCOUNT', name || undefined)
    await load()
    return result
  }

  async function importKey(name, nsecOrHex) {
    const result = await send('IMPORT_ACCOUNT', name || undefined, nsecOrHex)
    await load()
    return result
  }

  async function createRemote(name) {
    const result = await send('CREATE_NIP46_ACCOUNT', name || undefined)
    await load()
    return result
  }

  async function connectRemote(bunkerUri, accountId) {
    const result = await send('CONNECT_NIP46', bunkerUri, accountId)
    await load()
    return result
  }

  async function switchTo(accountId) {
    await send('SWITCH_ACCOUNT', accountId)
    await load()
  }

  async function remove(accountId) {
    await send('REMOVE_ACCOUNT', accountId)
    await load()
  }

  async function publishProfile(profileData) {
    return send('PUBLISH_PROFILE', profileData)
  }

  async function fetchProfile(pubkey) {
    return send('FETCH_PROFILE', pubkey)
  }

  async function startNostrConnect(accountId, relayUrl) {
    return send('START_NOSTR_CONNECT', accountId, relayUrl)
  }

  async function cancelNostrConnect() {
    return send('CANCEL_NOSTR_CONNECT')
  }

  async function loadNip46Status() {
    try {
      nip46Status.value = await send('GET_NIP46_STATUS') || { connected: false, reconnecting: false }
    } catch {
      nip46Status.value = { connected: false, reconnecting: false }
    }
  }

  return {
    accounts,
    activeAccount,
    nip46Status,
    load,
    create,
    importKey,
    createRemote,
    connectRemote,
    switchTo,
    remove,
    publishProfile,
    fetchProfile,
    loadNip46Status,
    startNostrConnect,
    cancelNostrConnect,
  }
}
