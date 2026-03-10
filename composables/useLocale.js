/**
 * Composable for language switching with chrome.storage.local persistence.
 * Provides reactive locale state + helpers for the language picker.
 */
import { ref, readonly } from 'vue'
import { SUPPORTED_LOCALES, setLocale } from '../lib/i18n.js'

const currentLocale = ref('en')
const ready = ref(false)

/**
 * Initialize locale from storage (call once at app startup).
 * Returns the resolved locale code.
 */
export async function initLocale() {
  try {
    const stored = await chrome.storage.local.get('locale')
    if (stored.locale && SUPPORTED_LOCALES.some(l => l.code === stored.locale)) {
      await setLocale(stored.locale)
      currentLocale.value = stored.locale
    }
  } catch {
    // First run or storage unavailable — stay on English
  }
  ready.value = true
  return currentLocale.value
}

/**
 * Check if this is the user's first launch (no locale preference saved).
 */
export async function isFirstLaunch() {
  try {
    const stored = await chrome.storage.local.get('locale')
    return !stored.locale
  } catch {
    return true
  }
}

export function useLocale() {
  async function switchLocale(code) {
    const resolved = await setLocale(code)
    currentLocale.value = resolved
    try {
      await chrome.storage.local.set({ locale: resolved })
    } catch {
      // Storage write failed — locale still applied for this session
    }
  }

  return {
    locale: readonly(currentLocale),
    ready: readonly(ready),
    locales: SUPPORTED_LOCALES,
    switchLocale,
  }
}
