/**
 * Notification settings composable — reactive toggle state for the popup UI.
 *
 * Supports: DMs, groups, payments, DND, quiet hours.
 */

import { ref } from 'vue'

const DEFAULTS = {
  dms: true,
  groups: true,
  payments: true,
  dnd: false,
  quietHours: false,
  quietStart: '22:00',
  quietEnd: '08:00',
}

const settings = ref({ ...DEFAULTS })
const loaded = ref(false)

export function useNotifications() {
  async function load() {
    if (loaded.value) return
    try {
      const data = await chrome.storage.local.get('notificationSettings')
      settings.value = { ...DEFAULTS, ...data.notificationSettings }
    } catch { /* storage error */ }
    loaded.value = true
  }

  async function persist() {
    await chrome.storage.local.set({
      notificationSettings: JSON.parse(JSON.stringify(settings.value)),
    })
  }

  function toggle(key) {
    settings.value = { ...settings.value, [key]: !settings.value[key] }
    return persist()
  }

  async function toggleDms() { return toggle('dms') }
  async function toggleGroups() { return toggle('groups') }
  async function togglePayments() { return toggle('payments') }
  async function toggleDnd() { return toggle('dnd') }
  async function toggleQuietHours() { return toggle('quietHours') }

  async function setQuietStart(time) {
    settings.value = { ...settings.value, quietStart: time }
    return persist()
  }

  async function setQuietEnd(time) {
    settings.value = { ...settings.value, quietEnd: time }
    return persist()
  }

  return {
    settings,
    loaded,
    load,
    toggleDms,
    toggleGroups,
    togglePayments,
    toggleDnd,
    toggleQuietHours,
    setQuietStart,
    setQuietEnd,
  }
}
