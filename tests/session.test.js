/**
 * Tests for lib/session.js — session persistence with fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import { saveSession, getSession, clearSession } from '../lib/session.js'

beforeEach(() => {
  resetStorage()
})

describe('saveSession / getSession', () => {
  it('persists and retrieves session data', async () => {
    await saveSession({ password: 'secret123', unlockedAt: 1000 })
    const session = await getSession()
    expect(session).not.toBeNull()
    expect(session.password).toBe('secret123')
    expect(session.unlockedAt).toBe(1000)
  })

  it('returns null when no session exists', async () => {
    const session = await getSession()
    expect(session).toBeNull()
  })

  it('fails closed for malformed session storage', async () => {
    await chrome.storage.session.set({
      _session: { password: '', unlockedAt: Number.NaN },
    })
    expect(await getSession()).toBeNull()
  })

  it('overwrites previous session', async () => {
    await saveSession({ password: 'old', unlockedAt: 1000 })
    await saveSession({ password: 'new', unlockedAt: 2000 })
    const session = await getSession()
    expect(session.password).toBe('new')
    expect(session.unlockedAt).toBe(2000)
  })
})

describe('clearSession', () => {
  it('clears saved session', async () => {
    await saveSession({ password: 'secret', unlockedAt: 1000 })
    await clearSession()
    const session = await getSession()
    expect(session).toBeNull()
  })

  it('succeeds even when no session exists', async () => {
    await expect(clearSession()).resolves.not.toThrow()
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('saveSession — defensive inputs', () => {
  it('stores null session data', async () => {
    await saveSession(null)
    const session = await getSession()
    expect(session).toBeNull()
  })

  it('rejects an incomplete session', async () => {
    await expect(saveSession({})).rejects.toThrow('Invalid secure session data')
    expect(await getSession()).toBeNull()
  })

  it('stores session with unicode fields', async () => {
    await saveSession({ password: '密码🔐', unlockedAt: 1000 })
    const session = await getSession()
    expect(session.password).toBe('密码🔐')
  })

  it('rejects a session with a very long password', async () => {
    const longPw = 'x'.repeat(10000)
    await expect(saveSession({ password: longPw, unlockedAt: 1000 }))
      .rejects.toThrow('Invalid secure session data')
    expect(await getSession()).toBeNull()
  })

  it('multiple rapid overwrites only keeps last', async () => {
    await saveSession({ password: 'a', unlockedAt: 1 })
    await saveSession({ password: 'b', unlockedAt: 2 })
    await saveSession({ password: 'c', unlockedAt: 3 })
    const session = await getSession()
    expect(session.password).toBe('c')
  })
})

describe('clearSession — idempotent', () => {
  it('double clear is safe', async () => {
    await saveSession({ password: 'test', unlockedAt: 1000 })
    await clearSession()
    await clearSession()
    expect(await getSession()).toBeNull()
  })
})
