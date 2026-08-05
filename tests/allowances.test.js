/**
 * Tests for lib/allowances.js — per-site budget tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  getAllowances, getAllowance, setAllowance,
  recordSpend, reserveSpend, refundSpend, checkBudget, removeAllowance, resetAllowanceSpend,
} from '../lib/allowances.js'

beforeEach(() => {
  resetStorage()
})

describe('setAllowance / getAllowance', () => {
  it('creates a new allowance', async () => {
    await setAllowance('https://example.com', 1000)
    const a = await getAllowance('https://example.com')
    expect(a).not.toBeNull()
    expect(a.budget).toBe(1000)
    expect(a.spent).toBe(0)
    expect(a.created_at).toBeGreaterThan(0)
  })

  it('updates budget without resetting spent', async () => {
    await setAllowance('https://example.com', 1000)
    await recordSpend('https://example.com', 200)
    await setAllowance('https://example.com', 2000)
    const a = await getAllowance('https://example.com')
    expect(a.budget).toBe(2000)
    expect(a.spent).toBe(200)
  })

  it('rejects invalid hosts', async () => {
    await setAllowance('', 1000)
    await setAllowance('__proto__', 1000)
    const all = await getAllowances()
    expect(Object.keys(all)).toHaveLength(0)
  })
})

describe('recordSpend', () => {
  it('records spend within budget', async () => {
    await setAllowance('https://example.com', 1000)
    const ok = await recordSpend('https://example.com', 500)
    expect(ok).toBeTruthy()
    const a = await getAllowance('https://example.com')
    expect(a.spent).toBe(500)
  })

  it('rejects spend over budget', async () => {
    await setAllowance('https://example.com', 100)
    const ok = await recordSpend('https://example.com', 101)
    expect(ok).toBeNull()
    const a = await getAllowance('https://example.com')
    expect(a.spent).toBe(0)
  })

  it('tracks cumulative spending', async () => {
    await setAllowance('https://example.com', 1000)
    await recordSpend('https://example.com', 300)
    await recordSpend('https://example.com', 400)
    const a = await getAllowance('https://example.com')
    expect(a.spent).toBe(700)
  })

  it('rejects when cumulative would exceed budget', async () => {
    await setAllowance('https://example.com', 500)
    await recordSpend('https://example.com', 300)
    const ok = await recordSpend('https://example.com', 300)
    expect(ok).toBeNull()
    const a = await getAllowance('https://example.com')
    expect(a.spent).toBe(300) // unchanged
  })

  it('returns false for unknown host', async () => {
    const ok = await recordSpend('https://unknown.com', 100)
    expect(ok).toBeNull()
  })
})

describe('checkBudget', () => {
  it('returns true when within budget', async () => {
    await setAllowance('https://example.com', 1000)
    await recordSpend('https://example.com', 200)
    expect(await checkBudget('https://example.com', 800)).toBe(true)
  })

  it('returns false when over budget', async () => {
    await setAllowance('https://example.com', 1000)
    await recordSpend('https://example.com', 600)
    expect(await checkBudget('https://example.com', 500)).toBe(false)
  })

  it('returns false for unknown host', async () => {
    expect(await checkBudget('https://nope.com', 1)).toBe(false)
  })

  it('returns true for exact remaining', async () => {
    await setAllowance('https://example.com', 100)
    await recordSpend('https://example.com', 50)
    expect(await checkBudget('https://example.com', 50)).toBe(true)
  })
})

describe('removeAllowance', () => {
  it('removes an allowance', async () => {
    await setAllowance('https://example.com', 1000)
    await removeAllowance('https://example.com')
    expect(await getAllowance('https://example.com')).toBeNull()
  })

  it('does not affect other allowances', async () => {
    await setAllowance('https://a.com', 100)
    await setAllowance('https://b.com', 200)
    await removeAllowance('https://a.com')
    expect(await getAllowance('https://b.com')).not.toBeNull()
  })
})

describe('resetAllowanceSpend', () => {
  it('resets spent to zero', async () => {
    await setAllowance('https://example.com', 1000)
    await recordSpend('https://example.com', 500)
    await resetAllowanceSpend('https://example.com')
    const a = await getAllowance('https://example.com')
    expect(a.spent).toBe(0)
    expect(a.budget).toBe(1000) // budget unchanged
  })
})

describe('getAllowances', () => {
  it('returns all allowances', async () => {
    await setAllowance('https://a.com', 100)
    await setAllowance('https://b.com', 200)
    const all = await getAllowances()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all['https://a.com'].budget).toBe(100)
    expect(all['https://b.com'].budget).toBe(200)
  })

  it('returns empty object when none set', async () => {
    const all = await getAllowances()
    expect(all).toEqual({})
  })
})

// ── Enterprise hardening: defensive inputs & boundary conditions ─

describe('setAllowance — defensive inputs', () => {
  it('rejects null host', async () => {
    await setAllowance(null, 1000)
    expect(await getAllowances()).toEqual({})
  })

  it('rejects undefined host', async () => {
    await setAllowance(undefined, 1000)
    expect(await getAllowances()).toEqual({})
  })

  it('rejects numeric host', async () => {
    await setAllowance(123, 1000)
    expect(await getAllowances()).toEqual({})
  })

  it('rejects boolean host', async () => {
    await setAllowance(true, 1000)
    expect(await getAllowances()).toEqual({})
  })

  it('rejects object host', async () => {
    await setAllowance({}, 1000)
    expect(await getAllowances()).toEqual({})
  })

  it('rejects zero budget', async () => {
    await setAllowance('https://zero.com', 0)
    expect(await getAllowance('https://zero.com')).toBeNull()
  })

  it('rejects negative budgets', async () => {
    await setAllowance('https://neg.com', -100)
    expect(await getAllowance('https://neg.com')).toBeNull()
  })

  it('rejects NaN budgets', async () => {
    await setAllowance('https://nan.com', NaN)
    expect(await getAllowance('https://nan.com')).toBeNull()
  })

  it('rejects infinite budgets', async () => {
    await setAllowance('https://inf.com', Infinity)
    expect(await getAllowance('https://inf.com')).toBeNull()
  })

  it('rejects budgets above the Bitcoin supply', async () => {
    await setAllowance('https://big.com', Number.MAX_SAFE_INTEGER)
    expect(await getAllowance('https://big.com')).toBeNull()
  })
})

describe('recordSpend — defensive inputs', () => {
  it('rejects zero-amount spend', async () => {
    await setAllowance('https://example.com', 100)
    const ok = await recordSpend('https://example.com', 0)
    expect(ok).toBeNull()
    expect((await getAllowance('https://example.com')).spent).toBe(0)
  })

  it('rejects negative spend', async () => {
    await setAllowance('https://example.com', 100)
    await recordSpend('https://example.com', 50)
    const ok = await recordSpend('https://example.com', -200)
    expect(ok).toBeNull()
    expect((await getAllowance('https://example.com')).spent).toBe(50)
  })

  it('rejects NaN amounts', async () => {
    await setAllowance('https://example.com', 100)
    const ok = await recordSpend('https://example.com', NaN)
    expect(ok).toBeNull()
  })

  it('returns false for null host', async () => {
    expect(await recordSpend(null, 100)).toBeNull()
  })

  it('returns false for numeric host', async () => {
    expect(await recordSpend(42, 100)).toBeNull()
  })
})

describe('checkBudget — boundary conditions', () => {
  it('returns false for zero amount', async () => {
    await setAllowance('https://example.com', 100)
    expect(await checkBudget('https://example.com', 0)).toBe(false)
  })

  it('returns false for negative amount', async () => {
    await setAllowance('https://example.com', 100)
    expect(await checkBudget('https://example.com', -50)).toBe(false)
  })

  it('returns false for NaN amount', async () => {
    await setAllowance('https://example.com', 100)
    // (100 - 0) >= NaN → false
    expect(await checkBudget('https://example.com', NaN)).toBe(false)
  })

  it('returns false for null host', async () => {
    expect(await checkBudget(null, 100)).toBe(false)
  })

  it('returns false for Infinity amount', async () => {
    await setAllowance('https://example.com', 100)
    expect(await checkBudget('https://example.com', Infinity)).toBe(false)
  })
})

describe('prototype pollution — extended', () => {
  it('rejects non-origin property names', async () => {
    await setAllowance('toString', 100)
    const all = await getAllowances()
    expect(Object.keys(all)).toEqual([])
  })

  it('setAllowance with __proto__ does not pollute prototype', async () => {
    await setAllowance('__proto__', 999)
    const obj = {}
    expect(obj.budget).toBeUndefined()
  })
})

describe('atomic budget reservations', () => {
  it('allows only one concurrent reservation to consume the remaining budget', async () => {
    await setAllowance('https://example.com', 100)
    const reservations = await Promise.all([
      reserveSpend('https://example.com', 80),
      reserveSpend('https://example.com', 80),
    ])
    expect(reservations.filter(Boolean)).toHaveLength(1)
    expect((await getAllowance('https://example.com')).spent).toBe(80)
  })

  it('refunds a failed reserved payment exactly once', async () => {
    await setAllowance('https://example.com', 100)
    const reservation = await reserveSpend('https://example.com', 80)
    expect(await refundSpend('https://example.com', reservation.reservationId)).toBe(true)
    expect(await refundSpend('https://example.com', reservation.reservationId)).toBe(false)
    expect((await getAllowance('https://example.com')).spent).toBe(0)
  })
})
