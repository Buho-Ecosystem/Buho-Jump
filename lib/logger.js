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
const SENSITIVE_KEY = /password|secret|nsec|token|invoice|preimage|connection.?uri|admin.?key|mnemonic|ciphertext|content/i

function sanitizeString(value) {
  return value
    .slice(0, 500)
    .replace(/nsec1[023456789acdefghjklmnpqrstuvwxyz]+/gi, '[REDACTED_NSEC]')
    .replace(/nostr\+walletconnect:\/\/[^\s"']+/gi, '[REDACTED_NWC]')
    .replace(/\b(?:lnbc|lntb|lnbcrt|lntbs)[023456789acdefghjklmnpqrstuvwxyz]+\b/gi, '[REDACTED_INVOICE]')
    .replace(/\bcashu[ab][A-Za-z0-9_-]+\b/g, '[REDACTED_CASHU]')
}

function sanitizeContext(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeContext(item, depth + 1))
  if (typeof value !== 'object') return String(value)
  const clean = {}
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    clean[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeContext(item, depth + 1)
  }
  return clean
}

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
    entry.d = sanitizeContext(context)
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
