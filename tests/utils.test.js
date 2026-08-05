/**
 * Tests for lib/utils.js — utility functions, formatting, payment detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeLnurl } from '../lib/lnurl.js'
import {
  cn, truncateKey, msatsToSats, satsToMsats, formatSats,
  cleanMessageContent, formatTimestamp, formatFullDate, detectPaymentInput,
} from '../lib/utils.js'

// ── cn ──────────────────────────────────────────────────────────

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('resolves tailwind conflicts (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('handles empty and falsy inputs', () => {
    expect(cn('', null, undefined, 'valid')).toBe('valid')
  })

  it('returns empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})

// ── truncateKey ─────────────────────────────────────────────────

describe('truncateKey', () => {
  it('truncates long keys with ellipsis', () => {
    const key = 'a'.repeat(64)
    const result = truncateKey(key)
    expect(result).toContain('\u2026')
    expect(result.length).toBeLessThan(64)
    expect(result).toBe('aaaaaaaaaa\u2026aaaaaa')
  })

  it('returns short keys unchanged', () => {
    expect(truncateKey('abc')).toBe('abc')
  })

  it('returns null/undefined as-is', () => {
    expect(truncateKey(null)).toBeNull()
    expect(truncateKey(undefined)).toBeUndefined()
  })

  it('returns empty string as-is', () => {
    expect(truncateKey('')).toBe('')
  })

  it('respects custom start/end lengths', () => {
    const key = 'abcdefghijklmnopqrstuvwxyz'
    const result = truncateKey(key, 5, 3)
    expect(result).toBe('abcde\u2026xyz')
  })

  it('returns key unchanged when length equals start + end', () => {
    const key = 'abcdefghijklmnop' // 16 chars = 10 + 6
    expect(truncateKey(key)).toBe(key)
  })
})

// ── msatsToSats / satsToMsats ───────────────────────────────────

describe('msatsToSats', () => {
  it('converts msats to sats (floor division)', () => {
    expect(msatsToSats(1000)).toBe(1)
    expect(msatsToSats(1500)).toBe(1)
    expect(msatsToSats(999)).toBe(0)
    expect(msatsToSats(0)).toBe(0)
  })

  it('handles large values', () => {
    expect(msatsToSats(21000000_000_000_000)).toBe(21000000_000_000)
  })
})

describe('satsToMsats', () => {
  it('converts sats to msats', () => {
    expect(satsToMsats(1)).toBe(1000)
    expect(satsToMsats(0)).toBe(0)
    expect(satsToMsats(100)).toBe(100000)
  })

  it('roundtrips through msatsToSats', () => {
    expect(msatsToSats(satsToMsats(42))).toBe(42)
  })
})

// ── formatSats ──────────────────────────────────────────────────

describe('formatSats', () => {
  it('formats with locale separators', () => {
    const result = formatSats(1000000)
    expect(result.replace(/[^0-9]/g, '')).toBe('1000000')
  })

  it('formats zero', () => {
    expect(formatSats(0)).toBe('0')
  })

  it('formats small numbers', () => {
    expect(formatSats(42)).toBe('42')
  })
})

// ── cleanMessageContent ─────────────────────────────────────────

describe('cleanMessageContent', () => {
  it('strips protocol markers', () => {
    expect(cleanMessageContent('[//]: # (nip18)\nHello world')).toBe('Hello world')
  })

  it('strips multiple markers', () => {
    expect(cleanMessageContent('[//]: # (nip18) [//]: # (other) Hello')).toBe('Hello')
  })

  it('returns empty string for falsy input', () => {
    expect(cleanMessageContent(null)).toBe('')
    expect(cleanMessageContent(undefined)).toBe('')
    expect(cleanMessageContent('')).toBe('')
  })

  it('trims whitespace', () => {
    expect(cleanMessageContent('  hello  ')).toBe('hello')
  })

  it('leaves normal content untouched', () => {
    expect(cleanMessageContent('Hello world!')).toBe('Hello world!')
  })
})

// ── formatTimestamp ─────────────────────────────────────────────

describe('formatTimestamp', () => {
  const NOW = new Date(2026, 2, 24, 12, 0, 0)
  const nowUnix = Math.floor(NOW.getTime() / 1000)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "now" for < 60s ago (no translator)', () => {
    expect(formatTimestamp(nowUnix - 30)).toBe('now')
  })

  it('returns minutes ago (no translator)', () => {
    expect(formatTimestamp(nowUnix - 300)).toBe('5m')
  })

  it('returns hours ago (no translator)', () => {
    expect(formatTimestamp(nowUnix - 7200)).toBe('2h')
  })

  it('returns days ago (no translator)', () => {
    expect(formatTimestamp(nowUnix - 172800)).toBe('2d')
  })

  it('returns date string for > 7 days', () => {
    const result = formatTimestamp(nowUnix - 700000)
    expect(result).toBeTruthy()
    expect(result).not.toMatch(/^[0-9]+[mhd]$/)
  })

  it('uses translator for justNow', () => {
    const t = vi.fn((key) => key)
    formatTimestamp(nowUnix - 10, t)
    expect(t).toHaveBeenCalledWith('chat.justNow')
  })

  it('passes count to translator for minutesAgo', () => {
    const t = vi.fn((key, params) => `${key}:${params?.n}`)
    formatTimestamp(nowUnix - 300, t)
    expect(t).toHaveBeenCalledWith('chat.minutesAgo', { n: 5 })
  })

  it('passes count to translator for hoursAgo', () => {
    const t = vi.fn((key, params) => `${key}:${params?.n}`)
    formatTimestamp(nowUnix - 7200, t)
    expect(t).toHaveBeenCalledWith('chat.hoursAgo', { n: 2 })
  })

  it('passes count to translator for daysAgo', () => {
    const t = vi.fn((key, params) => `${key}:${params?.n}`)
    formatTimestamp(nowUnix - 172800, t)
    expect(t).toHaveBeenCalledWith('chat.daysAgo', { n: 2 })
  })
})

// ── formatFullDate ──────────────────────────────────────────────

describe('formatFullDate', () => {
  it('returns a formatted date string with year', () => {
    const ts = Math.floor(new Date(2026, 2, 24, 14, 30).getTime() / 1000)
    const result = formatFullDate(ts)
    expect(result).toContain('2026')
    expect(result).toContain('24')
  })
})

// ── detectPaymentInput ──────────────────────────────────────────

describe('detectPaymentInput', () => {
  it('detects supported mobile-money phone numbers before numeric retail payloads', () => {
    const result = detectPaymentInput('+254 712 345 678')
    expect(result.type).toBe('mobile-payment')
    expect(result.value).toBe('254712345678@bitcoin.co.ke')
  })

  it('marks known payout-provider Lightning Addresses with mobile context', () => {
    const result = detectPaymentInput('260978123456@bitzed.xyz')
    expect(result.type).toBe('lnaddress')
    expect(result.mobile.country.code).toBe('ZM')
  })

  it('detects lightning invoices (lnbc)', () => {
    expect(detectPaymentInput('lnbc10u1p0abcdef').type).toBe('invoice')
  })

  it('detects testnet invoices (lntb)', () => {
    expect(detectPaymentInput('lntb10u1p0abcdef').type).toBe('invoice')
  })

  it('detects regtest invoices (lnbcrt)', () => {
    expect(detectPaymentInput('lnbcrt10u1p0test').type).toBe('invoice')
  })

  it('is case-insensitive for invoices', () => {
    expect(detectPaymentInput('LNBC10u1p0test').type).toBe('invoice')
  })

  it('strips lightning: prefix and re-detects', () => {
    const result = detectPaymentInput('lightning:lnbc10u1p0test')
    expect(result.type).toBe('invoice')
  })

  it('detects lightning addresses', () => {
    const result = detectPaymentInput('user@example.com')
    expect(result.type).toBe('lnaddress')
    expect(result.value).toBe('user@example.com')
  })

  it('detects complex lightning addresses', () => {
    expect(detectPaymentInput('my.name_test@sub.domain.org').type).toBe('lnaddress')
  })

  it('detects LUD-17 pay scheme', () => {
    const result = detectPaymentInput('lnurlp://example.com/pay')
    expect(result.type).toBe('lnurl')
    expect(result.lnurlType).toBe('pay')
  })

  it('detects LUD-17 withdraw scheme', () => {
    const result = detectPaymentInput('lnurlw://example.com/w')
    expect(result.type).toBe('lnurl')
    expect(result.lnurlType).toBe('withdraw')
  })

  it('detects LUD-17 auth scheme', () => {
    const result = detectPaymentInput('keyauth://example.com/auth')
    expect(result.type).toBe('lnurl')
    expect(result.lnurlType).toBe('auth')
  })

  it('detects bech32-encoded LNURL', () => {
    const encoded = encodeLnurl('https://example.com/lnurl')
    const result = detectPaymentInput(encoded)
    expect(result.type).toBe('lnurl')
  })

  it('returns unknown for unrecognized input', () => {
    expect(detectPaymentInput('just some text').type).toBe('unknown')
  })

  it('trims whitespace', () => {
    expect(detectPaymentInput('  user@example.com  ').type).toBe('lnaddress')
  })

  it('detects SA retailer QR codes', () => {
    const picknpayQR = '00020101021226440014za.co.electrum.picknpay0122MERCHANT123456789'
    const result = detectPaymentInput(picknpayQR)
    expect(result.type).toBe('merchant')
    expect(result.merchant).toBeDefined()
    expect(result.merchant.name).toBe('Pick n Pay')
  })
})

// ── Enterprise hardening: adversarial & boundary inputs ─────────

describe('msatsToSats — adversarial inputs', () => {
  it('returns NaN for NaN input', () => {
    expect(msatsToSats(NaN)).toBeNaN()
  })

  it('returns -Infinity for -Infinity', () => {
    expect(msatsToSats(-Infinity)).toBe(-Infinity)
  })

  it('handles negative msats', () => {
    expect(msatsToSats(-1000)).toBe(-1)
  })
})

describe('satsToMsats — adversarial inputs', () => {
  it('returns NaN for NaN input', () => {
    expect(satsToMsats(NaN)).toBeNaN()
  })

  it('handles negative sats', () => {
    expect(satsToMsats(-5)).toBe(-5000)
  })
})

describe('formatSats — adversarial inputs', () => {
  it('formats negative sats', () => {
    const result = formatSats(-1000)
    expect(result).toContain('1')
  })

  it('formats NaN', () => {
    const result = formatSats(NaN)
    expect(result).toBe('NaN')
  })
})

describe('truncateKey — adversarial inputs', () => {
  it('handles key of exactly start length', () => {
    expect(truncateKey('abcdefghij', 10, 6)).toBe('abcdefghij')
  })

  it('handles unicode characters in key', () => {
    const key = '🔑'.repeat(20)
    const result = truncateKey(key)
    expect(result).toContain('\u2026')
  })
})

describe('cleanMessageContent — adversarial inputs', () => {
  it('handles HTML-like content (no stripping)', () => {
    expect(cleanMessageContent('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })

  it('handles multiple newlines', () => {
    expect(cleanMessageContent('\n\n\nhello\n\n')).toBe('hello')
  })

  it('handles only protocol markers (empty after strip)', () => {
    expect(cleanMessageContent('[//]: # (nip18)')).toBe('')
  })
})

describe('formatTimestamp — adversarial inputs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 24, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles future timestamps (negative diff)', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const result = formatTimestamp(future)
    // Negative diff doesn't match any bucket — falls through to date format
    expect(result).toBeTruthy()
  })

  it('handles zero timestamp (epoch)', () => {
    const result = formatTimestamp(0)
    expect(result).toBeTruthy()
  })
})

describe('detectPaymentInput — adversarial inputs', () => {
  it('handles empty string', () => {
    expect(detectPaymentInput('').type).toBe('unknown')
  })

  it('handles very long input', () => {
    const long = 'x'.repeat(10000)
    expect(detectPaymentInput(long).type).toBe('unknown')
  })

  it('rejects email-like strings missing TLD', () => {
    expect(detectPaymentInput('user@localhost').type).toBe('unknown')
  })

  it('handles nested lightning: prefix', () => {
    const result = detectPaymentInput('lightning:lightning:lnbc10u1')
    // Second strip should detect the invoice
    expect(result.type).toBe('invoice')
  })

  it('handles LIGHTNING: uppercase prefix', () => {
    const result = detectPaymentInput('LIGHTNING:lnbc10u1p0test')
    expect(result.type).toBe('invoice')
  })

  it('rejects email with special chars in local part', () => {
    // Only a-z, 0-9, ., _, - are valid per the regex
    expect(detectPaymentInput('user+tag@example.com').type).toBe('unknown')
  })
})
