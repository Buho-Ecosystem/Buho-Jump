/**
 * Tests for lib/storage.js — verified write pattern.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import { verifiedSet, verifiedGet } from '../lib/storage.js'

beforeEach(() => {
  resetStorage()
})

describe('verifiedSet', () => {
  it('writes and verifies a value', async () => {
    await verifiedSet('testKey', { hello: 'world' })
    const raw = getStore()
    expect(raw.testKey).toEqual({ hello: 'world' })
  })

  it('overwrites existing values', async () => {
    await verifiedSet('key', 'first')
    await verifiedSet('key', 'second')
    expect(getStore().key).toBe('second')
  })
})

describe('verifiedGet', () => {
  it('reads a stored value', async () => {
    await verifiedSet('key', 42)
    const val = await verifiedGet('key')
    expect(val).toBe(42)
  })

  it('returns undefined for missing keys', async () => {
    const val = await verifiedGet('nonexistent')
    expect(val).toBeUndefined()
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('verifiedSet — falsy values', () => {
  it('stores false', async () => {
    await verifiedSet('flag', false)
    expect(await verifiedGet('flag')).toBe(false)
  })

  it('stores zero', async () => {
    await verifiedSet('count', 0)
    expect(await verifiedGet('count')).toBe(0)
  })

  it('stores empty string', async () => {
    await verifiedSet('name', '')
    expect(await verifiedGet('name')).toBe('')
  })

  it('stores null', async () => {
    await verifiedSet('data', null)
    expect(await verifiedGet('data')).toBeNull()
  })

  it('stores empty array', async () => {
    await verifiedSet('list', [])
    expect(await verifiedGet('list')).toEqual([])
  })

  it('stores empty object', async () => {
    await verifiedSet('map', {})
    expect(await verifiedGet('map')).toEqual({})
  })
})

describe('verifiedSet — large and complex values', () => {
  it('stores large object (1000 keys)', async () => {
    const large = {}
    for (let i = 0; i < 1000; i++) large[`key_${i}`] = `value_${i}`
    await verifiedSet('large', large)
    const result = await verifiedGet('large')
    expect(Object.keys(result)).toHaveLength(1000)
  })

  it('stores nested arrays', async () => {
    const nested = [[1, [2, [3, [4]]]], [5]]
    await verifiedSet('nested', nested)
    expect(await verifiedGet('nested')).toEqual(nested)
  })
})

describe('verifiedSet — retry on failure', () => {
  it('throws after two failed attempts', async () => {
    // Override storage.get to return undefined for specific key
    const originalGet = chrome.storage.local.get
    chrome.storage.local.get = vi.fn(async (keys) => {
      if (typeof keys === 'string' && keys === 'failKey') return {}
      return originalGet(keys)
    })

    await expect(verifiedSet('failKey', 'data')).rejects.toThrow('Storage write failed')

    chrome.storage.local.get = originalGet
  })
})
