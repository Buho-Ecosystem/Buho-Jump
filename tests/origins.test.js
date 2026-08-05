import { describe, expect, it } from 'vitest'
import {
  isCanonicalWebOrigin,
  isLoopbackHostname,
  normalizeWebOrigin,
  originPermissionPattern,
  requireSecureUrl,
} from '../lib/origins.js'

describe('origin security helpers', () => {
  it('preserves scheme and non-default port', () => {
    expect(normalizeWebOrigin('https://example.com:8443/path')).toBe('https://example.com:8443')
    expect(normalizeWebOrigin('http://example.com/path')).toBe('http://example.com')
    expect(originPermissionPattern('https://example.com:8443')).toBe('https://example.com:8443/*')
  })

  it('accepts only canonical web origins as permission keys', () => {
    expect(isCanonicalWebOrigin('https://example.com')).toBe(true)
    expect(isCanonicalWebOrigin('example.com')).toBe(false)
    expect(isCanonicalWebOrigin('https://example.com/path')).toBe(false)
  })

  it('requires HTTPS except explicit loopback development endpoints', () => {
    expect(requireSecureUrl('https://wallet.example/path').protocol).toBe('https:')
    expect(() => requireSecureUrl('http://wallet.example')).toThrow(/HTTPS/)
    expect(requireSecureUrl('http://127.0.0.1:5000', { allowLoopback: true }).port).toBe('5000')
    expect(isLoopbackHostname('::1')).toBe(true)
  })
})
