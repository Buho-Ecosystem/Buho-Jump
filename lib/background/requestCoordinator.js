/**
 * Tracks prompt-bound requests so background flows don't leak window listeners
 * or stale prompt payloads across unlock / permission lifecycles.
 */

export const PROMPT_EVENT_PREFIX = 'prompt_event_'
export const PROMPT_CONTEXT_PREFIX = 'prompt_context_'

export function createRequestCoordinator({
  storage = chrome.storage.session,
  contextStorage = chrome.storage.session,
  windowsApi = chrome.windows,
  tabsApi = chrome.tabs,
} = {}) {
  const pending = new Map()

  function has(requestId) {
    return pending.has(requestId)
  }

  function register(requestId, resolve, context = null) {
    pending.set(requestId, { resolve, context, cleanupFns: [], closePrompt: null })
  }

  function getContext(requestId) {
    return pending.get(requestId)?.context || null
  }

  async function setEventData(requestId, data) {
    if (typeof data === 'undefined') return
    await storage.set({ [`${PROMPT_EVENT_PREFIX}${requestId}`]: data })
  }

  async function persistContext(requestId, context) {
    if (!requestId || !context) return
    await contextStorage.set({ [`${PROMPT_CONTEXT_PREFIX}${requestId}`]: context })
  }

  async function getPersistedContext(requestId) {
    if (!requestId) return null
    const key = `${PROMPT_CONTEXT_PREFIX}${requestId}`
    const data = await contextStorage.get(key)
    return data[key] || null
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
      resolve(requestId, fallbackValue, { removeEventData: true }).catch(() => {})
    }

    api.onRemoved.addListener(onRemoved)
    entry.cleanupFns.push(() => api.onRemoved.removeListener(onRemoved))
    if (api?.remove) {
      entry.closePrompt = () => Promise.resolve(api.remove(handle.id)).catch(() => {})
    }
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
    await contextStorage.remove(`${PROMPT_CONTEXT_PREFIX}${requestId}`)

    return entry
  }

  async function resolve(requestId, value, options = {}) {
    const entry = await cleanup(requestId, options)
    if (!entry) return false
    if (options.closePrompt && entry.closePrompt) await entry.closePrompt()
    entry.resolve(value)
    return true
  }

  async function resolveWhere(predicate, value, options = {}) {
    const ids = [...pending.entries()]
      .filter(([, entry]) => predicate(entry.context))
      .map(([requestId]) => requestId)
    await Promise.all(ids.map(requestId => resolve(requestId, value, options)))
    return ids.length
  }

  async function clearEventData(requestId) {
    await storage.remove(`${PROMPT_EVENT_PREFIX}${requestId}`)
  }

  async function clearPromptData(requestId) {
    await Promise.all([
      storage.remove(`${PROMPT_EVENT_PREFIX}${requestId}`),
      contextStorage.remove(`${PROMPT_CONTEXT_PREFIX}${requestId}`),
    ])
  }

  return {
    has,
    register,
    getContext,
    setEventData,
    persistContext,
    getPersistedContext,
    attachWindowClose,
    cleanup,
    resolve,
    resolveWhere,
    clearEventData,
    clearPromptData,
  }
}
