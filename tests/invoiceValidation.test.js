import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeBolt11 } from 'nostr-core'

vi.mock('nostr-core', async () => ({
  ...(await vi.importActual('nostr-core')),
  decodeBolt11: vi.fn(),
}))

import { validatePaymentInvoice } from '../lib/invoiceValidation.js'

describe('validatePaymentInvoice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a valid fixed-amount invoice', () => {
    decodeBolt11.mockReturnValue({ amountMsat: 21_000, isExpired: false })
    expect(validatePaymentInvoice('lnbc-valid').amountSats).toBe(21)
  })

  it('requires explicit user-approved sats for an amountless invoice', () => {
    decodeBolt11.mockReturnValue({ amountMsat: undefined, isExpired: false })
    expect(() => validatePaymentInvoice('lnbc-amountless')).toThrow('requires an amount')
    expect(validatePaymentInvoice('lnbc-amountless', 42).amountMsat).toBe(42_000)
  })

  it('rejects expired and mismatched invoices', () => {
    decodeBolt11.mockReturnValue({ amountMsat: 10_000, isExpired: true })
    expect(() => validatePaymentInvoice('lnbc-expired')).toThrow('expired')

    decodeBolt11.mockReturnValue({ amountMsat: 10_000, isExpired: false })
    expect(() => validatePaymentInvoice('lnbc-mismatch', 11)).toThrow('does not match')
  })
})
