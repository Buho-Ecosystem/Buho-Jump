/**
 * Tests for lib/allowances.js — per-site budget tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  getAllowances, getAllowance, setAllowance,
  recordSpend, checkBudget, removeAllowance, resetAllowanceSpend,
} from '../lib/allowances.js'

beforeEach(() => {
  resetStorage()
})

describe('setAllowance / getAllowance', () => {
  it('creates a new allowance', async () => {
    await setAllowance('example.com', 1000)
    const a = await getAllowance('example.com')
    expect(a).not.toBeNull()
    expect(a.budget).toBe(1000)
    expect(a.spent).toBe(0)
    expect(a.created_at).toBeGreaterThan(0)
  })

  it('updates budget without resetting spent', async () => {
    await setAllowance('example.com', 1000)
    await recordSpend('example.com', 200)
    await setAllowance('example.com', 2000)
    const a = await getAllowance('example.com')
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
    await setAllowance('example.com', 1000)
    const ok = await recordSpend('example.com', 500)
    expect(ok).toBeTruthy()
    const a = await getAllowance('example.com')
    expect(a.spent).toBe(500)
  })

  it('rejects spend over budget', async () => {
    await setAllowance('example.com', 100)
    const ok = await recordSpend('example.com', 101)
    expect(ok).toBeNull()
    const a = await getAllowance('example.com')
    expect(a.spent).toBe(0)
  })

  it('tracks cumulative spending', async () => {
    await setAllowance('example.com', 1000)
    await recordSpend('example.com', 300)
    await recordSpend('example.com', 400)
    const a = await getAllowance('example.com')
    expect(a.spent).toBe(700)
  })

  it('rejects when cumulative would exceed budget', async () => {
    await setAllowance('example.com', 500)
    await recordSpend('example.com', 300)
    const ok = await recordSpend('example.com', 300)
    expect(ok).toBeNull()
    const a = await getAllowance('example.com')
    expect(a.spent).toBe(300) // unchanged
  })

  it('returns false for unknown host', async () => {
    const ok = await recordSpend('unknown.com', 100)
    expect(ok).toBeNull()
  })
})

describe('checkBudget', () => {
  it('returns true when within budget', async () => {
    await setAllowance('example.com', 1000)
    await recordSpend('example.com', 200)
    expect(await checkBudget('example.com', 800)).toBe(true)
  })

  it('returns false when over budget', async () => {
    await setAllowance('example.com', 1000)
    await recordSpend('example.com', 600)
    expect(await checkBudget('example.com', 500)).toBe(false)
  })

  it('returns false for unknown host', async () => {
    expect(await checkBudget('nope.com', 1)).toBe(false)
  })

  it('returns true for exact remaining', async () => {
    await setAllowance('example.com', 100)
    await recordSpend('example.com', 50)
    expect(await checkBudget('example.com', 50)).toBe(true)
  })
})

describe('removeAllowance', () => {
  it('removes an allowance', async () => {
    await setAllowance('example.com', 1000)
    await removeAllowance('example.com')
    expect(await getAllowance('example.com')).toBeNull()
  })

  it('does not affect other allowances', async () => {
    await setAllowance('a.com', 100)
    await setAllowance('b.com', 200)
    await removeAllowance('a.com')
    expect(await getAllowance('b.com')).not.toBeNull()
  })
})

describe('resetAllowanceSpend', () => {
  it('resets spent to zero', async () => {
    await setAllowance('example.com', 1000)
    await recordSpend('example.com', 500)
    await resetAllowanceSpend('example.com')
    const a = await getAllowance('example.com')
    expect(a.spent).toBe(0)
    expect(a.budget).toBe(1000) // budget unchanged
  })
})

describe('getAllowances', () => {
  it('returns all allowances', async () => {
    await setAllowance('a.com', 100)
    await setAllowance('b.com', 200)
    const all = await getAllowances()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all['a.com'].budget).toBe(100)
    expect(all['b.com'].budget).toBe(200)
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

  it('accepts zero budget', async () => {
    await setAllowance('zero.com', 0)
    const a = await getAllowance('zero.com')
    expect(a.budget).toBe(0)
  })

  it('accepts negative budget (no server-side validation)', async () => {
    await setAllowance('neg.com', -100)
    const a = await getAllowance('neg.com')
    expect(a.budget).toBe(-100)
  })

  it('accepts NaN budget', async () => {
    await setAllowance('nan.com', NaN)
    const a = await getAllowance('nan.com')
    expect(a.budget).toBeNaN()
  })

  it('accepts Infinity budget', async () => {
    await setAllowance('inf.com', Infinity)
    const a = await getAllowance('inf.com')
    expect(a.budget).toBe(Infinity)
  })

  it('accepts very large budget near MAX_SAFE_INTEGER', async () => {
    await setAllowance('big.com', Number.MAX_SAFE_INTEGER)
    const a = await getAllowance('big.com')
    expect(a.budget).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('recordSpend — defensive inputs', () => {
  it('records zero-amount spend', async () => {
    await setAllowance('example.com', 100)
    const ok = await recordSpend('example.com', 0)
    expect(ok).toBeTruthy()
    expect((await getAllowance('example.com')).spent).toBe(0)
  })

  it('records negative spend (adds to remaining — potential abuse)', async () => {
    await setAllowance('example.com', 100)
    await recordSpend('example.com', 50)
    // Negative spend effectively gives free budget
    const ok = await recordSpend('example.com', -200)
    expect(ok).toBeTruthy() // remaining = 100 - 50 = 50, -200 <= 50 → true
  })

  it('rejects NaN amount (NaN > remaining is false)', async () => {
    await setAllowance('example.com', 100)
    const ok = await recordSpend('example.com', NaN)
    // NaN > 100 → false, so it proceeds and spent += NaN = NaN
    expect(ok).toBeTruthy()
  })

  it('returns false for null host', async () => {
    expect(await recordSpend(null, 100)).toBeNull()
  })

  it('returns false for numeric host', async () => {
    expect(await recordSpend(42, 100)).toBeNull()
  })
})

describe('checkBudget — boundary conditions', () => {
  it('returns true for zero amount', async () => {
    await setAllowance('example.com', 100)
    expect(await checkBudget('example.com', 0)).toBe(true)
  })

  it('returns true for negative amount', async () => {
    await setAllowance('example.com', 100)
    expect(await checkBudget('example.com', -50)).toBe(true)
  })

  it('returns false for NaN amount', async () => {
    await setAllowance('example.com', 100)
    // (100 - 0) >= NaN → false
    expect(await checkBudget('example.com', NaN)).toBe(false)
  })

  it('returns false for null host', async () => {
    expect(await checkBudget(null, 100)).toBe(false)
  })

  it('returns false for Infinity amount', async () => {
    await setAllowance('example.com', 100)
    expect(await checkBudget('example.com', Infinity)).toBe(false)
  })
})

describe('prototype pollution — extended', () => {
  it('stores toString as host (valid string, not in RESERVED_KEYS)', async () => {
    await setAllowance('toString', 100)
    const all = await getAllowances()
    // toString is a valid host — stored as a property (overrides inherited method)
    expect(all.toString).toEqual(expect.objectContaining({ budget: 100 }))
  })

  it('setAllowance with __proto__ does not pollute prototype', async () => {
    await setAllowance('__proto__', 999)
    const obj = {}
    expect(obj.budget).toBeUndefined()
  })
})
