/**
 * Vitest global setup — mocks chrome extension APIs.
 *
 * Provides an in-memory chrome.storage.local, chrome.notifications,
 * chrome.runtime, and chrome.alarms so lib/ modules can be tested
 * without a browser environment.
 */

import { vi } from 'vitest'

// ── In-memory storage ──

let store = {}

function createStorage() {
  return {
    get: vi.fn(async (keys) => {
      if (keys === null) return { ...store }
      if (typeof keys === 'string') {
        return { [keys]: store[keys] }
      }
      if (Array.isArray(keys)) {
        const result = {}
        for (const k of keys) result[k] = store[k]
        return result
      }
      return {}
    }),
    set: vi.fn(async (items) => {
      Object.assign(store, items)
    }),
    remove: vi.fn(async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const k of list) delete store[k]
    }),
  }
}

// ── Chrome API mock ──

globalThis.chrome = {
  storage: {
    local: createStorage(),
    session: createStorage(),
  },
  notifications: {
    create: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    onClicked: { addListener: vi.fn() },
  },
  runtime: {
    getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
    sendMessage: vi.fn(async () => ({})),
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(async () => ({})),
  },
}

/**
 * Reset storage between tests.
 */
export function resetStorage() {
  store = {}
}

/**
 * Get raw store for assertions.
 */
export function getStore() {
  return store
}
