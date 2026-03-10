/**
 * Fiat conversion composable — converts between sats and fiat using nostr-core.
 *
 * Features:
 * - Persisted currency preference (default: USD)
 * - Persisted denomination preference (default: sats)
 * - Tap-to-toggle between sats and fiat primary display
 * - fiatToSats conversion for invoice creation in fiat
 * - Supported currencies with symbols
 */

import { ref, watch } from 'vue'
import { getExchangeRate, fiatToSats as nostrCoreFiatToSats } from 'nostr-core'

// ── Supported currencies ────────────────────────────────────────
export const CURRENCIES = [
  { code: 'usd', symbol: '$', name: 'US Dollar' },
  { code: 'eur', symbol: '€', name: 'Euro' },
  { code: 'gbp', symbol: '£', name: 'British Pound' },
  { code: 'jpy', symbol: '¥', name: 'Japanese Yen' },
  { code: 'chf', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'cad', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'aud', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'cny', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'inr', symbol: '₹', name: 'Indian Rupee' },
  { code: 'brl', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'mxn', symbol: 'MX$', name: 'Mexican Peso' },
  { code: 'czk', symbol: 'Kč', name: 'Czech Koruna' },
  { code: 'sek', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'nok', symbol: 'kr', name: 'Norwegian Krone' },
  { code: 'dkk', symbol: 'kr', name: 'Danish Krone' },
  { code: 'pln', symbol: 'zł', name: 'Polish Zloty' },
  { code: 'try', symbol: '₺', name: 'Turkish Lira' },
  { code: 'zar', symbol: 'R', name: 'South African Rand' },
  { code: 'ngn', symbol: '₦', name: 'Nigerian Naira' },
]

// ── Shared reactive state (singleton across components) ─────────
const currency = ref('usd')
const denomination = ref('sats') // 'sats' | 'fiat'
const rate = ref(null)
const loading = ref(false)
let initialized = false

/**
 * Load persisted preferences from storage.
 * Called once on first use.
 */
async function initFromStorage() {
  if (initialized) return
  initialized = true
  try {
    const data = await chrome.storage.local.get(['fiatCurrency', 'denomination'])
    if (data.fiatCurrency) currency.value = data.fiatCurrency
    if (data.denomination) denomination.value = data.denomination
  } catch {
    // Storage not available (tests, etc.)
  }
}

// Persist currency changes
watch(currency, (val) => {
  try { chrome.storage.local.set({ fiatCurrency: val }) } catch {}
})

// Persist denomination changes
watch(denomination, (val) => {
  try { chrome.storage.local.set({ denomination: val }) } catch {}
})

export function useFiat() {
  // Init on first composable use
  initFromStorage()

  async function loadRate() {
    if (loading.value) return
    loading.value = true
    try {
      const result = await getExchangeRate(currency.value)
      rate.value = result.rate
    } catch {
      rate.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Get currency info for the current currency.
   */
  function currencyInfo() {
    return CURRENCIES.find(c => c.code === currency.value) || CURRENCIES[0]
  }

  /**
   * Convert sats to fiat display string.
   * Returns null if rate not loaded.
   */
  function toFiat(sats) {
    if (rate.value == null || sats == null) return null
    const amount = (sats / 1e8) * rate.value
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.value.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  /**
   * Convert sats to raw fiat number (no formatting).
   * Returns null if rate not loaded.
   */
  function toFiatRaw(sats) {
    if (rate.value == null || sats == null) return null
    return (sats / 1e8) * rate.value
  }

  /**
   * Convert fiat amount to sats.
   * Uses nostr-core's fiatToSats (which fetches rate if needed).
   */
  async function fiatToSats(amount) {
    if (!amount || amount <= 0) return 0
    const result = await nostrCoreFiatToSats(amount, currency.value)
    return result.sats
  }

  /**
   * Set the preferred fiat currency.
   */
  function setCurrency(c) {
    currency.value = c.toLowerCase()
    rate.value = null
    loadRate()
  }

  /**
   * Toggle denomination between sats and fiat.
   */
  function toggleDenomination() {
    denomination.value = denomination.value === 'sats' ? 'fiat' : 'sats'
  }

  return {
    currency,
    denomination,
    rate,
    loading,
    loadRate,
    toFiat,
    toFiatRaw,
    fiatToSats,
    setCurrency,
    toggleDenomination,
    currencyInfo,
  }
}
