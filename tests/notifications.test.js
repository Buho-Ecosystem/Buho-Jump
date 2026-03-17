/**
 * Tests for lib/notifications.js — DND, quiet hours, throttle, dedup, category toggles.
 *
 * Note: notifications.js has module-level throttle/dedup state. We use
 * unique messageIds and vi.useFakeTimers to control timing between tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi as vitest } from 'vitest'
import { resetStorage } from './setup.js'

// We need a fresh module import per test group to reset module-level state (throttle, dedup).
// Use dynamic import with cache-busting is not ideal, so instead we use unique IDs
// and advance timers past the throttle window (3s) between tests.

import {
  notifyDm, notifyGroup, notifyPayment,
  getNotificationSettings, setNotificationSettings,
  setupNotificationClickHandler, _resetForTesting,
} from '../lib/notifications.js'

beforeEach(() => {
  resetStorage()
  chrome.notifications.create.mockClear()
  _resetForTesting()
  vitest.useFakeTimers()
  vitest.setSystemTime(new Date(2026, 2, 16, 10, 0)) // 10:00 AM baseline
})

afterEach(() => {
  vitest.useRealTimers()
})

describe('settings', () => {
  it('returns defaults when nothing stored', async () => {
    const s = await getNotificationSettings()
    expect(s.dms).toBe(true)
    expect(s.groups).toBe(true)
    expect(s.payments).toBe(true)
    expect(s.dnd).toBe(false)
    expect(s.quietHours).toBe(false)
  })

  it('persists and reads back settings', async () => {
    await setNotificationSettings({ dms: false, groups: true, payments: true, dnd: true })
    const s = await getNotificationSettings()
    expect(s.dms).toBe(false)
    expect(s.dnd).toBe(true)
  })
})

describe('category toggles', () => {
  it('notifyDm respects dms: false', async () => {
    await setNotificationSettings({ dms: false, groups: true, payments: true })
    await notifyDm('Alice', 'hello', 'cat-dm-off')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })

  it('notifyGroup respects groups: false', async () => {
    await setNotificationSettings({ dms: true, groups: false, payments: true })
    await notifyGroup('Test Group', 'Bob', 'hello', 'cat-grp-off')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })

  it('notifyPayment respects payments: false', async () => {
    await setNotificationSettings({ dms: true, groups: true, payments: false })
    await notifyPayment(1000, 'cat-pay-off')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })
})

describe('DND silencing', () => {
  it('blocks all notifications when DND is on', async () => {
    await setNotificationSettings({ dms: true, groups: true, payments: true, dnd: true })
    await notifyDm('Alice', 'hello', 'dnd-1')
    vitest.advanceTimersByTime(5000)
    await notifyGroup('Group', 'Bob', 'hey', 'dnd-2')
    vitest.advanceTimersByTime(5000)
    await notifyPayment(500, 'dnd-3')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })
})

describe('quiet hours', () => {
  it('blocks during quiet hours (overnight range 22:00-08:00)', async () => {
    await setNotificationSettings({
      dms: true, groups: true, payments: true,
      quietHours: true, quietStart: '22:00', quietEnd: '08:00',
    })

    // Mock time to 23:30
    vitest.setSystemTime(new Date(2026, 2, 16, 23, 30))

    await notifyDm('Alice', 'late night', 'qh-overnight')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })

  it('allows outside quiet hours', async () => {
    await setNotificationSettings({
      dms: true, groups: true, payments: true,
      quietHours: true, quietStart: '22:00', quietEnd: '08:00',
    })

    // Mock time to 12:00 noon
    vitest.setSystemTime(new Date(2026, 2, 16, 12, 0))

    await notifyDm('Alice', 'daytime', 'qh-outside')
    expect(chrome.notifications.create).toHaveBeenCalled()
  })

  it('blocks during same-day range (09:00-17:00) at midday', async () => {
    await setNotificationSettings({
      dms: true, groups: true, payments: true,
      quietHours: true, quietStart: '09:00', quietEnd: '17:00',
    })

    vitest.setSystemTime(new Date(2026, 2, 16, 12, 0))

    await notifyDm('Alice', 'midday', 'qh-sameday')
    expect(chrome.notifications.create).not.toHaveBeenCalled()
  })

  it('allows before same-day quiet range', async () => {
    await setNotificationSettings({
      dms: true, groups: true, payments: true,
      quietHours: true, quietStart: '09:00', quietEnd: '17:00',
    })

    vitest.setSystemTime(new Date(2026, 2, 16, 7, 0))

    await notifyDm('Alice', 'early', 'qh-before')
    expect(chrome.notifications.create).toHaveBeenCalled()
  })
})

describe('throttle', () => {
  it('allows first notification', async () => {
    await notifyDm('Alice', 'first', 'thr-first')
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)
  })

  it('suppresses rapid second notification within 3s', async () => {
    await notifyDm('Alice', 'first', 'thr-rapid-a')
    // Don't advance timers — second call is within throttle window
    await notifyDm('Bob', 'second', 'thr-rapid-b')
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)
  })

  it('allows second notification after 3s', async () => {
    await notifyDm('Alice', 'first', 'thr-spaced-a')
    vitest.advanceTimersByTime(3500)
    await notifyDm('Bob', 'second', 'thr-spaced-b')
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2)
  })
})

describe('dedup', () => {
  it('suppresses duplicate messageId even after throttle passes', async () => {
    await notifyDm('Alice', 'msg', 'dup-id-1')
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)

    vitest.advanceTimersByTime(5000) // past throttle
    await notifyDm('Alice', 'msg', 'dup-id-1') // same ID
    // Should still be 1 — dedup blocks it
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1)
  })

  it('allows different messageIds', async () => {
    await notifyDm('Alice', 'msg1', 'dup-diff-a')
    vitest.advanceTimersByTime(5000)
    await notifyDm('Alice', 'msg2', 'dup-diff-b')
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2)
  })
})

describe('notification format', () => {
  it('DM notification has correct id prefix and content', async () => {
    await notifyDm('Alice', 'Hey there!', 'fmt-dm')
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'dm-fmt-dm',
      expect.objectContaining({
        type: 'basic',
        title: 'Alice',
        message: 'Hey there!',
      })
    )
  })

  it('group notification includes sender in message', async () => {
    vitest.advanceTimersByTime(5000)
    await notifyGroup('Dev Chat', 'Bob', 'check this out', 'fmt-grp')
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'group-fmt-grp',
      expect.objectContaining({
        type: 'basic',
        title: 'Dev Chat',
        message: expect.stringContaining('Bob'),
      })
    )
  })

  it('payment notification formats sats', async () => {
    vitest.advanceTimersByTime(5000)
    await notifyPayment(42000, 'fmt-pay')
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'payment-fmt-pay',
      expect.objectContaining({
        title: 'Payment Received',
        message: expect.stringContaining('42'),
      })
    )
  })

  it('DM uses fallback title when senderName is empty', async () => {
    vitest.advanceTimersByTime(5000)
    await notifyDm('', '', 'fmt-fallback')
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'dm-fmt-fallback',
      expect.objectContaining({
        title: 'New Message',
      })
    )
  })
})

describe('click handler', () => {
  it('registers onClicked listener', () => {
    chrome.notifications.onClicked.addListener.mockClear()
    setupNotificationClickHandler()
    expect(chrome.notifications.onClicked.addListener).toHaveBeenCalledTimes(1)
  })
})
