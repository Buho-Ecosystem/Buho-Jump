import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasOriginAccess,
  requestOriginAccess,
  requestOriginsAccess,
} from '../lib/browser/hostPermissions.js'

beforeEach(() => {
  chrome.permissions = {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  }
})

afterEach(() => {
  delete chrome.permissions
})

describe('exact browser host permissions', () => {
  it('requests only the selected origin and preserves a custom port', async () => {
    expect(await requestOriginAccess('https://mint.example.com:8443/api/v1')).toBe(true)
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://mint.example.com:8443/*'],
    })
  })

  it('deduplicates origins before presenting the browser prompt', async () => {
    await requestOriginsAccess([
      'https://mint.example.com/a',
      'https://mint.example.com/b',
      'https://callback.example.com/pay',
    ])
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://mint.example.com/*', 'https://callback.example.com/*'],
    })
  })

  it('fails closed for malformed URLs without opening a permission prompt', async () => {
    expect(await hasOriginAccess('not a URL')).toBe(false)
    expect(await requestOriginAccess('not a URL')).toBe(false)
    expect(await requestOriginsAccess(['https://mint.example.com', 'bad URL'])).toBe(false)
    expect(chrome.permissions.request).not.toHaveBeenCalled()
  })
})
