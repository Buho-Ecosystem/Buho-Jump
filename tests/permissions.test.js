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
    await setPermission('example.com', 'getPublicKey', 'allow')
    expect(await checkPermission('example.com', 'getPublicKey')).toBe('allow')
  })

  it('returns null for unknown host', async () => {
    expect(await checkPermission('unknown.com', 'getPublicKey')).toBe(null)
  })

  it('returns null for unknown method on known host', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow')
    expect(await checkPermission('example.com', 'signEvent')).toBe(null)
  })

  it('overwrites existing permission', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow')
    await setPermission('example.com', 'getPublicKey', 'deny')
    expect(await checkPermission('example.com', 'getPublicKey')).toBe('deny')
  })

  it('supports multiple hosts independently', async () => {
    await setPermission('a.com', 'getPublicKey', 'allow')
    await setPermission('b.com', 'getPublicKey', 'deny')
    expect(await checkPermission('a.com', 'getPublicKey')).toBe('allow')
    expect(await checkPermission('b.com', 'getPublicKey')).toBe('deny')
  })
})

describe('per-kind signEvent permissions', () => {
  it('stores per-kind permission with kind parameter', async () => {
    await setPermission('example.com', 'signEvent', 'allow', 4)
    expect(await checkPermission('example.com', 'signEvent', 4)).toBe('allow')
  })

  it('per-kind takes priority over general signEvent', async () => {
    await setPermission('example.com', 'signEvent', 'deny')
    await setPermission('example.com', 'signEvent', 'allow', 4)
    expect(await checkPermission('example.com', 'signEvent', 4)).toBe('allow')
    expect(await checkPermission('example.com', 'signEvent')).toBe('deny')
  })

  it('falls back to general signEvent when no per-kind set', async () => {
    await setPermission('example.com', 'signEvent', 'allow')
    expect(await checkPermission('example.com', 'signEvent', 99)).toBe('allow')
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
    await setPermission('example.com', 'prototype', 'allow')
    expect(await checkPermission('example.com', 'prototype')).toBe(null)
  })

  it('rejects empty string as host', async () => {
    await setPermission('', 'getPublicKey', 'allow')
    expect(await checkPermission('', 'getPublicKey')).toBe(null)
  })
})

describe('removePermission', () => {
  it('removes a specific method', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow')
    await setPermission('example.com', 'signEvent', 'allow')
    await removePermission('example.com', 'getPublicKey')
    expect(await checkPermission('example.com', 'getPublicKey')).toBe(null)
    expect(await checkPermission('example.com', 'signEvent')).toBe('allow')
  })

  it('removes the host entry when last method is removed', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow')
    await removePermission('example.com', 'getPublicKey')
    const policies = await getPermissions()
    expect(policies['example.com']).toBeUndefined()
  })
})

describe('removeDomainPermissions', () => {
  it('removes all methods for a host', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow')
    await setPermission('example.com', 'signEvent', 'allow')
    await removeDomainPermissions('example.com')
    expect(await checkPermission('example.com', 'getPublicKey')).toBe(null)
    expect(await checkPermission('example.com', 'signEvent')).toBe(null)
  })
})

describe('clearAllPermissions', () => {
  it('wipes all permissions', async () => {
    await setPermission('a.com', 'getPublicKey', 'allow')
    await setPermission('b.com', 'signEvent', 'deny')
    await clearAllPermissions()
    const policies = await getPermissions()
    expect(Object.keys(policies)).toHaveLength(0)
  })
})

describe('profile-scoped permissions', () => {
  it('isolates permissions per profileId', async () => {
    await setPermission('example.com', 'getPublicKey', 'allow', null, 'profile-1')
    await setPermission('example.com', 'getPublicKey', 'deny', null, 'profile-2')
    expect(await checkPermission('example.com', 'getPublicKey', null, 'profile-1')).toBe('allow')
    expect(await checkPermission('example.com', 'getPublicKey', null, 'profile-2')).toBe('deny')
  })
})
