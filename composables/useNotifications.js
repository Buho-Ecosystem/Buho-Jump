/**
 * Notification settings composable — reactive toggle state for the popup UI.
 */

import { ref } from 'vue'

const settings = ref({ dms: true, payments: true })
const loaded = ref(false)

export function useNotifications() {
  async function load() {
    if (loaded.value) return
    try {
      const data = await chrome.storage.local.get('notificationSettings')
      settings.value = { dms: true, payments: true, ...data.notificationSettings }
    } catch { /* storage error */ }
    loaded.value = true
  }

  async function persist() {
    await chrome.storage.local.set({
      notificationSettings: JSON.parse(JSON.stringify(settings.value)),
    })
  }

  async function toggleDms() {
    settings.value = { ...settings.value, dms: !settings.value.dms }
    await persist()
  }

  async function togglePayments() {
    settings.value = { ...settings.value, payments: !settings.value.payments }
    await persist()
  }

  return {
    settings,
    loaded,
    load,
    toggleDms,
    togglePayments,
  }
}
