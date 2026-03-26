/**
 * Tests for composables/useFiat.js — fiat conversion, currency info, denomination toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'

vi.mock('nostr-core', async () => {
  const actual = await vi.importActual('nostr-core')
  return {
    ...actual,
    getExchangeRate: vi.fn(async () => ({ rate: 65000 })),
    fiatToSats: vi.fn(async (amount) => ({ sats: Math.round(amount / 65000 * 1e8) })),
  }
})

import { useFiat, CURRENCIES } from '../composables/useFiat.js'

beforeEach(() => {
  resetStorage()
  // Reset singleton state
  const fiat = useFiat()
  fiat.currency.value = 'usd'
  fiat.denomination.value = 'sats'
  fiat.rate.value = null
  fiat.loading.value = false
})

// ── toFiat / toFiatRaw ──────────────────────────────────────────

describe('toFiat', () => {
  it('returns null when rate is not loaded', () => {
    const { toFiat } = useFiat()
    expect(toFiat(100)).toBeNull()
  })

  it('returns null when sats is null', () => {
    const { toFiat, rate } = useFiat()
    rate.value = 65000
    expect(toFiat(null)).toBeNull()
  })

  it('converts sats to formatted fiat string when rate is set', () => {
    const { toFiat, rate } = useFiat()
    rate.value = 65000 // $65k per BTC
    const result = toFiat(100000000) // 1 BTC
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    // Should contain 65,000 or 65000 (locale-dependent)
    expect(result.replace(/[^0-9.]/g, '')).toContain('65000')
  })

  it('handles zero sats', () => {
    const { toFiat, rate } = useFiat()
    rate.value = 65000
    const result = toFiat(0)
    expect(result).toBeTruthy()
    expect(result.replace(/[^0-9.]/g, '')).toContain('0')
  })
})

describe('toFiatRaw', () => {
  it('returns raw number (no formatting)', () => {
    const { toFiatRaw, rate } = useFiat()
    rate.value = 65000
    const result = toFiatRaw(100000000) // 1 BTC
    expect(result).toBe(65000)
  })

  it('returns null when rate is not loaded', () => {
    const { toFiatRaw } = useFiat()
    expect(toFiatRaw(100)).toBeNull()
  })
})

// ── fiatToSats ──────────────────────────────────────────────────

describe('fiatToSats', () => {
  it('converts fiat amount to sats', async () => {
    const { fiatToSats } = useFiat()
    const sats = await fiatToSats(10)
    expect(typeof sats).toBe('number')
    expect(sats).toBeGreaterThan(0)
  })

  it('returns 0 for zero amount', async () => {
    const { fiatToSats } = useFiat()
    expect(await fiatToSats(0)).toBe(0)
  })

  it('returns 0 for negative amount', async () => {
    const { fiatToSats } = useFiat()
    expect(await fiatToSats(-5)).toBe(0)
  })
})

// ── currencyInfo ────────────────────────────────────────────────

describe('currencyInfo', () => {
  it('returns info for current currency (default: usd)', () => {
    const { currencyInfo } = useFiat()
    const info = currencyInfo()
    expect(info.code).toBe('usd')
    expect(info.symbol).toBe('$')
    expect(info.name).toBe('US Dollar')
  })

  it('returns correct info after currency change', () => {
    const { currencyInfo, currency } = useFiat()
    currency.value = 'eur'
    const info = currencyInfo()
    expect(info.code).toBe('eur')
    expect(info.symbol).toBe('€')
  })

  it('falls back to USD for unknown currency', () => {
    const { currencyInfo, currency } = useFiat()
    currency.value = 'zzz'
    const info = currencyInfo()
    expect(info.code).toBe('usd') // fallback
  })
})

// ── CURRENCIES constant ─────────────────────────────────────────

describe('CURRENCIES', () => {
  it('has 19 supported currencies', () => {
    expect(CURRENCIES).toHaveLength(19)
  })

  it('every currency has code, symbol, and name', () => {
    for (const c of CURRENCIES) {
      expect(c.code).toBeTruthy()
      expect(c.symbol).toBeTruthy()
      expect(c.name).toBeTruthy()
    }
  })

  it('includes USD, EUR, GBP, ZAR', () => {
    const codes = CURRENCIES.map(c => c.code)
    expect(codes).toContain('usd')
    expect(codes).toContain('eur')
    expect(codes).toContain('gbp')
    expect(codes).toContain('zar')
  })
})

// ── toggleDenomination ──────────────────────────────────────────

describe('toggleDenomination', () => {
  it('switches from sats to fiat', () => {
    const { denomination, toggleDenomination } = useFiat()
    expect(denomination.value).toBe('sats')
    toggleDenomination()
    expect(denomination.value).toBe('fiat')
  })

  it('switches from fiat back to sats', () => {
    const { denomination, toggleDenomination } = useFiat()
    denomination.value = 'fiat'
    toggleDenomination()
    expect(denomination.value).toBe('sats')
  })
})

// ── setCurrency ─────────────────────────────────────────────────

describe('setCurrency', () => {
  it('changes currency and clears rate', () => {
    const { setCurrency, currency, rate } = useFiat()
    rate.value = 65000
    setCurrency('EUR')
    expect(currency.value).toBe('eur') // lowercased
    expect(rate.value).toBeNull() // cleared
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('toFiat — adversarial inputs', () => {
  it('returns formatted string for zero sats', () => {
    const { toFiat, rate } = useFiat()
    rate.value = 65000
    const result = toFiat(0)
    expect(result).toBeTruthy()
    expect(result.replace(/[^0-9.]/g, '')).toContain('0')
  })

  it('handles negative sats', () => {
    const { toFiat, rate } = useFiat()
    rate.value = 65000
    const result = toFiat(-100000000)
    // Negative produces negative fiat — Intl.NumberFormat handles sign
    expect(result).toBeTruthy()
  })

  it('handles NaN sats', () => {
    const { toFiatRaw, rate } = useFiat()
    rate.value = 65000
    const result = toFiatRaw(NaN)
    expect(result).toBeNaN()
  })

  it('handles zero rate', () => {
    const { toFiatRaw, rate } = useFiat()
    rate.value = 0
    expect(toFiatRaw(100000000)).toBe(0)
  })

  it('handles MAX_SAFE_INTEGER sats', () => {
    const { toFiatRaw, rate } = useFiat()
    rate.value = 65000
    const result = toFiatRaw(Number.MAX_SAFE_INTEGER)
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

describe('fiatToSats — adversarial inputs', () => {
  it('returns 0 for null amount', async () => {
    const { fiatToSats } = useFiat()
    expect(await fiatToSats(null)).toBe(0)
  })

  it('returns 0 for undefined amount', async () => {
    const { fiatToSats } = useFiat()
    expect(await fiatToSats(undefined)).toBe(0)
  })

  it('returns 0 for empty string amount', async () => {
    const { fiatToSats } = useFiat()
    expect(await fiatToSats('')).toBe(0)
  })
})

describe('toggleDenomination — rapid toggle', () => {
  it('double toggle returns to original', () => {
    const { denomination, toggleDenomination } = useFiat()
    const original = denomination.value
    toggleDenomination()
    toggleDenomination()
    expect(denomination.value).toBe(original)
  })
})
