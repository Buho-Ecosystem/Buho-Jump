/**
 * Tracks prompt-bound requests so background flows don't leak window listeners
 * or stale prompt payloads across unlock / permission lifecycles.
 */

export const PROMPT_EVENT_PREFIX = 'prompt_event_'

export function createRequestCoordinator({
  storage = chrome.storage.local,
  windowsApi = chrome.windows,
  tabsApi = chrome.tabs,
} = {}) {
  const pending = new Map()

  function has(requestId) {
    return pending.has(requestId)
  }

  function register(requestId, resolve) {
    pending.set(requestId, { resolve, cleanupFns: [] })
  }

  async function setEventData(requestId, data) {
    if (typeof data === 'undefined') return
    await storage.set({ [`${PROMPT_EVENT_PREFIX}${requestId}`]: data })
  }

  /**
   * Resolve the pending request to `fallbackValue` when the user closes the
   * prompt without deciding. `handle` is `{ kind, id }` from openPromptWindow:
   * Chromium prompts are popup windows (watch windows.onRemoved), Firefox
   * prompts are tabs (watch tabs.onRemoved).
   */
  function attachWindowClose(requestId, handle, fallbackValue = false) {
    if (!handle?.id) return
    const entry = pending.get(requestId)
    if (!entry) return

    const api = handle.kind === 'tab' ? tabsApi : windowsApi
    if (!api?.onRemoved?.addListener) return

    const onRemoved = (closedId) => {
      if (closedId !== handle.id || !pending.has(requestId)) return
      resolve(requestId, fallbackValue).catch(() => {})
    }

    api.onRemoved.addListener(onRemoved)
    entry.cleanupFns.push(() => api.onRemoved.removeListener(onRemoved))
  }

  async function cleanup(requestId, { removeEventData = false } = {}) {
    const entry = pending.get(requestId)
    if (!entry) return null

    pending.delete(requestId)

    for (const fn of entry.cleanupFns) {
      try { fn() } catch { /* best-effort cleanup */ }
    }

    if (removeEventData) {
      await storage.remove(`${PROMPT_EVENT_PREFIX}${requestId}`)
    }

    return entry
  }

  async function resolve(requestId, value, options) {
    const entry = await cleanup(requestId, options)
    if (!entry) return false
    entry.resolve(value)
    return true
  }

  async function clearEventData(requestId) {
    await storage.remove(`${PROMPT_EVENT_PREFIX}${requestId}`)
  }

  return {
    has,
    register,
    setEventData,
    attachWindowClose,
    cleanup,
    resolve,
    clearEventData,
  }
}
