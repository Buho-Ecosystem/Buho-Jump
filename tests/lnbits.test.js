import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally before import
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const { lnbitsConnect, lnbitsGetBalance, lnbitsMakeInvoice, lnbitsPayInvoice, lnbitsListPayments, createLnbitsWs } = await import('../lib/lnbits.js')

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

function errorResponse(status, detail) {
  return { ok: false, status, json: async () => ({ detail }) }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('lnbits REST client', () => {
  const API = 'https://lnbits.example.com'
  const KEY = 'test-admin-key'

  describe('lnbitsConnect', () => {
    it('fetches wallet info and normalises balance from msats to sats', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        id: 'w123', name: 'My Wallet', balance: 50000,
      }))
      const result = await lnbitsConnect(API, KEY)
      expect(result).toEqual({ id: 'w123', name: 'My Wallet', balance: 50 })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://lnbits.example.com/api/v1/wallet',
        expect.objectContaining({
          method: 'GET',
          headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json' },
        })
      )
    })

    it('throws on HTTP error with detail message', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Invalid API key'))
      await expect(lnbitsConnect(API, KEY)).rejects.toThrow('Invalid API key')
    })

    it('strips trailing slash from URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'w1', name: 'W', balance: 0 }))
      await lnbitsConnect('https://lnbits.example.com/', KEY)
      expect(mockFetch.mock.calls[0][0]).toBe('https://lnbits.example.com/api/v1/wallet')
    })
  })

  describe('lnbitsGetBalance', () => {
    it('returns balance in sats', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ balance: 21000 }))
      expect(await lnbitsGetBalance(API, KEY)).toBe(21)
    })

    it('handles zero balance', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ balance: 0 }))
      expect(await lnbitsGetBalance(API, KEY)).toBe(0)
    })

    it('handles null balance', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}))
      expect(await lnbitsGetBalance(API, KEY)).toBe(0)
    })
  })

  describe('lnbitsMakeInvoice', () => {
    it('creates invoice with correct params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        payment_request: 'lnbc100...', payment_hash: 'abc123', checking_id: 'chk1',
      }))
      const result = await lnbitsMakeInvoice(API, KEY, 100, 'test memo')
      expect(result).toEqual({
        invoice: 'lnbc100...', payment_hash: 'abc123', checking_id: 'chk1',
      })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body).toEqual({ out: false, amount: 100, memo: 'test memo' })
    })

    it('uses empty memo when none provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        payment_request: 'lnbc...', payment_hash: 'h1', checking_id: 'c1',
      }))
      await lnbitsMakeInvoice(API, KEY, 50)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.memo).toBe('')
    })
  })

  describe('lnbitsPayInvoice', () => {
    it('pays invoice with correct params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        payment_hash: 'paid123', preimage: 'pre456',
      }))
      const result = await lnbitsPayInvoice(API, KEY, 'lnbc100...')
      expect(result).toEqual({ payment_hash: 'paid123', preimage: 'pre456' })
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body).toEqual({ out: true, bolt11: 'lnbc100...' })
    })

    it('falls back to payment_hash when preimage missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ payment_hash: 'h1' }))
      const result = await lnbitsPayInvoice(API, KEY, 'lnbc...')
      expect(result.preimage).toBe('h1')
    })
  })

  describe('lnbitsListPayments', () => {
    it('passes limit and offset as query params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]))
      await lnbitsListPayments(API, KEY, { limit: 20, offset: 40 })
      expect(mockFetch.mock.calls[0][0]).toContain('limit=20')
      expect(mockFetch.mock.calls[0][0]).toContain('offset=40')
    })

    it('omits query params when not provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]))
      await lnbitsListPayments(API, KEY)
      expect(mockFetch.mock.calls[0][0]).toBe('https://lnbits.example.com/api/v1/payments')
    })
  })
})

describe('createLnbitsWs', () => {
  let capturedWs

  beforeEach(() => {
    // WebSocket mock that captures the instance for handler access
    capturedWs = null
    globalThis.WebSocket = vi.fn(function (url) {
      this.url = url
      this.close = vi.fn()
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      capturedWs = this
    })
  })

  it('returns an object with close method', () => {
    const handle = createLnbitsWs(
      { apiUrl: 'https://lnbits.example.com', lnbitsWalletId: 'w1' },
      vi.fn()
    )
    expect(typeof handle.close).toBe('function')
    handle.close()
    expect(capturedWs.close).toHaveBeenCalled()
  })

  it('constructs correct WebSocket URL', () => {
    createLnbitsWs(
      { apiUrl: 'https://my.lnbits.com', lnbitsWalletId: 'wallet123' },
      vi.fn()
    )
    expect(globalThis.WebSocket).toHaveBeenCalledWith('wss://my.lnbits.com/api/v1/ws/wallet123')
  })

  it('uses ws:// for http:// URLs', () => {
    createLnbitsWs(
      { apiUrl: 'http://localhost:5000', lnbitsWalletId: 'w1' },
      vi.fn()
    )
    expect(globalThis.WebSocket).toHaveBeenCalledWith('ws://localhost:5000/api/v1/ws/w1')
  })

  it('calls onPayment for incoming payment messages', () => {
    const onPayment = vi.fn()
    createLnbitsWs(
      { apiUrl: 'https://x.com', lnbitsWalletId: 'w1' },
      onPayment
    )

    capturedWs.onmessage({ data: JSON.stringify({
      payment: { amount: 21000, payment_hash: 'hash123' },
    }) })

    expect(onPayment).toHaveBeenCalledWith(21, 'hash123')
  })

  it('ignores outgoing payment messages (negative amount)', () => {
    const onPayment = vi.fn()
    createLnbitsWs(
      { apiUrl: 'https://x.com', lnbitsWalletId: 'w1' },
      onPayment
    )

    capturedWs.onmessage({ data: JSON.stringify({
      payment: { amount: -5000, payment_hash: 'h1' },
    }) })

    expect(onPayment).not.toHaveBeenCalled()
  })

  it('ignores malformed messages', () => {
    const onPayment = vi.fn()
    createLnbitsWs(
      { apiUrl: 'https://x.com', lnbitsWalletId: 'w1' },
      onPayment
    )

    capturedWs.onmessage({ data: 'not json' })
    capturedWs.onmessage({ data: JSON.stringify({ foo: 'bar' }) })
    expect(onPayment).not.toHaveBeenCalled()
  })
})
