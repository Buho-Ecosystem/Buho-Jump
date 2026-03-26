/**
 * Tests for lib/blocklist.js — add, remove, dedup, isBlocked.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  getBlocklist, isBlocked, addToBlocklist, removeFromBlocklist,
} from '../lib/blocklist.js'

beforeEach(() => {
  resetStorage()
})

describe('getBlocklist', () => {
  it('returns empty array initially', async () => {
    expect(await getBlocklist()).toEqual([])
  })
})

describe('addToBlocklist / isBlocked', () => {
  it('adds a host and reports it blocked', async () => {
    await addToBlocklist('malicious.com')
    expect(await isBlocked('malicious.com')).toBe(true)
  })

  it('non-blocked host returns false', async () => {
    await addToBlocklist('malicious.com')
    expect(await isBlocked('safe.com')).toBe(false)
  })

  it('deduplicates — adding same host twice yields one entry', async () => {
    await addToBlocklist('malicious.com')
    await addToBlocklist('malicious.com')
    const list = await getBlocklist()
    expect(list.filter(h => h === 'malicious.com')).toHaveLength(1)
  })

  it('ignores falsy host', async () => {
    await addToBlocklist('')
    await addToBlocklist(null)
    await addToBlocklist(undefined)
    expect(await getBlocklist()).toEqual([])
  })

  it('supports multiple hosts', async () => {
    await addToBlocklist('a.com')
    await addToBlocklist('b.com')
    await addToBlocklist('c.com')
    expect(await isBlocked('a.com')).toBe(true)
    expect(await isBlocked('b.com')).toBe(true)
    expect(await isBlocked('c.com')).toBe(true)
    expect(await getBlocklist()).toHaveLength(3)
  })
})

describe('removeFromBlocklist', () => {
  it('removes a blocked host', async () => {
    await addToBlocklist('malicious.com')
    await removeFromBlocklist('malicious.com')
    expect(await isBlocked('malicious.com')).toBe(false)
    expect(await getBlocklist()).toEqual([])
  })

  it('does not affect other hosts', async () => {
    await addToBlocklist('a.com')
    await addToBlocklist('b.com')
    await removeFromBlocklist('a.com')
    expect(await isBlocked('a.com')).toBe(false)
    expect(await isBlocked('b.com')).toBe(true)
  })

  it('is a no-op for non-existent host', async () => {
    await addToBlocklist('a.com')
    await removeFromBlocklist('nonexistent.com')
    expect(await getBlocklist()).toEqual(['a.com'])
  })
})

describe('prototype pollution protection', () => {
  it('rejects __proto__ as host', async () => {
    await addToBlocklist('__proto__')
    expect(await getBlocklist()).toEqual([])
  })

  it('rejects constructor as host', async () => {
    await addToBlocklist('constructor')
    expect(await getBlocklist()).toEqual([])
  })

  it('rejects prototype as host', async () => {
    await addToBlocklist('prototype')
    expect(await getBlocklist()).toEqual([])
  })

  it('isBlocked returns false for reserved keys', async () => {
    expect(await isBlocked('__proto__')).toBe(false)
    expect(await isBlocked('constructor')).toBe(false)
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('defensive input types', () => {
  it('addToBlocklist with number is ignored', async () => {
    await addToBlocklist(123)
    expect(await getBlocklist()).toEqual([])
  })

  it('addToBlocklist with boolean is ignored', async () => {
    await addToBlocklist(true)
    expect(await getBlocklist()).toEqual([])
  })

  it('addToBlocklist with object is ignored', async () => {
    await addToBlocklist({ host: 'evil.com' })
    expect(await getBlocklist()).toEqual([])
  })

  it('addToBlocklist with array is ignored', async () => {
    await addToBlocklist(['evil.com'])
    expect(await getBlocklist()).toEqual([])
  })

  it('isBlocked with null returns false', async () => {
    expect(await isBlocked(null)).toBe(false)
  })

  it('isBlocked with number returns false', async () => {
    expect(await isBlocked(42)).toBe(false)
  })

  it('removeFromBlocklist with invalid type is safe', async () => {
    await addToBlocklist('valid.com')
    await removeFromBlocklist(null)
    await removeFromBlocklist(123)
    expect(await getBlocklist()).toEqual(['valid.com'])
  })
})

describe('unicode and special character hosts', () => {
  it('accepts unicode domain', async () => {
    await addToBlocklist('例え.jp')
    expect(await isBlocked('例え.jp')).toBe(true)
  })

  it('accepts host with port', async () => {
    await addToBlocklist('evil.com:8080')
    expect(await isBlocked('evil.com:8080')).toBe(true)
  })

  it('treats hosts case-sensitively', async () => {
    await addToBlocklist('Evil.COM')
    expect(await isBlocked('Evil.COM')).toBe(true)
    expect(await isBlocked('evil.com')).toBe(false)
  })
})
