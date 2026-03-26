/**
 * Tests for composables/useLock.js — master password, lock/unlock, rate limiting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetStorage } from './setup.js'

// Mock Vue lifecycle hooks
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  }
})

import { useLock } from '../composables/useLock.js'

beforeEach(() => {
  resetStorage()
  chrome.runtime.sendMessage.mockReset()
  vi.useFakeTimers()

  // Reset composable state
  const lock = useLock()
  lock.locked.value = true
  lock.passwordSet.value = false
  lock.failedAttempts.value = 0
  lock.lockoutUntil.value = 0
  lock.autoLockCountdown.value = 0
})

afterEach(() => {
  vi.useRealTimers()
})

// ── setup ───────────────────────────────────────────────────────

describe('setup', () => {
  it('sends SETUP_PASSWORD and updates state', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { setup, locked, passwordSet } = useLock()
    await setup('my-password')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SETUP_PASSWORD',
      params: ['my-password'],
    })
    expect(locked.value).toBe(false)
    expect(passwordSet.value).toBe(true)
  })

  it('resets failed attempts', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { setup, failedAttempts } = useLock()
    failedAttempts.value = 5
    await setup('pw')
    expect(failedAttempts.value).toBe(0)
  })
})

// ── unlock ──────────────────────────────────────────────────────

describe('unlock', () => {
  it('sends UNLOCK and sets locked to false on success', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { unlock, locked, failedAttempts } = useLock()
    failedAttempts.value = 0
    await unlock('correct-pw')
    expect(locked.value).toBe(false)
    expect(failedAttempts.value).toBe(0)
  })

  it('increments failedAttempts on wrong password', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'WRONG_PASSWORD' })
    const { unlock, failedAttempts } = useLock()
    failedAttempts.value = 0
    await expect(unlock('wrong')).rejects.toThrow()
    expect(failedAttempts.value).toBe(1)
  })

  it('applies progressive lockout after 3 failures', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'WRONG_PASSWORD' })
    const { unlock, failedAttempts, lockoutUntil } = useLock()
    failedAttempts.value = 0

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await expect(unlock('wrong')).rejects.toThrow()
    }
    expect(failedAttempts.value).toBe(3)
    expect(lockoutUntil.value).toBeGreaterThan(0)
  })

  it('rejects immediately during lockout period', async () => {
    const { unlock, lockoutUntil } = useLock()
    lockoutUntil.value = Date.now() + 10000 // 10s from now
    await expect(unlock('any')).rejects.toThrow(/TOO_MANY_ATTEMPTS/)
    // Should NOT have called sendMessage
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('resets failed attempts on successful unlock', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { unlock, failedAttempts, lockoutUntil } = useLock()
    failedAttempts.value = 3
    lockoutUntil.value = 0
    await unlock('correct')
    expect(failedAttempts.value).toBe(0)
    expect(lockoutUntil.value).toBe(0)
  })
})

// ── lock ────────────────────────────────────────────────────────

describe('lock', () => {
  it('sends LOCK and sets locked to true', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { lock, locked } = useLock()
    locked.value = false
    await lock()
    expect(locked.value).toBe(true)
  })
})

// ── checkState ──────────────────────────────────────────────────

describe('checkState', () => {
  it('updates locked and passwordSet from background', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      result: { locked: false, passwordSet: true },
    })
    const { checkState, locked, passwordSet, loading } = useLock()
    await checkState()
    expect(locked.value).toBe(false)
    expect(passwordSet.value).toBe(true)
    expect(loading.value).toBe(false)
  })

  it('defaults to locked on error', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('fail'))
    const { checkState, locked, passwordSet } = useLock()
    await checkState()
    expect(locked.value).toBe(true)
    expect(passwordSet.value).toBe(false)
  })
})

// ── changePassword ──────────────────────────────────────────────

describe('changePassword', () => {
  it('sends CHANGE_PASSWORD message', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { changePassword } = useLock()
    await changePassword('old', 'new')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CHANGE_PASSWORD',
      params: ['old', 'new'],
    })
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('unlock — progressive lockout math', () => {
  it('lockout delay is 2s after 3rd failure', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'WRONG_PASSWORD' })
    const { unlock, failedAttempts, lockoutUntil } = useLock()
    failedAttempts.value = 0

    for (let i = 0; i < 3; i++) {
      await expect(unlock('wrong')).rejects.toThrow()
    }
    // Delay = Math.min(2^(3-2)*1000, 30000) = 2000ms
    const expectedDelay = 2000
    expect(lockoutUntil.value).toBeGreaterThan(0)
    expect(lockoutUntil.value).toBeLessThanOrEqual(Date.now() + expectedDelay + 100)
  })

  it('lockout delay caps at 30s', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ error: 'WRONG_PASSWORD' })
    const { unlock, failedAttempts, lockoutUntil } = useLock()
    failedAttempts.value = 0

    // Simulate many failures
    for (let i = 0; i < 10; i++) {
      lockoutUntil.value = 0 // clear lockout to allow attempt
      await expect(unlock('wrong')).rejects.toThrow()
    }
    // At 10 failures: delay = min(2^8 * 1000, 30000) = min(256000, 30000) = 30000
    expect(lockoutUntil.value).toBeLessThanOrEqual(Date.now() + 30000 + 100)
  })

  it('lockout exactly at now allows attempt', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ result: undefined })
    const { unlock, lockoutUntil } = useLock()
    lockoutUntil.value = Date.now() // exactly now — NOT greater than now
    await unlock('correct')
    // Should succeed — the check is lockoutUntil > now
  })
})

describe('checkState — error resilience', () => {
  it('handles response with missing result', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({})
    const { checkState, locked } = useLock()
    await checkState()
    // Should handle gracefully — locked/passwordSet might be undefined
    // Actual behavior depends on destructuring
    expect(locked.value).toBeDefined()
  })
})
