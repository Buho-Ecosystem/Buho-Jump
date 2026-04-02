/**
 * Relay management composable — reactive state for UI.
 *
 * Singleton: all components share the same relay config refs.
 * Wraps lib/relays.js storage + background message handlers.
 */

import { ref } from 'vue'
import { useMessaging } from './useMessaging.js'

const relayConfig = ref({ account: [], wallet: [], chat: [] })
const loading = ref(false)
const relayInfoCache = ref({})

export function useRelays() {
  const { send } = useMessaging()

  async function loadRelays() {
    loading.value = true
    try {
      const config = await send('GET_RELAY_CONFIG')
      if (config && (config.account || config.wallet || config.chat)) {
        relayConfig.value = config
      }
    } catch (err) {
      console.warn('[useRelays] loadRelays failed, retrying…', err.message)
      // Retry once after a short delay (service worker may still be waking)
      try {
        await new Promise(r => setTimeout(r, 500))
        const config = await send('GET_RELAY_CONFIG')
        if (config && (config.account || config.wallet || config.chat)) {
          relayConfig.value = config
        }
      } catch (retryErr) {
        console.warn('[useRelays] loadRelays retry failed:', retryErr.message)
      }
    } finally {
      loading.value = false
    }
  }

  async function addRelay(pool, url) {
    const config = await send('ADD_RELAY', pool, url)
    relayConfig.value = config
  }

  async function removeRelay(pool, url) {
    const config = await send('REMOVE_RELAY', pool, url)
    relayConfig.value = config
  }

  async function resetPool(pool) {
    const config = await send('RESET_RELAYS', pool)
    relayConfig.value = config
  }

  async function setPoolRelays(pool, urls) {
    await send('SET_RELAY_CONFIG', pool, urls)
    await loadRelays()
  }

  async function publishRelayList() {
    const relays = relayConfig.value.account || []
    const relayList = { both: relays, read: [], write: [] }
    return await send('PUBLISH_NIP65', relayList)
  }

  async function fetchRelayList() {
    return await send('FETCH_NIP65')
  }

  async function getRelayInfo(url) {
    // Check local cache first
    if (relayInfoCache.value[url] !== undefined) {
      return relayInfoCache.value[url]
    }

    const info = await send('FETCH_RELAY_INFO', url)
    relayInfoCache.value = { ...relayInfoCache.value, [url]: info }
    return info
  }

  /**
   * Check connectivity for a single relay URL.
   * Opens a WebSocket, waits for open/error, then closes.
   * Returns 'connected' | 'unreachable'.
   */
  function checkRelayStatus(url) {
    return new Promise((resolve) => {
      const wsUrl = url.replace(/^wss?:\/\//, (m) => m)
      const timeout = setTimeout(() => { resolve('unreachable') }, 5000)
      try {
        const ws = new WebSocket(wsUrl)
        ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve('connected') }
        ws.onerror = () => { clearTimeout(timeout); resolve('unreachable') }
      } catch { clearTimeout(timeout); resolve('unreachable') }
    })
  }

  return {
    relayConfig,
    loading,
    relayInfoCache,
    loadRelays,
    addRelay,
    removeRelay,
    resetPool,
    setPoolRelays,
    publishRelayList,
    fetchRelayList,
    getRelayInfo,
    checkRelayStatus,
  }
}
