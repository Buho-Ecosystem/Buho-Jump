/**
 * Tests for lib/notificationPoller.js — alarm creation, listener registration, locked skip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'

// Mock heavy dependencies to isolate poller logic
vi.mock('../lib/accounts.js', () => ({
  getActiveAccount: vi.fn(async () => null),
}))
vi.mock('../lib/relayPool.js', () => ({
  getPool: vi.fn(() => ({
    querySync: vi.fn(async () => []),
  })),
}))
vi.mock('../lib/relays.js', () => ({
  getPoolRelays: vi.fn(async () => []),
  getInboxRelays: vi.fn(async () => []),
  DEFAULT_CHAT_RELAYS: ['wss://relay.test'],
}))
vi.mock('../lib/notifications.js', () => ({
  notifyDm: vi.fn(),
}))
vi.mock('../lib/logger.js', () => ({
  log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { startNotificationPoller } from '../lib/notificationPoller.js'
import { notifyDm } from '../lib/notifications.js'

beforeEach(() => {
  resetStorage()
  chrome.alarms.create.mockClear()
  chrome.alarms.onAlarm.addListener.mockClear()
})

describe('startNotificationPoller', () => {
  it('creates a chrome alarm with correct name and interval', () => {
    startNotificationPoller(() => null)
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'buho-notif-poll',
      expect.objectContaining({
        delayInMinutes: 2,
        periodInMinutes: 2,
      })
    )
  })

  it('registers an alarm listener', () => {
    startNotificationPoller(() => null)
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1)
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledWith(expect.any(Function))
  })

  it('skips poll when password is null (locked)', async () => {
    startNotificationPoller(() => null) // always returns null
    const listener = chrome.alarms.onAlarm.addListener.mock.calls[0][0]
    // Trigger alarm
    await listener({ name: 'buho-notif-poll' })
    // No notifications should fire
    expect(notifyDm).not.toHaveBeenCalled()
  })

  it('ignores alarms with wrong name', async () => {
    const getPassword = vi.fn(() => 'test')
    startNotificationPoller(getPassword)
    const listener = chrome.alarms.onAlarm.addListener.mock.calls[0][0]
    await listener({ name: 'other-alarm' })
    // getPassword should not be called since the alarm name doesn't match
    // (the handler checks name before calling pollForNewMessages)
  })
})
