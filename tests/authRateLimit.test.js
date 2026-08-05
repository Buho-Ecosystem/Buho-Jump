import { beforeEach, describe, expect, it } from 'vitest'
import { resetStorage } from './setup.js'
import {
  checkPasswordRateLimit,
  clearPasswordFailures,
  recordPasswordFailure,
} from '../lib/authRateLimit.js'

beforeEach(resetStorage)

describe('password rate limit', () => {
  it('blocks after five failures and increases the delay', async () => {
    for (let count = 0; count < 4; count++) {
      expect((await recordPasswordFailure(chrome.storage.session, 1_000)).allowed).toBe(true)
    }
    expect(await recordPasswordFailure(chrome.storage.session, 1_000)).toEqual({ allowed: false, retryAfter: 30 })
    expect(await checkPasswordRateLimit(chrome.storage.session, 1_001)).toEqual({ allowed: false, retryAfter: 30 })
  })

  it('clears failures after successful authentication', async () => {
    await recordPasswordFailure(chrome.storage.session, 1_000)
    await clearPasswordFailures(chrome.storage.session)
    expect((await checkPasswordRateLimit(chrome.storage.session, 1_000)).allowed).toBe(true)
  })
})
