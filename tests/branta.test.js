import { describe, it, expect } from 'vitest'
import { normalizeBrantaResult } from '../lib/branta.js'

describe('Branta result normalization', () => {
  it('keeps display fields and HTTPS links', () => {
    expect(normalizeBrantaResult({
      payments: [{ platform: ' Store ', platformLogoUrl: 'https://cdn.example/logo.png', description: 'Merchant' }],
      verifyUrl: 'https://branta.example/verify',
    })).toEqual({
      name: 'Store', logoUrl: 'https://cdn.example/logo.png', logoLightUrl: '',
      description: 'Merchant', verifyUrl: 'https://branta.example/verify',
    })
  })

  it('drops unsafe links and empty misses', () => {
    expect(normalizeBrantaResult({ payments: [] })).toBeNull()
    expect(normalizeBrantaResult({ payments: [{ platformLogoUrl: 'http://unsafe.example/logo.png' }] })).toBeNull()
  })
})
