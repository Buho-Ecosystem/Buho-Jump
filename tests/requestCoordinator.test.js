import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import { createRequestCoordinator, PROMPT_EVENT_PREFIX } from '../lib/background/requestCoordinator.js'

describe('requestCoordinator', () => {
  let windowsApi
  let coordinator

  beforeEach(() => {
    resetStorage()
    windowsApi = {
      onRemoved: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    }
    coordinator = createRequestCoordinator({
      storage: chrome.storage.local,
      windowsApi,
      supportsWindowsApi: true,
    })
  })

  it('stores and clears prompt event data', async () => {
    await coordinator.setEventData('abc', { hello: 'world' })
    expect(getStore()[`${PROMPT_EVENT_PREFIX}abc`]).toEqual({ hello: 'world' })

    await coordinator.clearEventData('abc')
    expect(getStore()[`${PROMPT_EVENT_PREFIX}abc`]).toBeUndefined()
  })

  it('resolves a request and removes its window listener', async () => {
    const resolve = vi.fn()
    coordinator.register('req-1', resolve)
    coordinator.attachWindowClose('req-1', { id: 42 })

    const onRemoved = windowsApi.onRemoved.addListener.mock.calls[0][0]
    await coordinator.resolve('req-1', true)

    expect(resolve).toHaveBeenCalledWith(true)
    expect(windowsApi.onRemoved.removeListener).toHaveBeenCalledWith(onRemoved)
    expect(coordinator.has('req-1')).toBe(false)
  })

  it('keeps trusted permission scope with the pending request', () => {
    const context = { origin: 'https://example.com', method: 'signEvent', kind: 1, tabId: 42 }
    coordinator.register('req-context', vi.fn(), context)

    expect(coordinator.getContext('req-context')).toEqual(context)
    expect(coordinator.getContext('missing')).toBe(null)
  })

  it('persists trusted prompt context in session storage', async () => {
    const context = { origin: 'https://example.com', method: 'signEvent', profileId: 'account-1', createdAt: Date.now() }
    await coordinator.persistContext('req-persisted', context)
    expect(await coordinator.getPersistedContext('req-persisted')).toEqual(context)
    await coordinator.clearPromptData('req-persisted')
    expect(await coordinator.getPersistedContext('req-persisted')).toBe(null)
  })

  it('auto-resolves false when the prompt window closes', async () => {
    const resolve = vi.fn()
    coordinator.register('req-2', resolve)
    await coordinator.setEventData('req-2', { kind: 1 })
    coordinator.attachWindowClose('req-2', { id: 7 })

    const onRemoved = windowsApi.onRemoved.addListener.mock.calls[0][0]
    onRemoved(7)
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith(false))

    expect(coordinator.has('req-2')).toBe(false)
    expect(getStore()[`${PROMPT_EVENT_PREFIX}req-2`]).toBeUndefined()
  })
})
