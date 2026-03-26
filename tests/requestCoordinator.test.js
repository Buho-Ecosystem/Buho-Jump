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

  it('auto-resolves false when the prompt window closes', async () => {
    const resolve = vi.fn()
    coordinator.register('req-2', resolve)
    coordinator.attachWindowClose('req-2', { id: 7 })

    const onRemoved = windowsApi.onRemoved.addListener.mock.calls[0][0]
    onRemoved(7)
    await Promise.resolve()

    expect(resolve).toHaveBeenCalledWith(false)
    expect(coordinator.has('req-2')).toBe(false)
  })
})
