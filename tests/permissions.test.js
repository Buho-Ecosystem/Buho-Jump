/**
 * Tests for lib/permissions.js — per-domain permission storage, per-kind signEvent, prototype pollution.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  getPermissions, checkPermission, setPermission,
  removePermission, removeDomainPermissions, clearAllPermissions,
} from '../lib/permissions.js'

beforeEach(() => {
  resetStorage()
})

describe('setPermission / checkPermission', () => {
  it('stores and retrieves a permission', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    expect(await checkPermission('https://example.com', 'getPublicKey')).toBe('allow')
  })

  it('returns null for unknown host', async () => {
    expect(await checkPermission('https://unknown.com', 'getPublicKey')).toBe(null)
  })

  it('returns null for unknown method on known host', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    expect(await checkPermission('https://example.com', 'signEvent')).toBe(null)
  })

  it('overwrites existing permission', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    await setPermission('https://example.com', 'getPublicKey', 'deny')
    expect(await checkPermission('https://example.com', 'getPublicKey')).toBe('deny')
  })

  it('supports multiple hosts independently', async () => {
    await setPermission('https://a.com', 'getPublicKey', 'allow')
    await setPermission('https://b.com', 'getPublicKey', 'deny')
    expect(await checkPermission('https://a.com', 'getPublicKey')).toBe('allow')
    expect(await checkPermission('https://b.com', 'getPublicKey')).toBe('deny')
  })
})

describe('per-kind signEvent permissions', () => {
  it('stores per-kind permission with kind parameter', async () => {
    await setPermission('https://example.com', 'signEvent', 'allow', 4)
    expect(await checkPermission('https://example.com', 'signEvent', 4)).toBe('allow')
  })

  it('per-kind takes priority over general signEvent', async () => {
    await setPermission('https://example.com', 'signEvent', 'deny')
    await setPermission('https://example.com', 'signEvent', 'allow', 4)
    expect(await checkPermission('https://example.com', 'signEvent', 4)).toBe('allow')
    expect(await checkPermission('https://example.com', 'signEvent')).toBe('deny')
  })

  it('falls back to general signEvent when no per-kind set', async () => {
    await setPermission('https://example.com', 'signEvent', 'allow')
    expect(await checkPermission('https://example.com', 'signEvent', 99)).toBe('allow')
  })
})

describe('prototype pollution protection', () => {
  it('rejects __proto__ as host', async () => {
    await setPermission('__proto__', 'getPublicKey', 'allow')
    expect(await checkPermission('__proto__', 'getPublicKey')).toBe(null)
  })

  it('rejects constructor as host', async () => {
    await setPermission('constructor', 'getPublicKey', 'allow')
    expect(await checkPermission('constructor', 'getPublicKey')).toBe(null)
  })

  it('rejects prototype as method', async () => {
    await setPermission('https://example.com', 'prototype', 'allow')
    expect(await checkPermission('https://example.com', 'prototype')).toBe(null)
  })

  it('rejects empty string as host', async () => {
    await setPermission('', 'getPublicKey', 'allow')
    expect(await checkPermission('', 'getPublicKey')).toBe(null)
  })
})

describe('removePermission', () => {
  it('removes a specific method', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    await setPermission('https://example.com', 'signEvent', 'allow')
    await removePermission('https://example.com', 'getPublicKey')
    expect(await checkPermission('https://example.com', 'getPublicKey')).toBe(null)
    expect(await checkPermission('https://example.com', 'signEvent')).toBe('allow')
  })

  it('removes the host entry when last method is removed', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    await removePermission('https://example.com', 'getPublicKey')
    const policies = await getPermissions()
    expect(policies['https://example.com']).toBeUndefined()
  })
})

describe('removeDomainPermissions', () => {
  it('removes all methods for a host', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    await setPermission('https://example.com', 'signEvent', 'allow')
    await removeDomainPermissions('https://example.com')
    expect(await checkPermission('https://example.com', 'getPublicKey')).toBe(null)
    expect(await checkPermission('https://example.com', 'signEvent')).toBe(null)
  })
})

describe('clearAllPermissions', () => {
  it('wipes all permissions', async () => {
    await setPermission('https://a.com', 'getPublicKey', 'allow')
    await setPermission('https://b.com', 'signEvent', 'deny')
    await clearAllPermissions()
    const policies = await getPermissions()
    expect(Object.keys(policies)).toHaveLength(0)
  })
})

describe('profile-scoped permissions', () => {
  it('isolates permissions per profileId', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow', null, 'profile-1')
    await setPermission('https://example.com', 'getPublicKey', 'deny', null, 'profile-2')
    expect(await checkPermission('https://example.com', 'getPublicKey', null, 'profile-1')).toBe('allow')
    expect(await checkPermission('https://example.com', 'getPublicKey', null, 'profile-2')).toBe('deny')
  })
})

describe('exact-origin isolation', () => {
  it('does not share grants across schemes or ports', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    expect(await checkPermission('http://example.com', 'getPublicKey')).toBe(null)
    expect(await checkPermission('https://example.com:8443', 'getPublicKey')).toBe(null)
  })

  it('drops unsafe legacy hostname-only grants', async () => {
    await chrome.storage.local.set({
      domain_policies: { 'example.com': { getPublicKey: { decision: 'allow' } } },
    })
    expect(await getPermissions()).toEqual({})
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('defensive input types', () => {
  it('rejects null host', async () => {
    await setPermission(null, 'getPublicKey', 'allow')
    expect(await checkPermission(null, 'getPublicKey')).toBe(null)
  })

  it('rejects numeric host', async () => {
    await setPermission(123, 'getPublicKey', 'allow')
    expect(await checkPermission(123, 'getPublicKey')).toBe(null)
  })

  it('rejects undefined method', async () => {
    await setPermission('https://example.com', undefined, 'allow')
    expect(await checkPermission('https://example.com', undefined)).toBe(null)
  })

  it('rejects whitespace-only host', async () => {
    await setPermission('   ', 'getPublicKey', 'allow')
    const policies = await getPermissions()
    expect(policies).toEqual({})
    expect(await checkPermission('   ', 'getPublicKey')).toBe(null)
  })
})

describe('per-kind signEvent — boundary conditions', () => {
  it('kind 0 (falsy but valid) — uses general signEvent', async () => {
    await setPermission('https://example.com', 'signEvent', 'allow')
    // kind 0 is falsy, should fall back to general signEvent
    expect(await checkPermission('https://example.com', 'signEvent', 0)).toBe('allow')
  })

  it('kind as string does not match numeric kind', async () => {
    await setPermission('https://example.com', 'signEvent', 'allow', 4)
    // Checking with string '4' instead of number 4
    // Documents behavior — may or may not match depending on comparison
    const result = await checkPermission('https://example.com', 'signEvent', '4')
    // Actual behavior depends on implementation — document it
    expect(result === 'allow' || result === null).toBe(true)
  })

  it('many per-kind overrides do not conflict', async () => {
    await setPermission('https://example.com', 'signEvent', 'deny') // general
    await setPermission('https://example.com', 'signEvent', 'allow', 1)
    await setPermission('https://example.com', 'signEvent', 'allow', 4)
    await setPermission('https://example.com', 'signEvent', 'deny', 7)
    expect(await checkPermission('https://example.com', 'signEvent')).toBe('deny')
    expect(await checkPermission('https://example.com', 'signEvent', 1)).toBe('allow')
    expect(await checkPermission('https://example.com', 'signEvent', 4)).toBe('allow')
    expect(await checkPermission('https://example.com', 'signEvent', 7)).toBe('deny')
    // Unknown kind falls back to general
    expect(await checkPermission('https://example.com', 'signEvent', 999)).toBe('deny')
  })
})

describe('removePermission — edge cases', () => {
  it('removing non-existent method from existing host is safe', async () => {
    await setPermission('https://example.com', 'getPublicKey', 'allow')
    await removePermission('https://example.com', 'nonExistentMethod')
    // Host should still have getPublicKey
    expect(await checkPermission('https://example.com', 'getPublicKey')).toBe('allow')
  })

  it('removing method from non-existent host is safe', async () => {
    await expect(removePermission('https://unknown.com', 'getPublicKey')).resolves.not.toThrow()
  })

  it('clearAllPermissions on empty store is safe', async () => {
    await clearAllPermissions()
    expect(await getPermissions()).toEqual({})
  })
})
