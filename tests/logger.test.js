/**
 * Tests for lib/logger.js — structured logging with ring buffer.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import { log, getLogEntries, clearLog, flushLog } from '../lib/logger.js'

beforeEach(async () => {
  resetStorage()
  await clearLog()
})

describe('log + flush', () => {
  it('stores entries after flush', async () => {
    log.error('test', 'TEST_ERROR', { detail: 'hello' })
    await flushLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].l).toBe('error')
    expect(entries[0].m).toBe('test')
    expect(entries[0].c).toBe('TEST_ERROR')
    expect(entries[0].d).toEqual({ detail: 'hello' })
    expect(entries[0].t).toBeGreaterThan(0)
  })

  it('supports all log levels', async () => {
    log.error('m', 'E')
    log.warn('m', 'W')
    log.info('m', 'I')
    log.debug('m', 'D')
    await flushLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(4)
    expect(entries.map(e => e.l)).toEqual(['error', 'warn', 'info', 'debug'])
  })

  it('omits context when not provided', async () => {
    log.info('m', 'CODE')
    await flushLog()
    const entries = await getLogEntries()
    expect(entries[0].d).toBeUndefined()
  })
})

describe('clearLog', () => {
  it('clears all entries', async () => {
    log.error('m', 'E')
    await flushLog()
    await clearLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(0)
  })
})

describe('getLogEntries', () => {
  it('returns empty array when no entries', async () => {
    const entries = await getLogEntries()
    expect(entries).toEqual([])
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('log — adversarial context data', () => {
  it('handles null context (omitted from entry to save storage)', async () => {
    log.error('m', 'E', null)
    await flushLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].d).toBeUndefined()
  })

  it('handles very large context object', async () => {
    const bigCtx = {}
    for (let i = 0; i < 100; i++) bigCtx[`k${i}`] = `v${i}`
    log.info('m', 'C', bigCtx)
    await flushLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(1)
  })

  it('handles unicode in message and code', async () => {
    log.info('модуль', 'КОД_ОШИБКИ', { detail: '日本語' })
    await flushLog()
    const entries = await getLogEntries()
    expect(entries[0].m).toBe('модуль')
    expect(entries[0].c).toBe('КОД_ОШИБКИ')
  })

  it('handles empty string code', async () => {
    log.warn('m', '')
    await flushLog()
    const entries = await getLogEntries()
    expect(entries[0].c).toBe('')
  })

  it('multiple flushes do not duplicate entries', async () => {
    log.info('m', 'C')
    await flushLog()
    await flushLog() // second flush with no new entries
    const entries = await getLogEntries()
    expect(entries).toHaveLength(1)
  })

  it('entries accumulate across multiple log + flush cycles', async () => {
    log.info('m1', 'C1')
    await flushLog()
    log.info('m2', 'C2')
    await flushLog()
    const entries = await getLogEntries()
    expect(entries).toHaveLength(2)
  })
})
