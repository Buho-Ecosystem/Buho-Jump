import { beforeEach, describe, expect, it } from 'vitest'
import { decryptData, encryptData } from '../lib/crypto.js'
import { exportCashuBackup, importCashuBackup } from '../lib/cashu-backup.js'
import { addCashuWallet } from '../lib/wallet.js'
import { resetStorage } from './setup.js'

const PASSWORD = 'backup-test-password'

beforeEach(resetStorage)

async function encryptedBackup(overrides = {}) {
  return encryptData({
    version: 2,
    walletId: 'wallet',
    name: 'Backup',
    mints: ['https://mint.example.com/'],
    unit: 'sat',
    proofSets: [{ mint: 'https://mint.example.com/', proofs: [] }],
    counters: {},
    exportedAt: 123,
    ...overrides,
  }, PASSWORD)
}

describe('Cashu backup validation', () => {
  it('backs up the private receiving key inside the encrypted version 3 file', async () => {
    const privateKey = 'ab'.repeat(32)
    const walletId = await addCashuWallet(
      'eCash', ['https://mint.example.com'], PASSWORD, 'account', privateKey,
    )
    const exported = await exportCashuBackup(walletId, PASSWORD)

    expect(exported.data).not.toContain(privateKey)
    expect(await decryptData(exported.data, PASSWORD)).toMatchObject({
      version: 3,
      cashuPrivkey: privateKey,
    })
    expect(await importCashuBackup(exported.data, PASSWORD))
      .toMatchObject({ cashuPrivkey: privateKey })
  })

  it('normalizes secure mint URLs before a restore', async () => {
    const parsed = await importCashuBackup(await encryptedBackup(), PASSWORD)
    expect(parsed.mints).toEqual(['https://mint.example.com'])
    expect(parsed.proofSets[0].mint).toBe('https://mint.example.com')
  })

  it('rejects insecure public mints and unsupported units', async () => {
    await expect(importCashuBackup(await encryptedBackup({
      mints: ['http://mint.example.com'],
    }), PASSWORD)).rejects.toThrow()

    await expect(importCashuBackup(await encryptedBackup({ unit: 'usd' }), PASSWORD))
      .rejects.toThrow('Unsupported Cashu backup unit')
  })

  it('rejects malformed proof sets before contacting a mint', async () => {
    await expect(importCashuBackup(await encryptedBackup({
      proofSets: [{ mint: 'https://mint.example.com', proofs: null }],
    }), PASSWORD)).rejects.toThrow('Invalid Cashu backup data')

    await expect(importCashuBackup(await encryptedBackup({
      proofSets: [{
        mint: 'https://mint.example.com',
        proofs: [{ id: 'id', amount: 1, secret: '', C: 'point' }],
      }],
    }), PASSWORD)).rejects.toThrow('Invalid Cashu backup data')
  })

  it('rejects a malformed private receiving key in a version 3 backup', async () => {
    await expect(importCashuBackup(await encryptedBackup({
      version: 3,
      cashuPrivkey: '00'.repeat(32),
    }), PASSWORD)).rejects.toThrow('Invalid Cashu backup receiving key')
  })

  it('rejects malformed deterministic counters', async () => {
    await expect(importCashuBackup(await encryptedBackup({
      counters: { keyset: -1 },
    }), PASSWORD)).rejects.toThrow('Invalid Cashu backup counters')
  })
})
