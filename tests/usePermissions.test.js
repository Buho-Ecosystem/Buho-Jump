/**
 * Tests for composables/usePermissions.js — reactive permission state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'

// Mock Vue lifecycle (not used but safe guard)
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  }
})

import { usePermissions } from '../composables/usePermissions.js'

beforeEach(() => {
  resetStorage()
  chrome.runtime.sendMessage.mockReset()
  const { policies } = usePermissions()
  policies.value = {}
})

describe('load', () => {
  it('populates policies from background', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      result: {
        'example.com': { getPublicKey: 'allow', signEvent: 'deny' },
        'other.com': { getPublicKey: 'allow' },
      },
    })

    const { load, policies, domains } = usePermissions()
    await load()

    expect(Object.keys(policies.value)).toHaveLength(2)
    expect(domains.value).toContain('example.com')
    expect(domains.value).toContain('other.com')
  })

  it('defaults to empty object when result is null', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: null })
    const { load, policies } = usePermissions()
    await load()
    expect(policies.value).toEqual({})
  })
})

describe('revokeDomain', () => {
  it('sends REMOVE_DOMAIN_PERMISSIONS and reloads', async () => {
    // First call: revoke. Second call: load (returns empty)
    chrome.runtime.sendMessage
      .mockResolvedValueOnce({ result: undefined })
      .mockResolvedValueOnce({ result: {} })

    const { revokeDomain, policies } = usePermissions()
    policies.value = { 'example.com': { getPublicKey: 'allow' } }

    await revokeDomain('example.com')

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_DOMAIN_PERMISSIONS',
      params: ['example.com'],
    })
    // After reload, should be empty
    expect(policies.value).toEqual({})
  })
})

describe('revokeMethod', () => {
  it('sends REMOVE_PERMISSION and reloads', async () => {
    chrome.runtime.sendMessage
      .mockResolvedValueOnce({ result: undefined })
      .mockResolvedValueOnce({
        result: { 'example.com': { signEvent: 'allow' } },
      })

    const { revokeMethod, policies } = usePermissions()
    policies.value = {
      'example.com': { getPublicKey: 'allow', signEvent: 'allow' },
    }

    await revokeMethod('example.com', 'getPublicKey')

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_PERMISSION',
      params: ['example.com', 'getPublicKey'],
    })
    // After reload, only signEvent should remain
    expect(policies.value['example.com'].signEvent).toBe('allow')
    expect(policies.value['example.com'].getPublicKey).toBeUndefined()
  })
})

describe('domains computed', () => {
  it('returns array of domain strings', () => {
    const { policies, domains } = usePermissions()
    policies.value = {
      'a.com': { x: 'allow' },
      'b.com': { y: 'deny' },
    }
    expect(domains.value).toEqual(['a.com', 'b.com'])
  })

  it('returns empty array when no policies', () => {
    const { domains } = usePermissions()
    expect(domains.value).toEqual([])
  })
})
