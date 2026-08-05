import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPermissionSession, permissionScopeKey } from '../lib/background/permissionSession.js'

describe('permissionSession', () => {
  let session
  let base

  beforeEach(() => {
    session = createPermissionSession()
    base = {
      profileId: 'profile-1',
      tabId: 12,
      origin: 'https://example.com',
      method: 'nip44_decrypt',
      kind: null,
    }
  })

  it('scopes visit grants to identity, tab, host, and capability', () => {
    session.grant(base)

    expect(session.hasGrant(base)).toBe(true)
    expect(session.hasGrant({ ...base, profileId: 'profile-2' })).toBe(false)
    expect(session.hasGrant({ ...base, tabId: 13 })).toBe(false)
    expect(session.hasGrant({ ...base, origin: 'https://other.example' })).toBe(false)
    expect(session.hasGrant({ ...base, method: 'nip44_encrypt' })).toBe(false)
  })

  it('keeps signing grants separate for each event kind', () => {
    const note = { ...base, method: 'signEvent', kind: 1 }
    session.grant(note)

    expect(session.hasGrant(note)).toBe(true)
    expect(session.hasGrant({ ...note, kind: 7 })).toBe(false)
  })

  it('coalesces a concurrent NIP-44 request storm into one prompt', async () => {
    let approve
    const openPrompt = vi.fn(() => new Promise(resolve => { approve = resolve }))

    const requests = Array.from({ length: 39 }, () => session.coalesce(base, openPrompt))
    await Promise.resolve()

    expect(openPrompt).toHaveBeenCalledTimes(1)
    expect(session.pendingCount()).toBe(1)

    approve(true)
    await expect(Promise.all(requests)).resolves.toEqual(Array(39).fill(true))
    expect(session.pendingCount()).toBe(0)
  })

  it('does not coalesce payment approvals', async () => {
    const payment = { ...base, method: 'weblnSendPayment' }
    const openPrompt = vi.fn(async () => true)

    await Promise.all([
      session.coalesce(payment, openPrompt),
      session.coalesce(payment, openPrompt),
    ])

    expect(openPrompt).toHaveBeenCalledTimes(2)
  })

  it('shows different capability prompts one at a time for the same site', async () => {
    const order = []
    let finishFirst
    const first = session.coalesce(base, () => new Promise(resolve => {
      order.push('decrypt-opened')
      finishFirst = resolve
    }))
    const second = session.coalesce(
      { ...base, method: 'signEvent', kind: 1 },
      async () => { order.push('sign-opened'); return true },
    )

    await Promise.resolve()
    expect(order).toEqual(['decrypt-opened'])
    finishFirst(true)
    await Promise.all([first, second])
    expect(order).toEqual(['decrypt-opened', 'sign-opened'])
  })

  it('clears visit grants when their tab closes', () => {
    session.grant(base)
    session.grant({ ...base, tabId: 13 })

    session.clearTab(12)

    expect(session.hasGrant(base)).toBe(false)
    expect(session.hasGrant({ ...base, tabId: 13 })).toBe(true)
  })

  it('lists and revokes individual visit grants', () => {
    session.grant(base)
    session.grant({ ...base, origin: 'https://other.example' })
    const grants = session.listGrants('profile-1')
    expect(grants).toHaveLength(2)

    expect(session.revoke(grants[0].key)).toBe(true)
    expect(session.listGrants('profile-1')).toHaveLength(1)
    session.clearOrigin('profile-1', 'https://other.example')
    expect(session.listGrants('profile-1')).toEqual([])
  })

  it('clears only the removed identity visit grants', () => {
    session.grant(base)
    session.grant({ ...base, profileId: 'profile-2' })
    session.clearProfile('profile-1')
    expect(session.listGrants('profile-1')).toEqual([])
    expect(session.listGrants('profile-2')).toHaveLength(1)
  })

  it('cancels permissions queued behind a denied prompt', async () => {
    let finishFirst
    const secondPrompt = vi.fn(async () => true)
    const first = session.coalesce(base, () => new Promise(resolve => { finishFirst = resolve }))
    const second = session.coalesce({ ...base, method: 'nip44_encrypt' }, secondPrompt)
    await Promise.resolve()

    session.cancelLane(base)
    finishFirst(false)
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(secondPrompt).not.toHaveBeenCalled()
  })

  it('bounds the number of queued requests per site', async () => {
    const payment = { ...base, method: 'weblnSendPayment' }
    let finishFirst
    let call = 0
    const openPrompt = vi.fn(() => {
      call++
      if (call === 1) return new Promise(resolve => { finishFirst = resolve })
      return Promise.resolve(true)
    })
    const accepted = Array.from({ length: 8 }, () => session.coalesce(payment, openPrompt))
    await expect(session.coalesce(payment, openPrompt)).rejects.toMatchObject({ code: 'REQUEST_LIMIT' })
    finishFirst(true)
    await expect(Promise.all(accepted)).resolves.toEqual(Array(8).fill(true))
  })

  it('cleans a rejected prompt so the site can retry', async () => {
    await expect(session.coalesce(base, async () => { throw new Error('closed') }))
      .rejects.toThrow('closed')

    expect(session.pendingCount()).toBe(0)
    await expect(session.coalesce(base, async () => true)).resolves.toBe(true)
  })

  it('rejects incomplete scopes instead of creating ambiguous keys', () => {
    expect(permissionScopeKey({ ...base, origin: '' })).toBe(null)
    expect(permissionScopeKey({ ...base, method: '' })).toBe(null)
  })
})
