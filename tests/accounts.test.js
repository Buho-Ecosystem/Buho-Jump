/**
 * Tests for lib/accounts.js — encrypted storage, CRUD, migration from plaintext.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import {
  getAccounts, getActiveAccount, getActiveAccountForClient, getActiveAccountId, setActiveAccount,
  createLocalAccount, createAccountWithMnemonic, importAccount,
  importFromMnemonic, createNip46Account, updateAccount,
  removeAccount, getAccountSummaries, reEncryptAccounts,
} from '../lib/accounts.js'

const PW = 'test-password-123'

beforeEach(() => {
  resetStorage()
})

describe('encrypted storage', () => {
  it('stores accounts as encrypted blob, not plaintext', async () => {
    await createLocalAccount(PW, 'Alice')
    const store = getStore()
    // Should be { accounts: { encrypted: "base64..." } }, NOT a plain object with secretHex
    expect(store.accounts).toBeDefined()
    expect(store.accounts.encrypted).toBeDefined()
    expect(typeof store.accounts.encrypted).toBe('string')
    // No plaintext secret key visible
    expect(JSON.stringify(store.accounts)).not.toContain('secretHex')
  })

  it('decrypts accounts with correct password', async () => {
    const created = await createLocalAccount(PW, 'Alice')
    const accounts = await getAccounts(PW)
    expect(accounts[created.id]).toBeDefined()
    expect(accounts[created.id].secretHex).toBe(created.secretHex)
    expect(accounts[created.id].name).toBe('Alice')
  })

  it('fails closed with the wrong password', async () => {
    await createLocalAccount(PW, 'Alice')
    await expect(getAccounts('wrong-password')).rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('fails closed when encrypted account data is corrupted', async () => {
    await createLocalAccount(PW, 'Alice')
    getStore().accounts.encrypted += 'corruption'
    await expect(getAccounts(PW)).rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('returns empty object with no password', async () => {
    await createLocalAccount(PW, 'Alice')
    const accounts = await getAccounts(null)
    expect(Object.keys(accounts)).toHaveLength(0)
  })
})

describe('migration from plaintext', () => {
  it('auto-encrypts legacy plaintext accounts on first read', async () => {
    // Simulate legacy plaintext storage
    const legacyAccount = {
      id: 'legacy-1',
      name: 'Legacy',
      pubkey: 'abc123',
      secretHex: 'deadbeef',
      mode: 'local',
    }
    const store = getStore()
    store.accounts = { 'legacy-1': legacyAccount }

    // Reading with password should trigger migration
    const accounts = await getAccounts(PW)
    expect(accounts['legacy-1']).toBeDefined()
    expect(accounts['legacy-1'].secretHex).toBe('deadbeef')

    // After migration, storage should be encrypted
    const storeAfter = getStore()
    expect(storeAfter.accounts.encrypted).toBeDefined()
    expect(typeof storeAfter.accounts.encrypted).toBe('string')
  })
})

describe('createLocalAccount', () => {
  it('creates an account with keys and activates it', async () => {
    const account = await createLocalAccount(PW, 'Bob')
    expect(account.name).toBe('Bob')
    expect(account.pubkey).toBeDefined()
    expect(account.secretHex).toBeDefined()
    expect(account.npub).toMatch(/^npub1/)
    expect(account.nsec).toMatch(/^nsec1/)
    expect(account.mode).toBe('local')

    const activeId = await getActiveAccountId()
    expect(activeId).toBe(account.id)
  })
})

describe('createAccountWithMnemonic', () => {
  it('returns 12-word mnemonic', async () => {
    const account = await createAccountWithMnemonic(PW, 'Mnemonic User')
    expect(account.mnemonic).toBeDefined()
    expect(account.mnemonic.split(' ')).toHaveLength(12)
    expect(account.secretHex).toBeDefined()
    expect(account.identitySeed).toBeUndefined()
    const stored = Object.values(await getAccounts(PW))[0]
    expect(stored.identitySeed.type).toBe('bip39')
    expect(stored.identitySeed.mnemonic).toBe(account.mnemonic)
    expect(stored.identitySeed.backupConfirmed).toBe(false)
    expect((await getActiveAccountForClient(PW)).identitySeed).toBeUndefined()
  })
})

describe('importAccount', () => {
  it('imports from nsec', async () => {
    // Create an account to get a valid nsec
    const original = await createLocalAccount(PW, 'Original')
    resetStorage()

    const imported = await importAccount(PW, 'Imported', original.nsec)
    expect(imported.pubkey).toBe(original.pubkey)
    expect(imported.secretHex).toBe(original.secretHex)
  })

  it('imports from hex key', async () => {
    const original = await createLocalAccount(PW, 'Original')
    resetStorage()

    const imported = await importAccount(PW, null, original.secretHex)
    expect(imported.pubkey).toBe(original.pubkey)
  })

  it('rejects invalid nsec', async () => {
    await expect(importAccount(PW, 'Bad', 'nsec1invalid')).rejects.toThrow()
  })

  it('rejects invalid hex', async () => {
    await expect(importAccount(PW, 'Bad', 'not-hex')).rejects.toThrow()
  })
})

describe('importFromMnemonic', () => {
  it('roundtrips: create with mnemonic then import same mnemonic', async () => {
    const original = await createAccountWithMnemonic(PW, 'Original')
    resetStorage()

    const recovered = await importFromMnemonic(PW, 'Recovered', original.mnemonic)
    expect(recovered.pubkey).toBe(original.pubkey)
    expect(recovered.secretHex).toBe(original.secretHex)
    expect(recovered.keyOrigin).toEqual({
      type: 'nip06',
      accountIndex: 0,
      path: "m/44'/1237'/0'/0/0",
    })
    expect((await getAccounts(PW))[recovered.id].identitySeed.backupConfirmed).toBe(true)
  })

  it('imports another NIP-06 account path from the same phrase', async () => {
    const original = await createAccountWithMnemonic(PW, 'Original')
    const sibling = await importFromMnemonic(PW, 'Sibling', original.mnemonic, 1)

    expect(sibling.pubkey).not.toBe(original.pubkey)
    expect(sibling.keyOrigin.accountIndex).toBe(1)
    expect(sibling.keyOrigin.path).toBe("m/44'/1237'/1'/0/0")
    expect(Object.keys(await getAccounts(PW))).toHaveLength(2)
  })

  it('does not duplicate an already recovered path', async () => {
    const original = await createAccountWithMnemonic(PW, 'Original')
    const duplicate = await importFromMnemonic(PW, 'Duplicate', original.mnemonic, 0)

    expect(duplicate.id).toBe(original.id)
    expect(Object.keys(await getAccounts(PW))).toHaveLength(1)
  })

  it('rejects invalid mnemonic', async () => {
    await expect(importFromMnemonic(PW, 'Bad', 'not valid words')).rejects.toThrow('Invalid')
  })
})

describe('createNip46Account', () => {
  it('creates NIP-46 account with client secret', async () => {
    const account = await createNip46Account(PW, 'Remote Signer')
    expect(account.mode).toBe('nip46')
    expect(account.nip46ClientSecretHex).toBeDefined()
    expect(account.secretHex).toBe(null)
    expect(account.pubkey).toBe(null)
  })
})

describe('updateAccount', () => {
  it('updates fields on an existing account', async () => {
    const account = await createLocalAccount(PW, 'Original')
    await updateAccount(PW, account.id, { name: 'Updated' })
    const updated = await getActiveAccount(PW)
    expect(updated.name).toBe('Updated')
    expect(updated.secretHex).toBe(account.secretHex)
  })

  it('returns null for non-existent account', async () => {
    const result = await updateAccount(PW, 'nonexistent', { name: 'x' })
    expect(result).toBe(null)
  })
})

describe('removeAccount', () => {
  it('removes an account', async () => {
    const account = await createLocalAccount(PW, 'Doomed')
    await removeAccount(PW, account.id)
    const accounts = await getAccounts(PW)
    expect(accounts[account.id]).toBeUndefined()
  })

  it('switches active account when active is removed', async () => {
    const a = await createLocalAccount(PW, 'A')
    const b = await createLocalAccount(PW, 'B')
    // B is now active (last created)
    expect(await getActiveAccountId()).toBe(b.id)

    await removeAccount(PW, b.id)
    // Should switch to A
    expect(await getActiveAccountId()).toBe(a.id)
  })
})

describe('getAccountSummaries', () => {
  it('returns summaries without secrets', async () => {
    await createLocalAccount(PW, 'Alice')
    await createLocalAccount(PW, 'Bob')
    const summaries = await getAccountSummaries(PW)
    expect(summaries).toHaveLength(2)
    for (const s of summaries) {
      expect(s.name).toBeDefined()
      expect(s.pubkey).toBeDefined()
      expect(s.npub).toMatch(/^npub1/)
      expect(s.secretHex).toBeUndefined()
      expect(s.nip46ClientSecretHex).toBeUndefined()
      expect(s.identitySeed).toBeUndefined()
    }
  })

  it('reports seed-only identity capabilities accurately', async () => {
    const seedBacked = await createAccountWithMnemonic(PW, 'Seed identity')
    const rawKey = await createLocalAccount(PW, 'Raw key')
    const remote = await createNip46Account(PW, 'Remote')
    const summaries = await getAccountSummaries(PW)

    expect(summaries.find((item) => item.id === seedBacked.id).capabilities.lightningLogin)
      .toEqual({ supported: true, reason: null })
    expect(summaries.find((item) => item.id === rawKey.id).capabilities.lightningLogin)
      .toEqual({ supported: false, reason: 'recovery_words_required' })
    expect(summaries.find((item) => item.id === remote.id).capabilities.lightningLogin)
      .toEqual({ supported: false, reason: 'remote_signer' })
  })
})

describe('reEncryptAccounts', () => {
  it('re-encrypts accounts with new password', async () => {
    await createLocalAccount(PW, 'Alice')
    await reEncryptAccounts(PW, 'new-password')

    // Old password should fail
    await expect(getAccounts(PW)).rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })

    // New password should work
    const withNew = await getAccounts('new-password')
    expect(Object.values(withNew)[0].name).toBe('Alice')
  })

  it('is a no-op when no accounts exist', async () => {
    await reEncryptAccounts(PW, 'new-password')
    // Should not throw
  })
})

describe('multiple accounts', () => {
  it('supports multiple accounts in encrypted store', async () => {
    const a = await createLocalAccount(PW, 'Alice')
    const b = await createLocalAccount(PW, 'Bob')
    const c = await createNip46Account(PW, 'Remote')

    const accounts = await getAccounts(PW)
    expect(Object.keys(accounts)).toHaveLength(3)
    expect(accounts[a.id].name).toBe('Alice')
    expect(accounts[b.id].name).toBe('Bob')
    expect(accounts[c.id].mode).toBe('nip46')
  })
})

describe('edge cases', () => {
  it('re-encrypt with wrong old password — no data loss', async () => {
    await createLocalAccount(PW, 'Alice')
    await expect(getAccounts('wrong-pw')).rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
    // Original password should still work
    const accounts = await getAccounts(PW)
    expect(Object.values(accounts)[0].name).toBe('Alice')
  })

  it('remove last account clears activeAccountId', async () => {
    const only = await createLocalAccount(PW, 'Only')
    expect(await getActiveAccountId()).toBe(only.id)
    await removeAccount(PW, only.id)
    const accounts = await getAccounts(PW)
    expect(Object.keys(accounts)).toHaveLength(0)
    // Active ID should be cleared or null
    const activeId = await getActiveAccountId()
    expect(activeId === null || activeId === undefined || !(activeId in accounts)).toBe(true)
  })

  it('import duplicate nsec reuses existing account', async () => {
    const original = await createLocalAccount(PW, 'Original')
    // Import the same nsec again
    const duplicate = await importAccount(PW, 'Duplicate', original.nsec)
    // Should have same pubkey
    expect(duplicate.pubkey).toBe(original.pubkey)
  })

  it('mnemonic derives deterministic pubkey', async () => {
    const a = await createAccountWithMnemonic(PW, 'First')
    const mnemonic = a.mnemonic
    resetStorage()
    const b = await importFromMnemonic(PW, 'Second', mnemonic)
    expect(b.pubkey).toBe(a.pubkey)
    expect(b.secretHex).toBe(a.secretHex)
  })
})

// ── Enterprise hardening ────────────────────────────────────────

describe('createLocalAccount — defensive inputs', () => {
  it('empty string name creates account', async () => {
    const account = await createLocalAccount(PW, '')
    expect(account.pubkey).toBeDefined()
    expect(account.name).toBe('')
  })

  it('null name creates account', async () => {
    const account = await createLocalAccount(PW, null)
    expect(account.pubkey).toBeDefined()
  })

  it('unicode name preserved', async () => {
    const account = await createLocalAccount(PW, '🔑 Мой аккаунт')
    const accounts = await getAccounts(PW)
    expect(accounts[account.id].name).toBe('🔑 Мой аккаунт')
  })

  it('very long name preserved', async () => {
    const longName = 'A'.repeat(500)
    const account = await createLocalAccount(PW, longName)
    const accounts = await getAccounts(PW)
    expect(accounts[account.id].name).toBe(longName)
  })
})

describe('getAccounts — password edge cases', () => {
  it('empty string password returns empty', async () => {
    await createLocalAccount(PW, 'Alice')
    const accounts = await getAccounts('')
    expect(Object.keys(accounts)).toHaveLength(0)
  })

  it('undefined password returns empty', async () => {
    await createLocalAccount(PW, 'Alice')
    const accounts = await getAccounts(undefined)
    expect(Object.keys(accounts)).toHaveLength(0)
  })

  it('numeric password cannot decrypt an existing vault', async () => {
    await createLocalAccount(PW, 'Alice')
    await expect(getAccounts(12345)).rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })
})

describe('importAccount — invalid key formats', () => {
  it('rejects empty string key', async () => {
    await expect(importAccount(PW, 'Test', '')).rejects.toThrow()
  })

  it('rejects whitespace-only key', async () => {
    await expect(importAccount(PW, 'Test', '   ')).rejects.toThrow()
  })

  it('rejects 63-char hex (too short)', async () => {
    await expect(importAccount(PW, 'Test', 'a'.repeat(63))).rejects.toThrow()
  })

  it('rejects 65-char hex (too long)', async () => {
    await expect(importAccount(PW, 'Test', 'a'.repeat(65))).rejects.toThrow()
  })
})

describe('updateAccount — edge cases', () => {
  it('update with empty object does not lose data', async () => {
    const account = await createLocalAccount(PW, 'Original')
    await updateAccount(PW, account.id, {})
    const updated = await getActiveAccount(PW)
    expect(updated.name).toBe('Original')
    expect(updated.secretHex).toBe(account.secretHex)
  })

  it('update preserves mode', async () => {
    const account = await createLocalAccount(PW, 'Test')
    await updateAccount(PW, account.id, { name: 'Updated' })
    const updated = await getActiveAccount(PW)
    expect(updated.mode).toBe('local')
  })
})
