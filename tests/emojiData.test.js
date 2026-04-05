import { describe, it, expect } from 'vitest'
import { searchEmojis, EMOJI_LIST } from '../lib/emojiData.js'

describe('emojiData', () => {
  describe('EMOJI_LIST', () => {
    it('contains entries as [emoji, name] pairs', () => {
      expect(EMOJI_LIST.length).toBeGreaterThan(50)
      for (const entry of EMOJI_LIST) {
        expect(entry).toHaveLength(2)
        expect(typeof entry[0]).toBe('string') // emoji
        expect(typeof entry[1]).toBe('string') // name
        expect(entry[1]).toMatch(/^[a-z_]+$/)  // snake_case names only
      }
    })

    it('has no duplicate names', () => {
      const names = EMOJI_LIST.map(([, n]) => n)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('searchEmojis', () => {
    it('returns matches for partial name', () => {
      const results = searchEmojis('smi')
      expect(results.length).toBeGreaterThan(0)
      expect(results.every(([, name]) => name.includes('smi'))).toBe(true)
    })

    it('returns empty for no match', () => {
      expect(searchEmojis('zzzznotanemoji')).toEqual([])
    })

    it('returns empty for empty query', () => {
      expect(searchEmojis('')).toEqual([])
    })

    it('respects limit parameter', () => {
      const results = searchEmojis('a', 3)
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('is case insensitive', () => {
      const lower = searchEmojis('fire')
      const upper = searchEmojis('FIRE')
      expect(lower).toEqual(upper)
    })

    it('finds fire emoji', () => {
      const results = searchEmojis('fire')
      expect(results.some(([emoji]) => emoji === '🔥')).toBe(true)
    })

    it('finds heart emoji', () => {
      const results = searchEmojis('heart')
      expect(results.some(([emoji]) => emoji === '❤️')).toBe(true)
    })

    it('finds zap emoji', () => {
      const results = searchEmojis('zap')
      expect(results.some(([emoji]) => emoji === '⚡')).toBe(true)
    })
  })
})
