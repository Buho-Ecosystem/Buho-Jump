/**
 * Reactive allowance sync — single source of truth for budget data.
 * Loads from background on first use, then stays in sync via chrome.storage.onChanged.
 * Works across popup, options page, and any extension view.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMessaging } from './useMessaging.js'

const allowances = ref({})  // { host: { budget, spent, created_at, updated_at } }
const loaded = ref(false)
let listenerAttached = false

function onStorageChanged(changes, area) {
  if (area === 'local' && changes.allowances?.newValue) {
    allowances.value = changes.allowances.newValue
  }
}

export function useAllowanceSync() {
  const { send } = useMessaging()

  async function load() {
    try {
      const result = await send('GET_ALLOWANCES')
      allowances.value = result || {}
    } catch { /* background not ready */ }
    loaded.value = true
  }

  function getForHost(host) {
    if (!host) return null
    return allowances.value[host] || null
  }

  onMounted(() => {
    if (!loaded.value) load()
    if (!listenerAttached) {
      chrome.storage.onChanged.addListener(onStorageChanged)
      listenerAttached = true
    }
  })

  // Listener is module-scoped and shared across all consumers.
  // In popup context the entire JS context is destroyed on close.
  // In options page (long-lived tab) the guard prevents duplicates.

  return { allowances, loaded, load, getForHost }
}
