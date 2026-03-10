/**
 * Permissions composable — reactive permission state for popup UI.
 */

import { ref, computed } from 'vue'
import { useMessaging } from './useMessaging.js'

const policies = ref({})
const { send } = useMessaging()

export function usePermissions() {
  const domains = computed(() => Object.keys(policies.value))

  async function load() {
    policies.value = await send('GET_PERMISSIONS') || {}
  }

  async function revokeDomain(host) {
    await send('REMOVE_DOMAIN_PERMISSIONS', host)
    await load()
  }

  async function revokeMethod(host, method) {
    await send('REMOVE_PERMISSION', host, method)
    await load()
  }

  return {
    policies,
    domains,
    load,
    revokeDomain,
    revokeMethod,
  }
}
