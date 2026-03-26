/**
 * Tests for lib/accountSwitch.js — atomic account switch with cleanup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import { performAccountSwitch } from '../lib/accountSwitch.js'
import { createLocalAccount } from '../lib/accounts.js'

const PW = 'switch-test-pw-123'

beforeEach(() => {
  resetStorage()
})

describe('performAccountSwitch', () => {
  it('sets the new active account in storage', async () => {
    const acct1 = await createLocalAccount(PW, 'Account 1')
    const acct2 = await createLocalAccount(PW, 'Account 2')

    await performAccountSwitch(acct1.id, {
      nwcClient: null,
      nwcNotifUnsub: null,
      remoteSigner: null,
    })

    expect(getStore().activeAccountId).toBe(acct1.id)
  })

  it('returns nulled state refs', async () => {
    const acct = await createLocalAccount(PW, 'Test')

    const result = await performAccountSwitch(acct.id, {
      nwcClient: { close: vi.fn() },
      nwcNotifUnsub: vi.fn(),
      remoteSigner: { close: vi.fn() },
    })

    expect(result.nwcClient).toBeNull()
    expect(result.nwcNotifUnsub).toBeNull()
    expect(result.remoteSigner).toBeNull()
  })

  it('calls close() on NWC client', async () => {
    const acct = await createLocalAccount(PW, 'Test')
    const closeFn = vi.fn()

    await performAccountSwitch(acct.id, {
      nwcClient: { close: closeFn },
      nwcNotifUnsub: null,
      remoteSigner: null,
    })

    expect(closeFn).toHaveBeenCalledOnce()
  })

  it('calls nwcNotifUnsub cleanup function', async () => {
    const acct = await createLocalAccount(PW, 'Test')
    const unsubFn = vi.fn()

    await performAccountSwitch(acct.id, {
      nwcClient: null,
      nwcNotifUnsub: unsubFn,
      remoteSigner: null,
    })

    expect(unsubFn).toHaveBeenCalledOnce()
  })

  it('calls close() on remote signer', async () => {
    const acct = await createLocalAccount(PW, 'Test')
    const closeFn = vi.fn()

    await performAccountSwitch(acct.id, {
      nwcClient: null,
      nwcNotifUnsub: null,
      remoteSigner: { close: closeFn },
    })

    expect(closeFn).toHaveBeenCalledOnce()
  })

  it('handles cleanup errors gracefully', async () => {
    const acct = await createLocalAccount(PW, 'Test')

    // All cleanup functions throw — should not prevent switch
    const result = await performAccountSwitch(acct.id, {
      nwcClient: { close: () => { throw new Error('close fail') } },
      nwcNotifUnsub: () => { throw new Error('unsub fail') },
      remoteSigner: { close: () => { throw new Error('signer fail') } },
    })

    expect(result.nwcClient).toBeNull()
    expect(getStore().activeAccountId).toBe(acct.id)
  })

  it('works with all-null dependencies', async () => {
    const acct = await createLocalAccount(PW, 'Test')

    const result = await performAccountSwitch(acct.id, {
      nwcClient: null,
      nwcNotifUnsub: null,
      remoteSigner: null,
    })

    expect(result.nwcClient).toBeNull()
    expect(getStore().activeAccountId).toBe(acct.id)
  })
})
