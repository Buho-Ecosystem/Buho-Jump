/**
 * Tests for composables/useTheme.js — theme and mode state management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'

// Mock Vue lifecycle hooks + document for applyTheme()
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  }
})

globalThis.document = {
  documentElement: {
    setAttribute: vi.fn(),
    style: { setProperty: vi.fn() },
  },
}

import { useTheme } from '../composables/useTheme.js'
import { themeIds, defaultTheme, defaultMode } from '../themes/tokens.js'

beforeEach(() => {
  resetStorage()
  const { currentTheme, currentMode } = useTheme()
  currentTheme.value = defaultTheme
  currentMode.value = defaultMode
})

// ── setTheme ────────────────────────────────────────────────────

describe('setTheme', () => {
  it('changes to a valid theme', () => {
    const { setTheme, currentTheme } = useTheme()
    setTheme('copper-dusk')
    expect(currentTheme.value).toBe('copper-dusk')
  })

  it('rejects invalid theme id', () => {
    const { setTheme, currentTheme } = useTheme()
    const before = currentTheme.value
    setTheme('nonexistent-theme')
    expect(currentTheme.value).toBe(before)
  })

  it('accepts all known theme ids', () => {
    const { setTheme, currentTheme } = useTheme()
    for (const id of themeIds) {
      setTheme(id)
      expect(currentTheme.value).toBe(id)
    }
  })
})

// ── setMode ─────────────────────────────────────────────────────

describe('setMode', () => {
  it('sets to light mode', () => {
    const { setMode, currentMode } = useTheme()
    setMode('light')
    expect(currentMode.value).toBe('light')
  })

  it('sets to dark mode', () => {
    const { setMode, currentMode } = useTheme()
    currentMode.value = 'light'
    setMode('dark')
    expect(currentMode.value).toBe('dark')
  })

  it('rejects invalid mode', () => {
    const { setMode, currentMode } = useTheme()
    const before = currentMode.value
    setMode('sepia')
    expect(currentMode.value).toBe(before)
  })
})

// ── toggleMode ──────────────────────────────────────────────────

describe('toggleMode', () => {
  it('toggles dark → light', () => {
    const { toggleMode, currentMode } = useTheme()
    currentMode.value = 'dark'
    toggleMode()
    expect(currentMode.value).toBe('light')
  })

  it('toggles light → dark', () => {
    const { toggleMode, currentMode } = useTheme()
    currentMode.value = 'light'
    toggleMode()
    expect(currentMode.value).toBe('dark')
  })

  it('double toggle returns to original', () => {
    const { toggleMode, currentMode } = useTheme()
    const original = currentMode.value
    toggleMode()
    toggleMode()
    expect(currentMode.value).toBe(original)
  })
})

// ── cycleTheme ──────────────────────────────────────────────────

describe('cycleTheme', () => {
  it('advances to the next theme', () => {
    const { cycleTheme, currentTheme } = useTheme()
    currentTheme.value = themeIds[0]
    cycleTheme()
    expect(currentTheme.value).toBe(themeIds[1])
  })

  it('wraps around to the first theme', () => {
    const { cycleTheme, currentTheme } = useTheme()
    currentTheme.value = themeIds[themeIds.length - 1]
    cycleTheme()
    expect(currentTheme.value).toBe(themeIds[0])
  })

  it('cycles through all themes', () => {
    const { cycleTheme, currentTheme } = useTheme()
    const visited = new Set()
    currentTheme.value = themeIds[0]
    for (let i = 0; i < themeIds.length; i++) {
      visited.add(currentTheme.value)
      cycleTheme()
    }
    expect(visited.size).toBe(themeIds.length)
  })
})

// ── themes / themeIds exports ───────────────────────────────────

describe('theme exports', () => {
  it('exposes themes object', () => {
    const { themes } = useTheme()
    expect(Object.keys(themes).length).toBeGreaterThan(0)
  })

  it('exposes themeIds array', () => {
    const t = useTheme()
    expect(Array.isArray(t.themeIds)).toBe(true)
    expect(t.themeIds.length).toBeGreaterThan(0)
  })

  it('every theme has dark and light modes', () => {
    const { themes } = useTheme()
    for (const [id, theme] of Object.entries(themes)) {
      expect(theme.dark).toBeDefined()
      expect(theme.light).toBeDefined()
    }
  })
})
