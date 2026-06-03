/**
 * Online status composable — reactive browser connectivity state.
 *
 * Uses navigator.onLine + online/offline events. This covers the
 * device-level network state (WiFi off, airplane mode, etc.).
 * Relay-specific failures are handled separately by error refs
 * in useChat and useContacts.
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'

const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

export function useOnline() {
  function handleOnline() { online.value = true }
  function handleOffline() { online.value = false }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    online.value = navigator.onLine
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return { online }
}
