/**
 * Tests for composables/useToast.js — toast notification system.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToast } from '../composables/useToast.js'

beforeEach(() => {
  vi.useFakeTimers()
  // Clear leftover toasts from previous tests
  const { toasts } = useToast()
  toasts.value = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('success / error / info', () => {
  it('adds a success toast', () => {
    const { success, toasts } = useToast()
    success('Saved!')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].type).toBe('success')
    expect(toasts.value[0].message).toBe('Saved!')
    expect(toasts.value[0].visible).toBe(true)
  })

  it('adds an error toast', () => {
    const { error, toasts } = useToast()
    error('Something failed')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].type).toBe('error')
    expect(toasts.value[0].message).toBe('Something failed')
  })

  it('adds an info toast', () => {
    const { info, toasts } = useToast()
    info('FYI')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].type).toBe('info')
  })

  it('supports multiple concurrent toasts', () => {
    const { success, error, toasts } = useToast()
    success('A')
    error('B')
    success('C')
    expect(toasts.value).toHaveLength(3)
  })

  it('returns a toast id', () => {
    const { success } = useToast()
    const id = success('test')
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })
})

describe('auto-dismiss', () => {
  it('marks toast as not visible before removal (exit animation)', () => {
    const { success, toasts } = useToast()
    success('test', 4000) // 4s duration
    expect(toasts.value[0].visible).toBe(true)

    vi.advanceTimersByTime(3700) // duration - 300ms
    expect(toasts.value[0].visible).toBe(false) // exit animation triggered
  })

  it('removes toast after full duration', () => {
    const { success, toasts } = useToast()
    success('test', 4000)
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(4000)
    expect(toasts.value).toHaveLength(0)
  })

  it('error toasts default to 6s duration', () => {
    const { error, toasts } = useToast()
    error('fail')
    vi.advanceTimersByTime(4000) // less than 6s
    expect(toasts.value).toHaveLength(1) // still present
    vi.advanceTimersByTime(2001)
    expect(toasts.value).toHaveLength(0) // removed after 6s
  })
})

describe('dismiss', () => {
  it('manually dismisses a toast by id', () => {
    const { success, dismiss, toasts } = useToast()
    const id = success('test')
    dismiss(id)
    // Toast should be hidden immediately
    expect(toasts.value[0].visible).toBe(false)
    // After animation delay (300ms), removed
    vi.advanceTimersByTime(300)
    expect(toasts.value).toHaveLength(0)
  })

  it('dismissing non-existent id is a no-op', () => {
    const { dismiss, toasts } = useToast()
    expect(() => dismiss(9999)).not.toThrow()
    expect(toasts.value).toHaveLength(0)
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('addToast — adversarial inputs', () => {
  it('handles empty message', () => {
    const { success, toasts } = useToast()
    success('')
    expect(toasts.value[0].message).toBe('')
  })

  it('handles very long message', () => {
    const { success, toasts } = useToast()
    const longMsg = 'x'.repeat(10000)
    success(longMsg)
    expect(toasts.value[0].message).toBe(longMsg)
  })

  it('handles unicode/emoji message', () => {
    const { success, toasts } = useToast()
    success('⚡ Payment sent! 🔥')
    expect(toasts.value[0].message).toBe('⚡ Payment sent! 🔥')
  })

  it('handles null message', () => {
    const { success, toasts } = useToast()
    success(null)
    expect(toasts.value[0].message).toBeNull()
  })
})

describe('dismiss — edge cases', () => {
  it('double dismiss same toast is safe', () => {
    const { success, dismiss, toasts } = useToast()
    const id = success('test')
    dismiss(id)
    dismiss(id) // second dismiss
    vi.advanceTimersByTime(300)
    expect(toasts.value).toHaveLength(0)
  })

  it('dismiss after auto-removal is safe', () => {
    const { success, dismiss, toasts } = useToast()
    const id = success('test', 1000)
    vi.advanceTimersByTime(1000) // auto-removed
    expect(toasts.value).toHaveLength(0)
    expect(() => dismiss(id)).not.toThrow() // dismiss already-removed
  })
})

describe('timing edge cases', () => {
  it('multiple toasts with overlapping timers all clean up', () => {
    const { success, toasts } = useToast()
    success('A', 1000)
    success('B', 2000)
    success('C', 3000)
    expect(toasts.value).toHaveLength(3)

    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(2)

    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })
})
