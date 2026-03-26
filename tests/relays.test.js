/**
 * Tests for lib/relays.js — relay config, pool management, URL validation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  getRelayConfig, getPoolRelays, setPoolRelays,
  addRelay, removeRelay, resetPoolToDefaults,
  validateRelayUrl,
  DEFAULT_ACCOUNT_RELAYS, DEFAULT_WALLET_RELAYS, DEFAULT_CHAT_RELAYS,
} from '../lib/relays.js'

const PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  resetStorage()
})

describe('getRelayConfig', () => {
  it('returns defaults when no config exists', async () => {
    const config = await getRelayConfig(PUBKEY)
    expect(config.account).toEqual(DEFAULT_ACCOUNT_RELAYS)
    expect(config.wallet).toEqual(DEFAULT_WALLET_RELAYS)
    expect(config.chat).toEqual(DEFAULT_CHAT_RELAYS)
  })
})

describe('setPoolRelays / getPoolRelays', () => {
  it('sets and retrieves relays for a pool', async () => {
    const relays = ['wss://relay1.test', 'wss://relay2.test']
    await setPoolRelays(PUBKEY, 'account', relays)
    const result = await getPoolRelays(PUBKEY, 'account')
    expect(result).toEqual(relays)
  })

  it('does not affect other pools', async () => {
    await setPoolRelays(PUBKEY, 'account', ['wss://custom.test'])
    const wallet = await getPoolRelays(PUBKEY, 'wallet')
    expect(wallet).toEqual(DEFAULT_WALLET_RELAYS)
  })
})

describe('addRelay', () => {
  it('adds a relay to a pool', async () => {
    await addRelay(PUBKEY, 'chat', 'wss://new-relay.test')
    const relays = await getPoolRelays(PUBKEY, 'chat')
    expect(relays).toContain('wss://new-relay.test')
  })

  it('throws on duplicate relay', async () => {
    const existing = DEFAULT_ACCOUNT_RELAYS[0]
    await expect(addRelay(PUBKEY, 'account', existing)).rejects.toThrow('Duplicate relay')
  })
})

describe('removeRelay', () => {
  it('removes a relay from a pool', async () => {
    const target = DEFAULT_ACCOUNT_RELAYS[0]
    await removeRelay(PUBKEY, 'account', target)
    const relays = await getPoolRelays(PUBKEY, 'account')
    expect(relays).not.toContain(target)
  })
})

describe('resetPoolToDefaults', () => {
  it('resets a pool to defaults', async () => {
    await setPoolRelays(PUBKEY, 'account', ['wss://custom.test'])
    await resetPoolToDefaults(PUBKEY, 'account')
    const relays = await getPoolRelays(PUBKEY, 'account')
    expect(relays).toEqual(DEFAULT_ACCOUNT_RELAYS)
  })
})

describe('validateRelayUrl', () => {
  it('accepts valid wss:// URLs', () => {
    expect(validateRelayUrl('wss://relay.test')).toBe('wss://relay.test')
  })

  it('auto-prefixes bare domains', () => {
    const result = validateRelayUrl('relay.test')
    expect(result).toBe('wss://relay.test')
  })

  it('rejects ws:// URLs', () => {
    expect(validateRelayUrl('ws://insecure.test')).toBeNull()
  })

  it('rejects empty strings', () => {
    expect(validateRelayUrl('')).toBeNull()
  })

  it('auto-prefixes http URLs with wss://', () => {
    // http:// doesn't start with ws:// or wss://, so gets prefixed
    const result = validateRelayUrl('http://not-a-relay.test')
    expect(result).toContain('wss://')
  })

  it('accepts URLs with port', () => {
    expect(validateRelayUrl('wss://relay.test:9001')).toBe('wss://relay.test:9001')
  })

  it('accepts URLs with path', () => {
    expect(validateRelayUrl('wss://relay.test/nostr')).toBe('wss://relay.test/nostr')
  })

  it('rejects null', () => {
    expect(validateRelayUrl(null)).toBeNull()
  })

  it('rejects undefined', () => {
    expect(validateRelayUrl(undefined)).toBeNull()
  })

  it('rejects whitespace-only', () => {
    expect(validateRelayUrl('   ')).toBeNull()
  })

  it('handles localhost', () => {
    const result = validateRelayUrl('wss://localhost')
    expect(result).toBe('wss://localhost')
  })

  it('handles IP address', () => {
    const result = validateRelayUrl('wss://192.168.1.1')
    expect(result).toBe('wss://192.168.1.1')
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('addRelay — edge cases', () => {
  it('rejects empty string URL', async () => {
    await expect(addRelay(PUBKEY, 'account', '')).rejects.toThrow()
  })
})

describe('removeRelay — edge cases', () => {
  it('removing non-existent relay does not throw', async () => {
    await removeRelay(PUBKEY, 'account', 'wss://nonexistent.test')
    const relays = await getPoolRelays(PUBKEY, 'account')
    // Should still have defaults minus nothing
    expect(relays).toEqual(DEFAULT_ACCOUNT_RELAYS)
  })
})
