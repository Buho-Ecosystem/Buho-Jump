/**
 * Tests for composables/useOnline.js — reactive online/offline status.
 *
 * Since navigator is read-only in modern Node, we mock the Vue lifecycle
 * to capture the handlers and simulate events directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture lifecycle callbacks
let mountedCbs = []
let unmountCbs = []
const _eventListeners = {}

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn((fn) => { mountedCbs.push(fn) }),
    onBeforeUnmount: vi.fn((fn) => { unmountCbs.push(fn) }),
  }
})

// Ensure window mock has addEventListener before module load
globalThis.window = globalThis.window || {}
globalThis.window.addEventListener = vi.fn((event, handler) => {
  _eventListeners[event] = handler
})
globalThis.window.removeEventListener = vi.fn()

import { useOnline } from '../composables/useOnline.js'

beforeEach(() => {
  mountedCbs = []
  unmountCbs = []
  Object.keys(_eventListeners).forEach(k => delete _eventListeners[k])
  globalThis.window.addEventListener.mockClear()
  globalThis.window.removeEventListener.mockClear()
  // Reset the ref
  const { online } = useOnline()
  online.value = true
})

describe('initial state', () => {
  it('defaults to true (online)', () => {
    const { online } = useOnline()
    expect(online.value).toBe(true)
  })
})

describe('event handling via onMounted', () => {
  it('registers online and offline listeners on mount', () => {
    useOnline()
    // Execute mounted callbacks
    mountedCbs.forEach(fn => fn())
    expect(_eventListeners.online).toBeDefined()
    expect(_eventListeners.offline).toBeDefined()
  })

  it('sets online to false when offline fires', () => {
    const { online } = useOnline()
    mountedCbs.forEach(fn => fn())
    _eventListeners.offline()
    expect(online.value).toBe(false)
  })

  it('sets online to true when online fires', () => {
    const { online } = useOnline()
    online.value = false
    mountedCbs.forEach(fn => fn())
    _eventListeners.online()
    expect(online.value).toBe(true)
  })

  it('toggles on sequential events', () => {
    const { online } = useOnline()
    mountedCbs.forEach(fn => fn())
    _eventListeners.offline()
    expect(online.value).toBe(false)
    _eventListeners.online()
    expect(online.value).toBe(true)
  })
})
