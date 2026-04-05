/**
 * Reactive relay health monitor.
 * Wraps getRelayStatus() from relayPool.js with randomized polling (25-35s).
 * Exposes aggregate health only — no per-relay details leak to UI.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { getRelayStatus } from '../lib/relayPool.js'

const connectedCount = ref(0)
const totalCount = ref(0)
const healthy = ref(true)

let pollTimer = null
const instances = new Set()
let nextId = 0

function refresh() {
  const status = getRelayStatus()
  totalCount.value = status.size
  connectedCount.value = [...status.values()].filter(Boolean).length
  healthy.value = connectedCount.value > 0 || totalCount.value === 0
}

function startPolling() {
  refresh()
  // Randomized interval (25-35s) to prevent timing fingerprinting
  const schedule = () => {
    pollTimer = setTimeout(() => {
      refresh()
      if (instances.size > 0) schedule()
    }, 25_000 + Math.random() * 10_000)
  }
  schedule()
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

export function useRelayHealth() {
  const id = ++nextId

  onMounted(() => {
    instances.add(id)
    if (instances.size === 1) startPolling()
  })

  onBeforeUnmount(() => {
    instances.delete(id)
    if (instances.size === 0) stopPolling()
  })

  return { healthy, connectedCount, totalCount, refresh }
}
