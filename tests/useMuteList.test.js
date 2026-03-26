/**
 * Tests for composables/useMuteList.js — per-account mute list (local storage).
 *
 * Only tests local storage operations. NIP-51 publish/fetch require relay mocks
 * and are not covered here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'

// Mock Vue lifecycle + nostr-core (relay operations)
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  }
})

vi.mock('../lib/relayPool.js', () => ({
  getPool: vi.fn(() => ({
    publish: vi.fn(async () => []),
    querySync: vi.fn(async () => []),
  })),
}))

vi.mock('../lib/relays.js', () => ({
  getPoolRelays: vi.fn(async () => ['wss://relay.test']),
  DEFAULT_ACCOUNT_RELAYS: ['wss://relay.test'],
}))

import { useMuteList } from '../composables/useMuteList.js'

const ACCOUNT_A = 'a'.repeat(64)
const ACCOUNT_B = 'b'.repeat(64)
const PUBKEY_1 = '1'.repeat(64)
const PUBKEY_2 = '2'.repeat(64)

beforeEach(() => {
  resetStorage()
  const { reset } = useMuteList()
  reset()
})

describe('load', () => {
  it('loads empty list for new account', async () => {
    const { load, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    expect(mutedPubkeys.value).toEqual([])
  })

  it('loads persisted mute list', async () => {
    // Pre-populate storage
    await chrome.storage.local.set({ [`muteList_${ACCOUNT_A}`]: [PUBKEY_1] })
    const { load, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    expect(mutedPubkeys.value).toEqual([PUBKEY_1])
  })

  it('clears list for null pubkey', async () => {
    const { load, mute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    await load(null)
    expect(mutedPubkeys.value).toEqual([])
  })
})

describe('mute / unmute', () => {
  it('adds pubkey to mute list', async () => {
    const { load, mute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    expect(mutedPubkeys.value).toContain(PUBKEY_1)
  })

  it('does not duplicate on double mute', async () => {
    const { load, mute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    await mute(ACCOUNT_A, PUBKEY_1)
    expect(mutedPubkeys.value.filter(p => p === PUBKEY_1)).toHaveLength(1)
  })

  it('removes pubkey on unmute', async () => {
    const { load, mute, unmute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    await unmute(ACCOUNT_A, PUBKEY_1)
    expect(mutedPubkeys.value).not.toContain(PUBKEY_1)
  })

  it('unmute does not affect other pubkeys', async () => {
    const { load, mute, unmute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    await mute(ACCOUNT_A, PUBKEY_2)
    await unmute(ACCOUNT_A, PUBKEY_1)
    expect(mutedPubkeys.value).toContain(PUBKEY_2)
    expect(mutedPubkeys.value).not.toContain(PUBKEY_1)
  })
})

describe('isMuted', () => {
  it('returns true for muted pubkey', async () => {
    const { load, mute, isMuted } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    expect(isMuted(PUBKEY_1)).toBe(true)
  })

  it('returns false for non-muted pubkey', async () => {
    const { load, isMuted } = useMuteList()
    await load(ACCOUNT_A)
    expect(isMuted(PUBKEY_1)).toBe(false)
  })
})

describe('reset', () => {
  it('clears the mute list', async () => {
    const { load, mute, reset, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    reset()
    expect(mutedPubkeys.value).toEqual([])
  })
})

describe('account scoping', () => {
  it('persists mutes per account', async () => {
    const muteList = useMuteList()
    await muteList.load(ACCOUNT_A)
    await muteList.mute(ACCOUNT_A, PUBKEY_1)

    // Switch to account B
    muteList.reset()
    await muteList.load(ACCOUNT_B)
    await muteList.mute(ACCOUNT_B, PUBKEY_2)

    // Verify account A still has its own mutes
    muteList.reset()
    await muteList.load(ACCOUNT_A)
    expect(muteList.mutedPubkeys.value).toContain(PUBKEY_1)
    expect(muteList.mutedPubkeys.value).not.toContain(PUBKEY_2)
  })

  it('skips load if same account already loaded', async () => {
    const { load, mute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, PUBKEY_1)
    // Load same account again — should be a no-op
    await load(ACCOUNT_A)
    expect(mutedPubkeys.value).toContain(PUBKEY_1) // still has the mute
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('mute — adversarial inputs', () => {
  it('mute empty string pubkey', async () => {
    const { load, mute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, '')
    expect(mutedPubkeys.value).toContain('')
  })

  it('unmute pubkey not in list is safe', async () => {
    const { load, unmute, mutedPubkeys } = useMuteList()
    await load(ACCOUNT_A)
    await unmute(ACCOUNT_A, 'not-in-list')
    expect(mutedPubkeys.value).toEqual([])
  })

  it('handles very long pubkey', async () => {
    const longPk = 'f'.repeat(1000)
    const { load, mute, isMuted } = useMuteList()
    await load(ACCOUNT_A)
    await mute(ACCOUNT_A, longPk)
    expect(isMuted(longPk)).toBe(true)
  })
})

describe('load — error resilience', () => {
  it('handles corrupted storage (non-array)', async () => {
    // Pre-populate with invalid data
    await chrome.storage.local.set({ [`muteList_${ACCOUNT_A}`]: 'not-an-array' })
    const muteList = useMuteList()
    muteList.reset() // clear loadedForPubkey
    await muteList.load(ACCOUNT_A)
    // Should have loaded the string (or handled gracefully)
    expect(muteList.mutedPubkeys.value).toBeDefined()
  })

  it('handles empty string accountPubkey', async () => {
    const { load, mutedPubkeys } = useMuteList()
    await load('')
    expect(mutedPubkeys.value).toEqual([])
  })
})

describe('reset — idempotent', () => {
  it('double reset is safe', () => {
    const { reset, mutedPubkeys } = useMuteList()
    reset()
    reset()
    expect(mutedPubkeys.value).toEqual([])
  })
})
