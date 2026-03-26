/**
 * Tests for lib/relayPool.js — singleton pool, auth handler, relay status.
 *
 * Uses vi.resetModules() to get fresh singletons per test group since
 * the pool and authedRelays are module-level state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('nostr-core', () => {
  class MockRelayPool {
    constructor() {
      this.ensureRelay = vi.fn(async (url) => ({ url, onauth: null }))
      this.listConnectionStatus = vi.fn(() => new Map([['wss://test.relay', true]]))
    }
  }
  return { RelayPool: MockRelayPool }
})

describe('relayPool', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getPool returns a singleton', async () => {
    const { getPool } = await import('../lib/relayPool.js')
    const pool1 = getPool()
    const pool2 = getPool()
    expect(pool1).toBe(pool2)
  })

  it('getRelayStatus returns empty Map when no pool exists', async () => {
    const { getRelayStatus } = await import('../lib/relayPool.js')
    const status = getRelayStatus()
    expect(status).toBeInstanceOf(Map)
    expect(status.size).toBe(0)
  })

  it('getRelayStatus delegates to pool.listConnectionStatus after pool init', async () => {
    const { getPool, getRelayStatus } = await import('../lib/relayPool.js')
    getPool() // initialize pool
    const status = getRelayStatus()
    expect(status).toBeInstanceOf(Map)
    expect(status.get('wss://test.relay')).toBe(true)
  })

  it('resetAuthedRelays clears the authed set', async () => {
    const { getPool, resetAuthedRelays } = await import('../lib/relayPool.js')
    const pool = getPool()
    // First ensureRelay adds to authedRelays
    await pool.ensureRelay('wss://r1.test')
    // Reset should not throw
    resetAuthedRelays()
    // Second ensureRelay for same URL should re-attach auth (no-op check)
    const relay = await pool.ensureRelay('wss://r1.test')
    expect(relay.url).toBe('wss://r1.test')
  })

  it('resetAuthedRelays is safe when no pool exists', async () => {
    const { resetAuthedRelays } = await import('../lib/relayPool.js')
    expect(() => resetAuthedRelays()).not.toThrow()
  })

  it('setAuthHandler / getAuthHandler stores handler', async () => {
    const { setAuthHandler, getAuthHandler } = await import('../lib/relayPool.js')
    const handler = vi.fn()
    setAuthHandler(handler)
    expect(getAuthHandler()).toBe(handler)
  })

  it('DEFAULT_RELAYS is an array of wss:// URLs', async () => {
    const { DEFAULT_RELAYS } = await import('../lib/relayPool.js')
    expect(Array.isArray(DEFAULT_RELAYS)).toBe(true)
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(0)
    for (const url of DEFAULT_RELAYS) {
      expect(url).toMatch(/^wss:\/\//)
    }
  })
})
