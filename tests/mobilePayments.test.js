import { describe, it, expect } from 'vitest'
import {
  recognizePhoneNumber,
  recognizePhoneNumberForCountry,
  matchMobilePaymentAddress,
} from '../lib/mobilePayments.js'

describe('mobile payment phone recognition', () => {
  it('routes explicit Kenyan, Zambian, and Tanzanian numbers', () => {
    expect(recognizePhoneNumber('+254 712 345 678').lightningAddress).toBe('254712345678@bitcoin.co.ke')
    expect(recognizePhoneNumber('+260 978 123 456').lightningAddress).toBe('260978123456@bitzed.xyz')
    expect(recognizePhoneNumber('+255 740 034 110').lightningAddress).toBe('255740034110@chapsmart.com')
  })

  it('requires a country choice for colliding local prefixes', () => {
    const result = recognizePhoneNumber('0751 234 567')
    expect(result.ambiguous).toBe(true)
    expect(result.candidates.map(candidate => candidate.country.code)).toEqual(['KE', 'ZM', 'TZ'])
  })

  it('resolves a local number after an explicit country choice', () => {
    const result = recognizePhoneNumberForCountry('TZ', '0751 234 567')
    expect(result.country.provider).toBe('ChapSmart')
    expect(result.lightningAddress).toBe('255751234567@chapsmart.com')
  })

  it('recognizes an existing provider Lightning Address', () => {
    const result = matchMobilePaymentAddress('260978123456@bitzed.xyz')
    expect(result.country.code).toBe('ZM')
    expect(result.operator).toBe('Airtel')
  })

  it('rejects unknown or weak phone-like input', () => {
    expect(recognizePhoneNumber('123456789')).toBeNull()
    expect(recognizePhoneNumber('+4912345678')).toBeNull()
    expect(recognizePhoneNumber('hello')).toBeNull()
  })
})
