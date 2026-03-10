/**
 * Toast composable — lightweight notification system.
 * Toasts auto-dismiss after a configurable duration.
 */

import { ref } from 'vue'

const toasts = ref([])
let nextId = 0

function addToast(type, message, duration = 4000) {
  const id = ++nextId
  toasts.value.push({ id, type, message, visible: true })

  // Trigger exit animation before removal
  setTimeout(() => {
    const toast = toasts.value.find((t) => t.id === id)
    if (toast) toast.visible = false
  }, duration - 300)

  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)

  return id
}

function dismiss(id) {
  const toast = toasts.value.find((t) => t.id === id)
  if (toast) toast.visible = false
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 300)
}

export function useToast() {
  return {
    toasts,
    success: (msg, dur) => addToast('success', msg, dur),
    error: (msg, dur) => addToast('error', msg, dur ?? 6000),
    info: (msg, dur) => addToast('info', msg, dur),
    dismiss,
  }
}
