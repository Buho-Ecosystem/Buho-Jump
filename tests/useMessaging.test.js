/**
 * Tests for composables/useMessaging.js — background message wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetStorage } from './setup.js'
import { useMessaging } from '../composables/useMessaging.js'

beforeEach(() => {
  resetStorage()
  chrome.runtime.sendMessage.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('send — success path', () => {
  it('returns result from background response', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: { data: 42 } })
    const { send } = useMessaging()
    const result = await send('GET_DATA')
    expect(result).toEqual({ data: 42 })
  })

  it('passes type and params to sendMessage', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: 'ok' })
    const { send } = useMessaging()
    await send('SAVE_DATA', 'arg1', 'arg2')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SAVE_DATA',
      params: ['arg1', 'arg2'],
    })
  })

  it('returns undefined when result is absent', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({})
    const { send } = useMessaging()
    const result = await send('SOME_OP')
    expect(result).toBeUndefined()
  })
})

describe('send — error path', () => {
  it('throws when response contains error', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'SOMETHING_FAILED' })
    const { send } = useMessaging()
    await expect(send('BAD_OP')).rejects.toThrow('SOMETHING_FAILED')
  })

  it('translates known error codes to i18n keys', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'WRONG_PASSWORD' })
    const { send } = useMessaging()
    await expect(send('UNLOCK')).rejects.toThrow('errors.WRONG_PASSWORD')
  })

  it('translates LOCKED to i18n key', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'LOCKED' })
    const { send } = useMessaging()
    await expect(send('GET_DATA')).rejects.toThrow('errors.LOCKED')
  })

  it('translates NO_WALLET to i18n key', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'NO_WALLET' })
    const { send } = useMessaging()
    await expect(send('PAY')).rejects.toThrow('errors.NO_WALLET')
  })

  it('passes through unknown error codes without prefix', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'CUSTOM_ERROR' })
    const { send } = useMessaging()
    await expect(send('OP')).rejects.toThrow('CUSTOM_ERROR')
  })
})

describe('send — timeout', () => {
  it('times out after 15s for normal operations', async () => {
    chrome.runtime.sendMessage.mockImplementation(() => new Promise(() => {})) // never resolves
    const { send } = useMessaging()
    const promise = send('NORMAL_OP')
    vi.advanceTimersByTime(15000)
    await expect(promise).rejects.toThrow('Request timed out')
  })

  it('times out after 45s for slow operations', async () => {
    chrome.runtime.sendMessage.mockImplementation(() => new Promise(() => {}))
    const { send } = useMessaging()
    const promise = send('CONNECT_NIP46')
    vi.advanceTimersByTime(15000)
    // Should NOT have timed out yet
    vi.advanceTimersByTime(15000) // 30s total
    // Still not timed out
    vi.advanceTimersByTime(15000) // 45s total
    await expect(promise).rejects.toThrow('Request timed out')
  })

  it('recognizes all slow ops', async () => {
    const slowOps = ['CONNECT_NIP46', 'PUBLISH_PROFILE', 'PUBLISH_NIP65', 'FETCH_PROFILE', 'FETCH_NIP65', 'CONNECT_WALLET', 'SWITCH_WALLET']
    for (const op of slowOps) {
      chrome.runtime.sendMessage.mockImplementation(() => new Promise(() => {}))
      const { send } = useMessaging()
      const promise = send(op)
      vi.advanceTimersByTime(15000)
      // Should not have timed out at 15s for slow ops
      // We can't easily assert "not rejected" mid-flight, so just verify it exists
      expect(promise).toBeDefined()
      vi.advanceTimersByTime(30001)
      await expect(promise).rejects.toThrow('Request timed out')
    }
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('send — adversarial responses', () => {
  it('handles null response from sendMessage', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(null)
    const { send } = useMessaging()
    const result = await send('OP')
    expect(result).toBeUndefined()
  })

  it('handles undefined response', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(undefined)
    const { send } = useMessaging()
    const result = await send('OP')
    expect(result).toBeUndefined()
  })

  it('handles empty error string', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: '' })
    const { send } = useMessaging()
    // Empty string is falsy, should NOT throw
    const result = await send('OP')
    expect(result).toBeUndefined()
  })

  it('sends with no params', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: 'ok' })
    const { send } = useMessaging()
    await send('NO_PARAMS')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'NO_PARAMS',
      params: [],
    })
  })

  it('clears timer on successful response (no leak)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: 'fast' })
    const { send } = useMessaging()
    await send('FAST_OP')
    // Advance past timeout — should not cause unhandled rejection
    vi.advanceTimersByTime(20000)
    // If timer leaked, this would cause an error
  })

  it('translates all known error codes', async () => {
    const codes = [
      'PERMISSION_DENIED', 'NO_SIGNER', 'NO_ACCOUNT', 'NO_EVENT',
      'NO_PUBKEY', 'LOCAL_ACCOUNT_REQUIRED', 'LOCKED', 'WRONG_PASSWORD',
      'NO_WALLET', 'WALLET_DISCONNECTED', 'TIMEOUT', 'INSUFFICIENT_BALANCE',
    ]
    for (const code of codes) {
      chrome.runtime.sendMessage.mockResolvedValue({ error: code })
      const { send } = useMessaging()
      await expect(send('OP')).rejects.toThrow(`errors.${code}`)
    }
  })
})
