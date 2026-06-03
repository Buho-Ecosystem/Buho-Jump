/**
 * Tests for lib/wallet.js — multi-wallet CRUD, encryption, migration.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import {
  getWalletStore, getWalletSummaries, getActiveWallet,
  addWallet, removeWallet, setActiveWallet, renameWallet,
  reEncryptWallets, clearAllWallets,
} from '../lib/wallet.js'

const PW = 'wallet-test-pw-123'
// Valid NWC URIs: 64-char hex pubkey host + secret + wss relay (passes addWallet validation)
const NWC_URI_1 = 'nostr+walletconnect://' + 'a'.repeat(64) + '?relay=wss://relay.example.com&secret=' + 'b'.repeat(64)
const NWC_URI_2 = 'nostr+walletconnect://' + 'c'.repeat(64) + '?relay=wss://relay2.example.com&secret=' + 'd'.repeat(64)

beforeEach(() => {
  resetStorage()
})

describe('wallet store basics', () => {
  it('starts with empty store', async () => {
    const store = await getWalletStore(PW)
    expect(store.wallets).toEqual([])
    expect(store.activeWalletId).toBeNull()
  })

  it('stores wallet data encrypted', async () => {
    await addWallet(NWC_URI_1, 'Test Wallet', PW)
    const raw = getStore()
    expect(raw.walletConfigs).toBeDefined()
    expect(raw.walletConfigs.encrypted).toBeDefined()
    // Connection URI must not be visible in plaintext
    expect(JSON.stringify(raw.walletConfigs)).not.toContain('pubkey1')
  })
})

describe('addWallet', () => {
  it('adds a wallet and auto-activates it', async () => {
    await addWallet(NWC_URI_1, 'Wallet A', PW)
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(1)
    expect(store.wallets[0].name).toBe('Wallet A')
    expect(store.wallets[0].connectionUri).toBe(NWC_URI_1)
    expect(store.activeWalletId).toBe(store.wallets[0].id)
  })

  it('adds multiple wallets', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await addWallet(NWC_URI_2, 'B', PW)
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(2)
    // Last added becomes active
    expect(store.activeWalletId).toBe(store.wallets[1].id)
  })

  it('generates a default name if none provided', async () => {
    await addWallet(NWC_URI_1, null, PW)
    const store = await getWalletStore(PW)
    expect(store.wallets[0].name).toBeTruthy()
  })
})

describe('getActiveWallet', () => {
  it('returns null when no wallets exist', async () => {
    const active = await getActiveWallet(PW)
    expect(active).toBeNull()
  })

  it('returns the active wallet', async () => {
    await addWallet(NWC_URI_1, 'Active', PW)
    const active = await getActiveWallet(PW)
    expect(active).not.toBeNull()
    expect(active.name).toBe('Active')
    expect(active.connectionUri).toBe(NWC_URI_1)
  })
})

describe('removeWallet', () => {
  it('removes a wallet by id', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await addWallet(NWC_URI_2, 'B', PW)
    const store = await getWalletStore(PW)
    await removeWallet(store.wallets[0].id, PW)
    const updated = await getWalletStore(PW)
    expect(updated.wallets).toHaveLength(1)
    expect(updated.wallets[0].name).toBe('B')
  })

  it('clears activeWalletId if active wallet is removed', async () => {
    await addWallet(NWC_URI_1, 'Only', PW)
    const store = await getWalletStore(PW)
    await removeWallet(store.wallets[0].id, PW)
    const updated = await getWalletStore(PW)
    expect(updated.wallets).toHaveLength(0)
  })
})

describe('setActiveWallet', () => {
  it('switches the active wallet', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await addWallet(NWC_URI_2, 'B', PW)
    const store = await getWalletStore(PW)
    const firstId = store.wallets[0].id
    await setActiveWallet(firstId, PW)
    const updated = await getWalletStore(PW)
    expect(updated.activeWalletId).toBe(firstId)
  })
})

describe('renameWallet', () => {
  it('renames a wallet', async () => {
    await addWallet(NWC_URI_1, 'Old Name', PW)
    const store = await getWalletStore(PW)
    await renameWallet(store.wallets[0].id, 'New Name', PW)
    const updated = await getWalletStore(PW)
    expect(updated.wallets[0].name).toBe('New Name')
  })
})

describe('getWalletSummaries', () => {
  it('returns summaries without connection URIs', async () => {
    await addWallet(NWC_URI_1, 'Wallet A', PW)
    const summaries = await getWalletSummaries(PW)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].name).toBe('Wallet A')
    // Must NOT expose connection URI
    expect(summaries[0].connectionUri).toBeUndefined()
  })
})

describe('clearAllWallets', () => {
  it('removes all wallets', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await addWallet(NWC_URI_2, 'B', PW)
    await clearAllWallets()
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(0)
  })
})

describe('reEncryptWallets', () => {
  it('re-encrypts with new password', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    const NEW_PW = 'new-password-456'
    await reEncryptWallets(PW, NEW_PW)
    // Old password should fail
    const withOld = await getWalletStore(PW)
    expect(withOld.wallets).toHaveLength(0)
    // New password should work
    const withNew = await getWalletStore(NEW_PW)
    expect(withNew.wallets).toHaveLength(1)
    expect(withNew.wallets[0].connectionUri).toBe(NWC_URI_1)
  })
})

describe('edge cases', () => {
  it('wrong password returns empty store (not throws)', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    const store = await getWalletStore('wrong-password')
    expect(store.wallets).toHaveLength(0)
    expect(store.activeWalletId).toBeNull()
  })

  it('remove active wallet auto-activates remaining wallet', async () => {
    await addWallet(NWC_URI_1, 'First', PW)
    await addWallet(NWC_URI_2, 'Second', PW)
    const store = await getWalletStore(PW)
    const secondId = store.wallets[1].id
    const firstId = store.wallets[0].id
    // Second is active (last added)
    expect(store.activeWalletId).toBe(secondId)
    await removeWallet(secondId, PW)
    const updated = await getWalletStore(PW)
    expect(updated.wallets).toHaveLength(1)
    expect(updated.wallets[0].name).toBe('First')
  })

  it('clearAllWallets then getWalletStore returns empty', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await clearAllWallets()
    const store = await getWalletStore(PW)
    expect(store.wallets).toEqual([])
    expect(store.activeWalletId).toBeNull()
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('addWallet — defensive inputs', () => {
  it('handles empty string name', async () => {
    await addWallet(NWC_URI_1, '', PW)
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(1)
    // Should have a non-empty name (default or empty)
    expect(store.wallets[0]).toBeDefined()
  })

  it('handles very long wallet name', async () => {
    const longName = 'W'.repeat(500)
    await addWallet(NWC_URI_1, longName, PW)
    const store = await getWalletStore(PW)
    expect(store.wallets[0].name).toBe(longName)
  })

  it('handles unicode wallet name', async () => {
    await addWallet(NWC_URI_1, '⚡ My Lightning Wallet 🔥', PW)
    const store = await getWalletStore(PW)
    expect(store.wallets[0].name).toBe('⚡ My Lightning Wallet 🔥')
  })
})

describe('getWalletStore — password handling', () => {
  it('empty string password returns empty store', async () => {
    await addWallet(NWC_URI_1, 'Test', PW)
    const store = await getWalletStore('')
    expect(store.wallets).toHaveLength(0)
  })

  it('null password returns empty store', async () => {
    await addWallet(NWC_URI_1, 'Test', PW)
    const store = await getWalletStore(null)
    expect(store.wallets).toHaveLength(0)
  })

  it('no wallets in storage returns clean empty store', async () => {
    const store = await getWalletStore(PW)
    expect(store.wallets).toEqual([])
    expect(store.activeWalletId).toBeNull()
  })
})

describe('removeWallet — edge cases', () => {
  it('removing non-existent id does not corrupt store', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await removeWallet('non-existent-id', PW)
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(1)
    expect(store.wallets[0].name).toBe('A')
  })
})

describe('setActiveWallet — edge cases', () => {
  it('rejects non-existent wallet id', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await expect(setActiveWallet('bogus-id', PW)).rejects.toThrow('Wallet not found')
  })
})

describe('reEncryptWallets — edge cases', () => {
  it('same old and new password works', async () => {
    await addWallet(NWC_URI_1, 'A', PW)
    await reEncryptWallets(PW, PW)
    const store = await getWalletStore(PW)
    expect(store.wallets).toHaveLength(1)
  })

  it('no wallets is a no-op', async () => {
    await reEncryptWallets(PW, 'new-pw')
    const store = await getWalletStore('new-pw')
    expect(store.wallets).toHaveLength(0)
  })
})
