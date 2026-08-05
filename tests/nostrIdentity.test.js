import { describe, expect, it, vi } from 'vitest'
import {
  deriveNip06Identity,
  deriveNip06PublicCandidates,
  discoverNip06Identities,
  normalizeMnemonic,
} from '../lib/nostrIdentity.js'

const VECTOR = 'leader monkey parrot ring guide accident before fence cannon height naive bean'

describe('NIP-06 identity derivation', () => {
  it('matches the official account-zero test vector', () => {
    const identity = deriveNip06Identity(VECTOR)
    expect(identity.path).toBe("m/44'/1237'/0'/0/0")
    expect(identity.pubkey).toBe('17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917')
    expect(identity.npub).toBe('npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu')
  })

  it('normalizes whitespace and derives a different identity per account', () => {
    expect(normalizeMnemonic(`  ${VECTOR.toUpperCase()}  `)).toBe(VECTOR)
    const first = deriveNip06Identity(VECTOR, 0)
    const second = deriveNip06Identity(VECTOR, 1)
    expect(second.path).toBe("m/44'/1237'/1'/0/0")
    expect(second.pubkey).not.toBe(first.pubkey)
  })

  it('rejects invalid phrases and invalid account indices', () => {
    expect(() => deriveNip06Identity('not a recovery phrase')).toThrow('Invalid recovery words')
    expect(() => deriveNip06Identity(VECTOR, -1)).toThrow(RangeError)
    expect(() => deriveNip06Identity(VECTOR, 2 ** 31)).toThrow(RangeError)
    expect(() => deriveNip06Identity(VECTOR, 1.5)).toThrow(RangeError)
  })

  it('returns public-only recovery previews', () => {
    const candidates = deriveNip06PublicCandidates(VECTOR, 3)
    expect(candidates).toHaveLength(3)
    expect(candidates.map((candidate) => candidate.accountIndex)).toEqual([0, 1, 2])
    expect(candidates.every((candidate) => !('secretKey' in candidate))).toBe(true)
  })
})

describe('NIP-06 recovery discovery', () => {
  it('marks each active path independently and attaches its newest profile', async () => {
    const previews = deriveNip06PublicCandidates(VECTOR, 3)
    const eventsByPubkey = new Map([
      [previews[0].pubkey, [{ pubkey: previews[0].pubkey, kind: 1, created_at: 10, content: 'hello' }]],
      [previews[2].pubkey, [{ pubkey: previews[2].pubkey, kind: 0, created_at: 20, content: '{"name":"Owl","about":"hi"}' }]],
    ])
    const querySync = vi.fn(async (_relays, filter) => {
      if (filter.kinds?.includes(0)) {
        return [{ pubkey: previews[2].pubkey, kind: 0, created_at: 21, content: '{"display_name":"Night Owl"}' }]
      }
      return eventsByPubkey.get(filter.authors[0]) || []
    })

    const result = await discoverNip06Identities(VECTOR, {
      count: 3,
      relays: ['wss://relay.test'],
      pool: { querySync },
      maxWait: 5,
    })

    expect(result.networkChecked).toBe(true)
    expect(result.usedCount).toBe(2)
    expect(result.candidates.map((candidate) => candidate.used)).toEqual([true, false, true])
    expect(result.candidates[2].profile.display_name).toBe('Night Owl')
    expect(querySync).toHaveBeenCalledTimes(4)
  })

  it('returns all public candidates when relays are unavailable', async () => {
    const querySync = vi.fn(async () => { throw new Error('offline') })
    const result = await discoverNip06Identities(VECTOR, {
      count: 2,
      relays: ['wss://relay.test'],
      pool: { querySync },
      maxWait: 5,
    })

    expect(result.networkChecked).toBe(false)
    expect(result.usedCount).toBe(0)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every((candidate) => !('secretKey' in candidate))).toBe(true)
  })

  it('does not treat empty results from disconnected relays as a completed scan', async () => {
    const pool = {
      querySync: vi.fn(async () => []),
      listConnectionStatus: vi.fn(() => new Map([['wss://relay.test', false]])),
    }
    const result = await discoverNip06Identities(VECTOR, {
      count: 2,
      relays: ['wss://relay.test'],
      pool,
      maxWait: 5,
    })

    expect(result.networkChecked).toBe(false)
    expect(result.usedCount).toBe(0)
  })
})
