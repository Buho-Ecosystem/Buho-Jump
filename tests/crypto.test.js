/**
 * Tests for lib/crypto.js — AES-256-GCM encryption, password hashing, verification.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  encryptData, decryptData, hashPassword,
  isPasswordSet, setupPassword, verifyPassword, changePassword,
} from '../lib/crypto.js'
import { randomBytes } from 'nostr-core'

beforeEach(() => {
  resetStorage()
})

describe('encryptData / decryptData', () => {
  it('roundtrips a string', async () => {
    const result = await decryptData(await encryptData('hello', 'pw'), 'pw')
    expect(result).toBe('hello')
  })

  it('roundtrips an object', async () => {
    const data = { secretHex: 'abcdef', name: 'test' }
    const result = await decryptData(await encryptData(data, 'pw'), 'pw')
    expect(result).toEqual(data)
  })

  it('roundtrips an array', async () => {
    const data = [1, 2, { nested: true }]
    const result = await decryptData(await encryptData(data, 'pw'), 'pw')
    expect(result).toEqual(data)
  })

  it('roundtrips null and booleans', async () => {
    expect(await decryptData(await encryptData(null, 'pw'), 'pw')).toBe(null)
    expect(await decryptData(await encryptData(true, 'pw'), 'pw')).toBe(true)
  })

  it('produces different ciphertext each time (random salt/iv)', async () => {
    const a = await encryptData('same', 'pw')
    const b = await encryptData('same', 'pw')
    expect(a).not.toBe(b)
  })

  it('rejects wrong password', async () => {
    const encrypted = await encryptData('secret', 'correct')
    await expect(decryptData(encrypted, 'wrong')).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const encrypted = await encryptData('secret', 'pw')
    // Flip a character in the middle of the base64 string
    const tampered = encrypted.slice(0, 40) + 'X' + encrypted.slice(41)
    await expect(decryptData(tampered, 'pw')).rejects.toThrow()
  })
})

describe('hashPassword', () => {
  it('produces consistent hashes with same salt', async () => {
    const salt = randomBytes(16)
    const a = await hashPassword('pw', salt)
    const b = await hashPassword('pw', salt)
    expect(a).toBe(b)
  })

  it('produces different hashes with different salts', async () => {
    const a = await hashPassword('pw', randomBytes(16))
    const b = await hashPassword('pw', randomBytes(16))
    expect(a).not.toBe(b)
  })

  it('produces different hashes for different passwords', async () => {
    const salt = randomBytes(16)
    const a = await hashPassword('pw1', salt)
    const b = await hashPassword('pw2', salt)
    expect(a).not.toBe(b)
  })
})

describe('setupPassword / verifyPassword', () => {
  it('isPasswordSet returns false initially', async () => {
    expect(await isPasswordSet()).toBe(false)
  })

  it('setupPassword then isPasswordSet returns true', async () => {
    await setupPassword('mypassword')
    expect(await isPasswordSet()).toBe(true)
  })

  it('verifyPassword succeeds with correct password', async () => {
    await setupPassword('mypassword')
    expect(await verifyPassword('mypassword')).toBe(true)
  })

  it('verifyPassword fails with wrong password', async () => {
    await setupPassword('mypassword')
    expect(await verifyPassword('wrongpassword')).toBe(false)
  })

  it('verifyPassword returns false when no password is set', async () => {
    expect(await verifyPassword('anything')).toBe(false)
  })
})

describe('changePassword', () => {
  it('succeeds with correct old password', async () => {
    await setupPassword('old')
    await changePassword('old', 'new')
    expect(await verifyPassword('new')).toBe(true)
    expect(await verifyPassword('old')).toBe(false)
  })

  it('rejects wrong old password', async () => {
    await setupPassword('old')
    await expect(changePassword('wrong', 'new')).rejects.toThrow('incorrect')
  })

  it('old password is fully invalid after change', async () => {
    await setupPassword('original')
    await changePassword('original', 'updated')
    expect(await verifyPassword('original')).toBe(false)
    expect(await verifyPassword('updated')).toBe(true)
    // Encrypt with new, cannot decrypt with old
    const encrypted = await encryptData('secret', 'updated')
    await expect(decryptData(encrypted, 'original')).rejects.toThrow()
  })
})

describe('edge cases', () => {
  it('handles empty string data', async () => {
    const encrypted = await encryptData('', 'pw')
    const result = await decryptData(encrypted, 'pw')
    expect(result).toBe('')
  })

  it('handles large data (10KB+ payload)', async () => {
    const largeData = 'x'.repeat(10240)
    const encrypted = await encryptData(largeData, 'pw')
    const result = await decryptData(encrypted, 'pw')
    expect(result).toBe(largeData)
  })

  it('handles deeply nested object', async () => {
    const deep = { a: { b: { c: { d: [1, 2, { e: 'f' }] } } } }
    const result = await decryptData(await encryptData(deep, 'pw'), 'pw')
    expect(result).toEqual(deep)
  })

  it('handles empty object', async () => {
    const result = await decryptData(await encryptData({}, 'pw'), 'pw')
    expect(result).toEqual({})
  })

  it('handles empty array', async () => {
    const result = await decryptData(await encryptData([], 'pw'), 'pw')
    expect(result).toEqual([])
  })

  it('handles unicode / emoji data', async () => {
    const data = '🔥 Bitcoin ₿ ⚡ Nostr 日本語 العربية'
    const result = await decryptData(await encryptData(data, 'pw'), 'pw')
    expect(result).toBe(data)
  })

  it('handles special JSON values (Infinity → null in JSON)', async () => {
    // JSON.stringify(Infinity) → null
    const data = { a: Infinity, b: -Infinity, c: NaN }
    const result = await decryptData(await encryptData(data, 'pw'), 'pw')
    expect(result.a).toBeNull()
    expect(result.b).toBeNull()
    expect(result.c).toBeNull()
  })

  it('handles numeric zero and boolean false', async () => {
    expect(await decryptData(await encryptData(0, 'pw'), 'pw')).toBe(0)
    expect(await decryptData(await encryptData(false, 'pw'), 'pw')).toBe(false)
  })

  it('handles very long password', async () => {
    const longPw = 'x'.repeat(10000)
    const encrypted = await encryptData('secret', longPw)
    const result = await decryptData(encrypted, longPw)
    expect(result).toBe('secret')
  })

  it('rejects completely empty ciphertext', async () => {
    await expect(decryptData('', 'pw')).rejects.toThrow()
  })

  it('rejects non-base64 ciphertext', async () => {
    await expect(decryptData('not-base64!!!', 'pw')).rejects.toThrow()
  })

  it('rejects truncated ciphertext (too short for salt+iv)', async () => {
    // Valid base64 but too short to contain salt (16) + iv (12) + data
    const short = btoa('short')
    await expect(decryptData(short, 'pw')).rejects.toThrow()
  })
})
