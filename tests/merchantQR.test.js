/**
 * Tests for lib/merchantQR.js — SA retailer QR detection and Lightning conversion.
 */

import { describe, it, expect } from 'vitest'
import {
  isSARetailerQR, isConvertibleQR, getMerchantInfo,
  getMerchantInitials, parseZARFromMetadata, parseZARFromDescription,
  convertToLightningAddress, RETAILERS,
} from '../lib/merchantQR.js'

// ── EMVCo Phase 1 QR payloads (convertible to Lightning) ────────

const PNP_QR = '00020101021226440014za.co.electrum.picknpay0122MERCHANT123456789'
const WOOLWORTHS_QR = '00020101021226350011za.co.ecentric0122WOOLWORTHS123'
const CHECKERS_QR = '00020101021226350011za.co.electrum0122CHECKERS12345'

// ── Phase 2 QR payloads (recognized, not convertible) ───────────

const SNAPSCAN_QR = 'https://snapscan.io/pay/merchant123'
const ZAPPER_QR = 'https://zapper.com/pay/merchant'
const SCANTOPAY_QR = 'https://scantopay.io/pay/merchant'

// ── isSARetailerQR ─────────────────────────────────────────────

describe('isSARetailerQR', () => {
  it('detects Pick n Pay EMVCo QR', () => {
    expect(isSARetailerQR(PNP_QR)).toBe(true)
  })

  it('detects Woolworths EMVCo QR', () => {
    expect(isSARetailerQR(WOOLWORTHS_QR)).toBe(true)
  })

  it('detects Checkers/Shoprite EMVCo QR', () => {
    expect(isSARetailerQR(CHECKERS_QR)).toBe(true)
  })

  it('detects SnapScan (Phase 2)', () => {
    expect(isSARetailerQR(SNAPSCAN_QR)).toBe(true)
  })

  it('rejects non-SA QR payloads', () => {
    expect(isSARetailerQR('lnbc10u1p0abcdef')).toBe(false)
    expect(isSARetailerQR('hello world')).toBe(false)
  })

  it('rejects null/empty/non-string', () => {
    expect(isSARetailerQR(null)).toBe(false)
    expect(isSARetailerQR('')).toBe(false)
    expect(isSARetailerQR(undefined)).toBe(false)
    expect(isSARetailerQR(123)).toBe(false)
  })
})

// ── isConvertibleQR ─────────────────────────────────────────────

describe('isConvertibleQR', () => {
  it('returns true for Phase 1 EMVCo QR (Pick n Pay)', () => {
    expect(isConvertibleQR(PNP_QR)).toBe(true)
  })

  it('returns true for Woolworths', () => {
    expect(isConvertibleQR(WOOLWORTHS_QR)).toBe(true)
  })

  it('returns false for Phase 2 QR (SnapScan)', () => {
    expect(isConvertibleQR(SNAPSCAN_QR)).toBe(false)
  })

  it('returns false for Zapper', () => {
    expect(isConvertibleQR(ZAPPER_QR)).toBe(false)
  })

  it('returns false for unrecognized payload', () => {
    expect(isConvertibleQR('random-text')).toBe(false)
  })
})

// ── getMerchantInfo ─────────────────────────────────────────────

