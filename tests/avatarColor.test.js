/**
 * Tests for lib/avatarColor.js — deterministic avatar color from pubkey.
 */

import { describe, it, expect } from 'vitest'
import { getAvatarColor } from '../lib/avatarColor.js'

describe('getAvatarColor', () => {
  it('returns a valid hex CSS color', () => {
    const color = getAvatarColor('a'.repeat(64))
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('is deterministic (same input → same output)', () => {
    const pubkey = 'abcdef1234567890'.repeat(4)
    expect(getAvatarColor(pubkey)).toBe(getAvatarColor(pubkey))
  })

  it('returns different colors for different pubkeys', () => {
    // Use pubkeys whose last two hex chars map to different indices
    const colors = new Set()
    for (let i = 0; i < 7; i++) {
      const hex = i.toString(16).padStart(2, '0')
      colors.add(getAvatarColor('0'.repeat(62) + hex))
    }
    expect(colors.size).toBe(7) // 7 distinct colors in palette
  })

  it('uses the last two hex chars for hashing', () => {
    // Two pubkeys with same suffix should get same color
    const a = 'a'.repeat(62) + 'ff'
    const b = 'b'.repeat(62) + 'ff'
    expect(getAvatarColor(a)).toBe(getAvatarColor(b))
  })

  it('wraps around the palette (modulo)', () => {
    // 0xff = 255, 255 % 7 = 3 → palette index 3
    const color = getAvatarColor('0'.repeat(62) + 'ff')
    expect(color).toBeTruthy()
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('getAvatarColor — adversarial inputs', () => {
  it('handles empty string (parseInt of empty → NaN, NaN % 7 → NaN)', () => {
    // parseInt('', 16) → NaN, NaN % 7 → NaN, AVATAR_COLORS[NaN] → undefined
    const color = getAvatarColor('')
    expect(color).toBeUndefined()
  })

  it('handles single-char pubkey', () => {
    // slice(-2) of 'a' → 'a', parseInt('a', 16) = 10, 10 % 7 = 3
    const color = getAvatarColor('a')
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('handles pubkey with non-hex suffix', () => {
    // slice(-2) of 'xyz' → 'yz', parseInt('yz', 16) → NaN
    const color = getAvatarColor('x'.repeat(62) + 'yz')
    expect(color).toBeUndefined()
  })

  it('handles uppercase hex in pubkey', () => {
    const lower = getAvatarColor('0'.repeat(62) + 'ab')
    const upper = getAvatarColor('0'.repeat(62) + 'AB')
    // parseInt handles both, should return same color
    expect(lower).toBe(upper)
  })
})
