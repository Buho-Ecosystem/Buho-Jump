import { describe, expect, it, vi } from 'vitest'
import { withStorageRollback } from '../lib/storageTransaction.js'

function mockStorage(initial) {
  const state = { ...initial }
  return {
    state,
    get: vi.fn(async keys => Object.fromEntries(keys.filter(key => key in state).map(key => [key, state[key]]))),
    set: vi.fn(async values => Object.assign(state, values)),
    remove: vi.fn(async keys => keys.forEach(key => delete state[key])),
  }
}

describe('withStorageRollback', () => {
  it('keeps successful migrations', async () => {
    const storage = mockStorage({ a: 'old' })
    await withStorageRollback(storage, ['a', 'b'], async () => {
      await storage.set({ a: 'new', b: 'created' })
    })
    expect(storage.state).toEqual({ a: 'new', b: 'created' })
  })

  it('restores old values and removes newly created values after failure', async () => {
    const storage = mockStorage({ a: 'old', untouched: true })
    await expect(withStorageRollback(storage, ['a', 'b'], async () => {
      await storage.set({ a: 'new', b: 'created' })
      throw new Error('migration failed')
    })).rejects.toThrow('migration failed')
    expect(storage.state).toEqual({ a: 'old', untouched: true })
  })
})
