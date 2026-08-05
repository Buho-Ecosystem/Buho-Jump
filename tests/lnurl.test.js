/**
 * Tests for lib/lnurl.js — re-exported primitives, pay params, invoice fetch, validation.
 *
 * Network-dependent functions mock nostr-core's fetchPayRequest / requestInvoice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lnurl as lnurlCore, decodeBolt11 } from 'nostr-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

vi.mock('nostr-core', async () => {
  const actual = await vi.importActual('nostr-core')
  return {
    ...actual,
    decodeBolt11: vi.fn(),
    lnurl: {
      ...actual.lnurl,
      fetchPayRequest: vi.fn(),
      requestInvoice: vi.fn(),
    },
  }
})

import {
  decodeLnurl, encodeLnurl, isLnurl,
  fetchLnurlPayParams, fetchLnurlPayInvoice, executeLnurlPay, resolveLnurlServiceUrl,
} from '../lib/lnurl.js'

const EMPTY_METADATA_HASH = bytesToHex(sha256(utf8ToBytes('[]')))

function mockInvoice(amountMsat, overrides = {}) {
  decodeBolt11.mockReturnValue({
    amountMsat,
    descriptionHash: EMPTY_METADATA_HASH,
    isExpired: false,
    ...overrides,
  })
}

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

describe('resolveLnurlServiceUrl', () => {
  it('resolves a Lightning Address to its exact HTTPS service', () => {
    expect(resolveLnurlServiceUrl('alice@example.com'))
      .toBe('https://example.com/.well-known/lnurlp/alice')
  })

  it('resolves an encoded LNURL and rejects insecure public services', () => {
    const encoded = encodeLnurl('https://service.example.com/pay')
    expect(resolveLnurlServiceUrl(encoded)).toBe('https://service.example.com/pay')
    expect(() => resolveLnurlServiceUrl('http://service.example.com/pay')).toThrow()
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

    const params = await fetchLnurlPayParams('lnurlp://example.com/pay')
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

describe('Lightning Address currency extension', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves LUD-21 currency data from the address endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag: 'payRequest', callback: 'https://pay.example/cb',
        minSendable: 1000, maxSendable: 1000000, metadata: '[]',
        currency: { code: 'KES', symbol: 'KSh', decimals: 0, multiplier: 5000 },
      }),
    }))
    const params = await fetchLnurlPayParams('254712345678@pay.example')
    expect(params.currency).toEqual({
      code: 'KES', symbol: 'KSh', decimals: 0,
      minSendable: 0, maxSendable: 0, multiplier: 5000,
    })
  })

  it('requests an exact local-currency payout invoice', async () => {
    mockInvoice(50_000)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pr: 'lnbc1payout', verify: 'https://pay.example/verify' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchLnurlPayInvoice({
      callback: 'https://pay.example/cb', commentAllowed: 0,
      _raw: { callback: 'https://pay.example/cb' },
    }, 50, null, { code: 'KES', amount: 100 })
    expect(fetchMock.mock.calls[0][0]).toContain('amount=100&currency=KES')
    expect(result.verify).toBe('https://pay.example/verify')
  })
})

// ── fetchLnurlPayInvoice ────────────────────────────────────────

describe('fetchLnurlPayInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns invoice and successAction', async () => {
    mockInvoice(100_000)
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
    mockInvoice(50_000)
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc1', successAction: null })

    const raw = { callback: 'https://example.com/cb' }
    await fetchLnurlPayInvoice({ callback: raw.callback, _raw: raw }, 50, 'a comment')

    expect(lnurlCore.requestInvoice).toHaveBeenCalledWith(raw, 50000, { comment: 'a comment' })
  })

  it('returns null successAction when not present', async () => {
    mockInvoice(10_000)
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc1' })

    const raw = { callback: 'https://example.com/cb' }
    const result = await fetchLnurlPayInvoice({ callback: raw.callback, _raw: raw }, 10)
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

    await expect(executeLnurlPay('lnurlp://test.com/pay', 5)).rejects.toThrow('Minimum amount is 10 sats')
  })

  it('rejects amount above maxSendable', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 100000, // 100 sats
      metadata: '[]',
      tag: 'payRequest',
    })

    await expect(executeLnurlPay('lnurlp://test.com/pay', 200)).rejects.toThrow('Maximum amount is 100 sats')
  })

  it('succeeds within min/max range', async () => {
    mockInvoice(50_000)
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

    const result = await executeLnurlPay('lnurlp://test.com/pay', 50)
    expect(result.invoice).toBe('lnbc50u1p0valid')
  })

  it('accepts exact minSendable boundary', async () => {
    mockInvoice(10_000)
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 10000, // 10 sats
      maxSendable: 1000000,
      metadata: '[]',
      tag: 'payRequest',
    })
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc10u1', successAction: null })

    const result = await executeLnurlPay('lnurlp://test.com/pay', 10) // exactly min
    expect(result.invoice).toBe('lnbc10u1')
  })

  it('accepts exact maxSendable boundary', async () => {
    mockInvoice(100_000)
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb',
      minSendable: 1000,
      maxSendable: 100000, // 100 sats
      metadata: '[]',
      tag: 'payRequest',
    })
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc100u1', successAction: null })

    const result = await executeLnurlPay('lnurlp://test.com/pay', 100) // exactly max
    expect(result.invoice).toBe('lnbc100u1')
  })

  it('propagates fetchPayRequest errors', async () => {
    lnurlCore.fetchPayRequest.mockRejectedValue(new Error('Network failed'))
    await expect(executeLnurlPay('lnurlp://test.com/pay', 50)).rejects.toThrow('Network failed')
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('fetchLnurlPayParams — boundary conditions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a zero minimum', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb', minSendable: 0, maxSendable: 1000, metadata: '[]', tag: 'payRequest',
    })
    await expect(fetchLnurlPayParams('test')).rejects.toThrow('amount range')
  })

  it('handles missing commentAllowed', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb', minSendable: 1000, maxSendable: 100000, metadata: '[]', tag: 'payRequest',
    })
    const params = await fetchLnurlPayParams('test')
    expect(params.commentAllowed).toBe(0) // default
  })

  it('rejects missing metadata', async () => {
    lnurlCore.fetchPayRequest.mockResolvedValue({
      callback: 'https://example.com/cb', minSendable: 1000, maxSendable: 100000, tag: 'payRequest',
    })
    await expect(fetchLnurlPayParams('test')).rejects.toThrow('metadata')
  })
})

describe('LNURL invoice binding', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects an invoice for more than the user approved', async () => {
    mockInvoice(101_000)
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc-tampered' })
    await expect(fetchLnurlPayInvoice({
      callback: 'https://example.com/cb',
      metadata: '[]',
      _raw: { callback: 'https://example.com/cb', metadata: '[]' },
    }, 100)).rejects.toThrow('does not match the approved amount')
  })

  it('rejects an invoice that does not commit to LNURL metadata', async () => {
    mockInvoice(100_000, { descriptionHash: '00'.repeat(32) })
    lnurlCore.requestInvoice.mockResolvedValue({ pr: 'lnbc-wrong-description' })
    await expect(fetchLnurlPayInvoice({
      callback: 'https://example.com/cb',
      metadata: '[["text/plain","Coffee"]]',
      _raw: { callback: 'https://example.com/cb', metadata: '[["text/plain","Coffee"]]' },
    }, 100)).rejects.toThrow('metadata does not match')
  })
})
