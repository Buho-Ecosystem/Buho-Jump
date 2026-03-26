/**
 * Structured logger with ring buffer persistence.
 *
 * Captures errors and warnings with context so production issues can be
 * debugged. Entries are stored in chrome.storage.local as a ring buffer
 * (max 200 entries). The options page can export them as JSON for bug reports.
 *
 * Usage:
 *   import { log } from './logger.js'
 *   log.error('wallet', 'NWC_CONNECT_FAILED', { relay, err: err.message })
 *   log.warn('chat', 'DECRYPT_FAILED', { eventId })
 *   log.info('accounts', 'SWITCHED', { from, to })
 */

import { LOGGER_FLUSH_INTERVAL, LOGGER_MAX_ENTRIES } from './constants/timers.js'

const STORAGE_KEY = 'debugLog'

// In-memory buffer — flushed to storage periodically
let buffer = []
let flushTimer = null

/**
 * Core log function — appends an entry and schedules a flush.
 * @param {'error'|'warn'|'info'|'debug'} level
 * @param {string} module - Source module (e.g. 'wallet', 'chat', 'relay')
 * @param {string} code - Machine-readable code (e.g. 'NWC_CONNECT_FAILED')
 * @param {object} [context] - Extra data (keep small — no secrets)
 */
function append(level, module, code, context) {
  const entry = {
    t: Date.now(),
    l: level,
    m: module,
    c: code,
  }
  if (context !== undefined && context !== null) {
    entry.d = context
  }
  buffer.push(entry)
  scheduleFlush()
}

/** Debounced flush — batches writes to avoid hammering storage. */
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, LOGGER_FLUSH_INTERVAL)
}

/** Write buffered entries to storage ring buffer. */
async function flush() {
  if (buffer.length === 0) return
  const pending = buffer.splice(0)
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY)
    const existing = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []
    const merged = [...existing, ...pending]
    // Trim to ring buffer size
    const trimmed = merged.length > LOGGER_MAX_ENTRIES
      ? merged.slice(merged.length - LOGGER_MAX_ENTRIES)
      : merged
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed })
  } catch {
    // Storage write failed — entries are lost, don't recurse
  }
}

/** Read all log entries from storage. */
export async function getLogEntries() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY)
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []
  } catch {
    return []
  }
}

/** Clear all log entries. */
export async function clearLog() {
  buffer = []
  try {
    await chrome.storage.local.remove(STORAGE_KEY)
  } catch { /* best-effort */ }
}

/** Export log entries as a JSON string for bug reports. */
export async function exportLog() {
  const entries = await getLogEntries()
  // Append any unflushed entries
  const all = [...entries, ...buffer]
  return JSON.stringify(all, null, 2)
}

/** Flush immediately (call before extension unload). */
export { flush as flushLog }

export const log = {
  error: (module, code, context) => append('error', module, code, context),
  warn: (module, code, context) => append('warn', module, code, context),
  info: (module, code, context) => append('info', module, code, context),
  debug: (module, code, context) => append('debug', module, code, context),
}
