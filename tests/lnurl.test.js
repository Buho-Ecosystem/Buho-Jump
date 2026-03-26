/**
 * Tests for lib/lnurl.js — re-exported primitives, pay params, invoice fetch, validation.
 *
 * Network-dependent functions mock nostr-core's fetchPayRequest / requestInvoice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lnurl as lnurlCore } from 'nostr-core'

vi.mock('nostr-core', async () => {
  const actual = await vi.importActual('nostr-core')
  return {
    ...actual,
    lnurl: {
      ...actual.lnurl,
      fetchPayRequest: vi.fn(),
      requestInvoice: vi.fn(),
    },
  }
})

import {
  decodeLnurl, encodeLnurl, isLnurl,
  fetchLnurlPayParams, fetchLnurlPayInvoice, executeLnurlPay,
} from '../lib/lnurl.js'

// ── Primitives (real nostr-core bech32) ─────────────────────────

describe('encodeLnurl / decodeLnurl', () => {
  it('round-trips a URL through bech32', () => {
    const url = 'https://service.example.com/api?q=1'
    const encoded = encodeLnurl(url)
    expect(encoded).toBeTruthy()
    expect(encoded.toLowerCase().startsWith('lnurl')).toBe(true)
    const decoded = decodeLnurl(encoded)
    expect(decoded).toBe(url)
  })
})

describe('isLnurl', () => {
  it('recognizes bech32-encoded LNURL strings', () => {
    const encoded = encodeLnurl('https://example.com/lnurl')
    expect(isLnurl(encoded)).toBe(true)
  })

  it('rejects plain strings', () => {
    expect(isLnurl('hello world')).toBe(false)
  })

  it('rejects empty strings', () => {
    expect(isLnurl('')).toBe(false)
  })
})

// ── fetchLnurlPayParams (mock network) ──────────────────────────

describe('fetchLnurlPayParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts msats to sats', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,      // 1 sat
      maxSendable: 100000000, // 100k sats
      metadata: '[]',
      commentAllowed: 0,
      tag: 'payRequest',
    })

    const params = await fetchLnurlPayParams('test@example.com')
    expect(params.minSendable).toBe(1)        // ceil(1000 / 1000) = 1
    expect(params.maxSendable).toBe(100000)    // floor(100000000 / 1000) = 100000
    expect(params.callback).toBe('https://example.com/cb')
    expect(params.metadata).toBe('[]')
  })

  it('rounds minSendable up (ceil) and maxSendable down (floor)', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1500,  // 1.5 → ceil → 2
      maxSendable: 99500, // 99.5 → floor → 99
      metadata: '[]',
      tag: 'payRequest',
    })

    const params = await fetchLnurlPayParams('input')
    expect(params.minSendable).toBe(2)
    expect(params.maxSendable).toBe(99)
  })

  it('preserves _raw for requestInvoice', async () => {
    const rawResponse = {
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 1000000,
      metadata: '[]',
      tag: 'payRequest',
    }
    lnurlCore.fetchPayRequest.mockResolvedValue(rawResponse)

    const params = await fetchLnurlPayParams('input')
    expect(params._raw).toBe(rawResponse)
  })
})

// ── fetchLnurlPayInvoice ────────────────────────────────────────

describe('fetchLnurlPayInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns invoice and successAction', async () => {
    lnurlCore.requestInvoice.mockResolvedValue({
      pr: 'lnbc100u1p0test',
      successAction: { tag: 'message', message: 'Thanks!' },
      verify: 'https://example.com/verify',
    })

    const rawPayReq = { callback: 'https://example.com/cb' }
    const result = await fetchLnurlPayInvoice({ _raw: rawPayReq }, 100)

    expect(result.invoice).toBe('lnbc100u1p0test')
    expect(result.successAction.tag).toBe('message')
    expect(result.verify).toBe('https://example.com/verify')
    expect(lnurlCore.requestInvoice).toHaveBeenCalledWith(rawPayReq, 100000, undefined)
  })

  it('passes comment option when provided', async () => {
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc1', successAction: null })

    await fetchLnurlPayInvoice({ _raw: {} }, 50, 'a comment')

    expect(lnurlCore.requestInvoice).toHaveBeenCalledWith({}, 50000, { comment: 'a comment' })
  })

  it('returns null successAction when not present', async () => {
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc1' })

    const result = await fetchLnurlPayInvoice({ _raw: {} }, 10)
    expect(result.successAction).toBeNull()
    expect(result.verify).toBeNull()
  })
})

// ── executeLnurlPay ─────────────────────────────────────────────

describe('executeLnurlPay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects amount below minSendable', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 10000, // 10 sats
      maxSendable: 1000000,
      metadata: '[]',
      tag: 'payRequest',
    })

    await expect(executeLnurlPay('addr@test.com', 5)).rejects.toThrow('Minimum amount is 10 sats')
  })

  it('rejects amount above maxSendable', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 100000, // 100 sats
      metadata: '[]',
      tag: 'payRequest',
    })

    await expect(executeLnurlPay('addr@test.com', 200)).rejects.toThrow('Maximum amount is 100 sats')
  })

  it('succeeds within min/max range', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 1000000,
      metadata: '[]',
      tag: 'payRequest',
    })
    lnurlCore.requestInvoice.mockResolvedValue({
      pr: 'lnbc50u1p0valid',
      successAction: null,
    })

    const result = await executeLnurlPay('addr@test.com', 50)
    expect(result.invoice).toBe('lnbc50u1p0valid')
  })

  it('accepts exact minSendable boundary', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 10000, // 10 sats
      maxSendable: 1000000,
      metadata: '[]',
      tag: 'payRequest',
    })
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc10u1', successAction: null })

    const result = await executeLnurlPay('addr@test.com', 10) // exactly min
    expect(result.invoice).toBe('lnbc10u1')
  })

  it('accepts exact maxSendable boundary', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 100000, // 100 sats
      metadata: '[]',
      tag: 'payRequest',
    })
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc100u1', successAction: null })

    const result = await executeLnurlPay('addr@test.com', 100) // exactly max
    expect(result.invoice).toBe('lnbc100u1')
  })

  it('propagates fetchPayRequest errors', async () => {
    lnurlCore.fetchPayRequest.mockRejectedValue(new Error('Network failed'))
    await expect(executeLnurlPay('addr@test.com', 50)).rejects.toThrow('Network failed')
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('fetchLnurlPayParams — boundary conditions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('handles zero minSendable', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'cb', minSendable: 0, maxSendable: 1000, metadata: '[]', tag: 'payRequest',
    })
    const params = await fetchLnurlPayParams('test')
    expect(params.minSendable).toBe(0)
  })

  it('handles missing commentAllowed', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'cb', minSendable: 1000, maxSendable: 100000, metadata: '[]', tag: 'payRequest',
    })
    const params = await fetchLnurlPayParams('test')
    expect(params.commentAllowed).toBe(0) // default
  })

  it('handles missing metadata', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'cb', minSendable: 1000, maxSendable: 100000, tag: 'payRequest',
    })
    const params = await fetchLnurlPayParams('test')
    expect(params.metadata).toBe('[]') // default
  })
})
