import { describe, it, expect, vi } from 'vitest'
import { validateVerifyUrl, normalizeVerifyResponse, pollVerify } from '../lib/lnurlVerify.js'

describe('LUD-21 verification', () => {
  it('pins verification to HTTPS on the callback host', () => {
    expect(validateVerifyUrl('https://pay.example/verify/1', 'https://pay.example/cb')).toBe('https://pay.example/verify/1')
    expect(validateVerifyUrl('https://evil.example/verify/1', 'https://pay.example/cb')).toBeNull()
    expect(validateVerifyUrl('http://pay.example/verify/1', 'https://pay.example/cb')).toBeNull()
  })

  it('normalizes mobile-money delivery extensions', () => {
    expect(normalizeVerifyResponse({ settled: true, mpesa: { delivered: true, receipt: 'ABC', recipient: 'Ada', amount: 50 } }))
      .toEqual({ hasPayout: true, settled: true, delivered: true, receipt: 'ABC', recipient: 'Ada', amount: 50, completedAt: null })
  })

  it('keeps polling a settled payout until delivery', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ settled: true, payout: { delivered: false } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ settled: true, payout: { delivered: true, receipt: 'done' } }) })
    const updates = []
    const result = await pollVerify('https://pay.example/verify', value => updates.push(value), {
      fetchImpl, intervalMs: 0, maxIntervalMs: 0,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.delivered).toBe(true)
    expect(updates).toHaveLength(2)
  })

  it('stops after an ordinary Lightning payment settles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ settled: true }) })
    const result = await pollVerify('https://pay.example/verify', null, { fetchImpl, intervalMs: 0 })
    expect(result).toMatchObject({ settled: true, hasPayout: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps polling an expected payout before its delivery object appears', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ settled: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ settled: true, payout: { delivered: true } }) })
    const result = await pollVerify('https://pay.example/verify', null, {
      fetchImpl, intervalMs: 0, maxIntervalMs: 0, expectPayout: true,
    })
    expect(result.delivered).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
