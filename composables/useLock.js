/**
 * Lock composable — manages master password state for popup UI.
 * Handles lock/unlock, auto-lock timer, and rate-limited attempts.
 */

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMessaging } from './useMessaging.js'

const locked = ref(true)
const passwordSet = ref(false)
const loading = ref(true)
const failedAttempts = ref(0)
const lockoutUntil = ref(0)
const autoLockCountdown = ref(0) // seconds until auto-lock (0 = no warning)

const { send } = useMessaging()

let autoLockTimer = null
let autoLockWarningTimer = null
let autoLockCountdownInterval = null
let _initialized = false

export function useLock() {
  async function checkState() {
    // Only show loading spinner on the very first check.
    // Subsequent checks (from child components re-mounting) update
    // locked/passwordSet silently to avoid unmount/remount loops.
    if (!_initialized) loading.value = true
    try {
      const state = await send('GET_LOCK_STATE')
      locked.value = state.locked
      passwordSet.value = state.passwordSet
    } catch {
      locked.value = true
      passwordSet.value = false
    } finally {
      loading.value = false
      _initialized = true
    }
  }

  async function setup(password) {
    await send('SETUP_PASSWORD', password)
    passwordSet.value = true
    locked.value = false
    failedAttempts.value = 0
    startAutoLock()
  }

  async function unlock(password) {
    // Rate limiting: progressive delay after failed attempts
    const now = Date.now()
    if (lockoutUntil.value > now) {
      const remaining = Math.ceil((lockoutUntil.value - now) / 1000)
      throw new Error(`TOO_MANY_ATTEMPTS:${remaining}`)
    }

    try {
      await send('UNLOCK', password)
      locked.value = false
      failedAttempts.value = 0
      lockoutUntil.value = 0
      startAutoLock()
    } catch (err) {
      failedAttempts.value++
      if (failedAttempts.value >= 3) {
        // Progressive delay: 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(Math.pow(2, failedAttempts.value - 2) * 1000, 30000)
        lockoutUntil.value = Date.now() + delay
      }
      throw err
    }
  }

  async function lock() {
    await send('LOCK')
    locked.value = true
    clearAutoLock()
  }

  async function changePassword(oldPassword, newPassword) {
    await send('CHANGE_PASSWORD', oldPassword, newPassword)
  }

  // Auto-lock timer with 30-second warning countdown
  const WARNING_SECONDS = 30

  function startAutoLock() {
    clearAutoLock()
    chrome.storage.local.get('autoLockMinutes').then(({ autoLockMinutes }) => {
      const minutes = autoLockMinutes ?? 0
      if (minutes <= 0) return // "never" option
      const totalMs = minutes * 60 * 1000

      autoLockTimer = setTimeout(() => {
        autoLockCountdown.value = 0
        lock()
      }, totalMs)

      // Start warning countdown 30s before lock
      const warningDelay = totalMs - WARNING_SECONDS * 1000
      if (warningDelay > 0) {
        autoLockWarningTimer = setTimeout(() => {
          autoLockCountdown.value = WARNING_SECONDS
          autoLockCountdownInterval = setInterval(() => {
            autoLockCountdown.value--
            if (autoLockCountdown.value <= 0) {
              clearInterval(autoLockCountdownInterval)
              autoLockCountdownInterval = null
            }
          }, 1000)
        }, warningDelay)
      }
    })
  }

  function clearAutoLock() {
    if (autoLockTimer) {
      clearTimeout(autoLockTimer)
      autoLockTimer = null
    }
    if (autoLockWarningTimer) {
      clearTimeout(autoLockWarningTimer)
      autoLockWarningTimer = null
    }
    if (autoLockCountdownInterval) {
      clearInterval(autoLockCountdownInterval)
      autoLockCountdownInterval = null
    }
    autoLockCountdown.value = 0
  }

  function resetAutoLock() {
    if (!locked.value) {
      startAutoLock()
      // Also reset the background session timer so it doesn't expire
      send('RESET_AUTO_LOCK').catch(() => {})
    }
  }

  onMounted(() => {
    // Only auto-check once (from the first component that uses useLock).
    // Without this guard, child components like PreferencesPage would
    // re-trigger checkState → loading=true → parent unmounts children → loop.
    if (!_initialized) checkState()
  })

  onBeforeUnmount(() => {
    clearAutoLock()
  })

  return {
    locked,
    passwordSet,
    loading,
    failedAttempts,
    lockoutUntil,
    autoLockCountdown,
    checkState,
    setup,
    unlock,
    lock,
    changePassword,
    resetAutoLock,
  }
}
