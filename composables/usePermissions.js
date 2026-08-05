/**
 * Permissions composable — reactive permission state for popup UI.
 */

import { ref, computed } from 'vue'
import { useMessaging } from './useMessaging.js'

const policies = ref({})
const sessionGrants = ref([])
const { send } = useMessaging()

export function usePermissions() {
  const domains = computed(() => Object.keys(policies.value))

  async function load() {
    const [persistent, session] = await Promise.all([
      send('GET_PERMISSIONS'),
      send('GET_SESSION_PERMISSIONS'),
    ])
    policies.value = persistent || {}
    sessionGrants.value = Array.isArray(session) ? session : []
  }

  async function revokeDomain(host) {
    await send('REMOVE_DOMAIN_PERMISSIONS', host)
    await load()
  }

  async function revokeMethod(host, method) {
    await send('REMOVE_PERMISSION', host, method)
    const matching = sessionGrants.value.filter(grant => grant.origin === host && grant.method === method)
    await Promise.all(matching.map(grant => send('REVOKE_SESSION_PERMISSION', grant.key)))
    await load()
  }

  return {
    policies,
    sessionGrants,
    domains,
    load,
    revokeDomain,
    revokeMethod,
  }
}
