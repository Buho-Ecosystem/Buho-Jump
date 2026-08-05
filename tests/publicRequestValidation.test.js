import { describe, expect, it } from 'vitest'
import {
  validateCryptoPayload,
  validateInvoice,
  validateKeysend,
  validateUnsignedEvent,
} from '../lib/background/publicRequestValidation.js'

describe('public request validation', () => {
  it('returns only unsigned NIP-01 fields', () => {
    const event = validateUnsignedEvent({
      kind: 1,
      created_at: 1,
      content: 'hello',
      tags: [['t', 'test']],
      pubkey: 'attacker',
      id: 'attacker',
      sig: 'attacker',
    })
    expect(event).toEqual({ kind: 1, created_at: 1, content: 'hello', tags: [['t', 'test']] })
  })

  it('rejects malformed and oversized events', () => {
    expect(() => validateUnsignedEvent({ kind: '1', created_at: 1, content: '', tags: [] })).toThrow()
    expect(() => validateUnsignedEvent({ kind: 1, created_at: 1, content: 'x'.repeat(129 * 1024), tags: [] })).toThrow(/too large/)
    expect(() => validateUnsignedEvent({ kind: 1, created_at: 1, content: '', tags: [[1]] })).toThrow()
  })

  it('validates crypto peers and bounds text', () => {
    expect(validateCryptoPayload('AB'.repeat(32), 'hello')).toEqual(['ab'.repeat(32), 'hello'])
    expect(() => validateCryptoPayload('bad', 'hello')).toThrow(/public key/)
    expect(() => validateCryptoPayload('ab'.repeat(32), 'x'.repeat(65 * 1024))).toThrow(/too large/)
  })

  it('bounds invoice and keysend inputs', () => {
    expect(validateInvoice('  lnbc1test  ')).toBe('lnbc1test')
    expect(() => validateInvoice('x'.repeat(17 * 1024))).toThrow(/too large/)
    expect(validateKeysend({ destination: `02${'ab'.repeat(32)}`, amount: '21' }).amount).toBe(21)
    expect(() => validateKeysend({ destination: 'bad', amount: 1 })).toThrow(/destination/)
  })
})