describe('getMerchantInfo', () => {
  it('returns Pick n Pay info', () => {
    const info = getMerchantInfo(PNP_QR)
    expect(info).not.toBeNull()
    expect(info.id).toBe('picknpay')
    expect(info.name).toBe('Pick n Pay')
    expect(info.color).toBe('#003DA5')
    expect(info.logo).toContain('picknpay')
    expect(info.emvco).toBe(true)
  })

  it('returns Woolworths info', () => {
    const info = getMerchantInfo(WOOLWORTHS_QR)
    expect(info.id).toBe('ecentric')
    expect(info.name).toBe('Woolworths')
    expect(info.emvco).toBe(true)
  })

  it('returns Checkers/Shoprite info', () => {
    const info = getMerchantInfo(CHECKERS_QR)
    expect(info.id).toBe('checkers_shoprite')
    expect(info.name).toBe('Checkers / Shoprite')
  })

  it('returns null for unknown payload', () => {
    expect(getMerchantInfo('unknown')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(getMerchantInfo(null)).toBeNull()
  })

  it('PnP matched before generic electrum (order matters)', () => {
    // PnP QR contains "za.co.electrum.picknpay" which also matches "za.co.electrum"
    // PnP must be detected first
    const info = getMerchantInfo(PNP_QR)
    expect(info.id).toBe('picknpay')
    expect(info.id).not.toBe('checkers_shoprite')
  })
})

// ── convertToLightningAddress ───────────────────────────────────

describe('convertToLightningAddress', () => {
  it('converts QR payload to cryptoqr.net Lightning Address', () => {
    const result = convertToLightningAddress(PNP_QR)
    expect(result).toContain('@cryptoqr.net')
    expect(result).toContain(encodeURIComponent(PNP_QR))
  })

  it('trims whitespace before encoding', () => {
    const result = convertToLightningAddress('  ' + PNP_QR + '  ')
    expect(result).toContain(encodeURIComponent(PNP_QR))
  })

  it('returns null for null input', () => {
    expect(convertToLightningAddress(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(convertToLightningAddress('')).toBeNull()
  })
})

// ── getMerchantInitials ─────────────────────────────────────────

describe('getMerchantInitials', () => {
  it('returns two-letter initials', () => {
    expect(getMerchantInitials('Pick n Pay')).toBe('PN')
  })

  it('returns single letter for single word', () => {
    expect(getMerchantInitials('Woolworths')).toBe('W')
  })

  it('truncates to 2 characters', () => {
    expect(getMerchantInitials('Checkers / Shoprite')).toBe('C/')
  })

  it('handles uppercase conversion', () => {
    expect(getMerchantInitials('hello world')).toBe('HW')
  })

  it('returns ? for null/empty', () => {
    expect(getMerchantInitials(null)).toBe('?')
    expect(getMerchantInitials('')).toBe('?')
    expect(getMerchantInitials(undefined)).toBe('?')
  })
})

// ── parseZARFromMetadata ────────────────────────────────────────

describe('parseZARFromMetadata', () => {
  it('parses CryptoQR metadata format', () => {
    const metadata = [['text/plain', 'MBadger: Pick n Pay - R125.50']]
    const result = parseZARFromMetadata(metadata)
    expect(result).not.toBeNull()
    expect(result.zarAmount).toBe(125.50)
    expect(result.storeName).toBe('Pick n Pay')
  })

  it('parses JSON string metadata', () => {
    const json = JSON.stringify([['text/plain', 'MBadger: Store - R42.00']])
    const result = parseZARFromMetadata(json)
    expect(result.zarAmount).toBe(42.00)
  })

  it('returns null for missing text/plain', () => {
    const metadata = [['image/png', 'data']]
    expect(parseZARFromMetadata(metadata)).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseZARFromMetadata(null)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseZARFromMetadata('not json')).toBeNull()
  })
})

// ── parseZARFromDescription ─────────────────────────────────────

describe('parseZARFromDescription', () => {
  it('parses "R125.50" format', () => {
    const result = parseZARFromDescription('MBadger: Pick n Pay - R125.50')
    expect(result.zarAmount).toBe(125.50)
    expect(result.storeName).toBe('Pick n Pay')
  })

  it('parses "R 42.00" format (space after R)', () => {
    const result = parseZARFromDescription('R 42.00')
    expect(result.zarAmount).toBe(42.00)
  })

  it('parses "ZAR 100" format', () => {
    const result = parseZARFromDescription('ZAR 100')
    expect(result.zarAmount).toBe(100)
  })

  it('parses comma-separated thousands', () => {
    const result = parseZARFromDescription('R1,250.99')
    expect(result.zarAmount).toBe(1250.99)
  })

  it('extracts store name from MBadger format', () => {
    const result = parseZARFromDescription('MBadger: Woolworths - R50.00')
    expect(result.storeName).toBe('Woolworths')
  })

  it('returns null for no amount found', () => {
    expect(parseZARFromDescription('no amount here')).toBeNull()
  })

  it('returns null for null/empty', () => {
    expect(parseZARFromDescription(null)).toBeNull()
    expect(parseZARFromDescription('')).toBeNull()
  })

  it('rejects zero/negative amounts', () => {
    expect(parseZARFromDescription('R0')).toBeNull()
    expect(parseZARFromDescription('R0.00')).toBeNull()
  })
})

// ── RETAILERS array ─────────────────────────────────────────────

describe('RETAILERS', () => {
  it('has at least 3 Phase 1 (EMVCo) retailers', () => {
    const phase1 = RETAILERS.filter(r => r.emvco)
    expect(phase1.length).toBeGreaterThanOrEqual(3)
  })

  it('every retailer has required fields', () => {
    for (const r of RETAILERS) {
      expect(r.id).toBeTruthy()
      expect(r.name).toBeTruthy()
      expect(r.pattern).toBeInstanceOf(RegExp)
      expect(typeof r.emvco).toBe('boolean')
      expect(r.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(r.logo).toBeTruthy()
    }
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('parseZARFromDescription — adversarial inputs', () => {
  it('handles "R.50" (no leading digit)', () => {
    // R.50 — regex expects R followed by digits
    const result = parseZARFromDescription('R.50')
    expect(result).toBeNull()
  })

  it('handles "R-50" (negative amount)', () => {
    const result = parseZARFromDescription('R-50')
    expect(result).toBeNull()
  })

  it('handles multiple R amounts (first match wins)', () => {
    const result = parseZARFromDescription('R10 and R20')
    expect(result.zarAmount).toBe(10)
  })

  it('handles very large amount', () => {
    const result = parseZARFromDescription('R999999.99')
    expect(result.zarAmount).toBe(999999.99)
  })

  it('handles "ZAR 0" (zero)', () => {
    expect(parseZARFromDescription('ZAR 0')).toBeNull()
  })

  it('handles unicode in description', () => {
    const result = parseZARFromDescription('Badger: Ñoño - R42.00')
    expect(result.zarAmount).toBe(42)
  })
})

describe('parseZARFromMetadata — adversarial inputs', () => {
  it('handles array with null entries', () => {
    expect(parseZARFromMetadata([null, ['text/plain', 'R10']])).toBeNull()
  })

  it('handles empty array', () => {
    expect(parseZARFromMetadata([])).toBeNull()
  })

  it('handles nested arrays wrong structure', () => {
    expect(parseZARFromMetadata([['text/plain']])).toBeNull()
  })
})

describe('getMerchantInitials — adversarial inputs', () => {
  it('single character name', () => {
    expect(getMerchantInitials('A')).toBe('A')
  })

  it('name with numbers', () => {
    expect(getMerchantInitials('24Seven')).toBe('2')
  })

  it('name with leading spaces', () => {
    expect(getMerchantInitials('  Spar  ')).toBe('S')
  })
})

describe('isSARetailerQR — adversarial inputs', () => {
  it('handles very long payload', () => {
    const long = 'x'.repeat(10000)
    expect(isSARetailerQR(long)).toBe(false)
  })

  it('handles whitespace-only payload', () => {
    expect(isSARetailerQR('   ')).toBe(false)
  })

  it('case insensitive matching', () => {
    const upper = '00020101021226440014ZA.CO.ELECTRUM.PICKNPAY0122TEST'
    expect(isSARetailerQR(upper)).toBe(true)
  })
})
