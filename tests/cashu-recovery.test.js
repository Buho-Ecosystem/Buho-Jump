import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCashuRecovery,
  hasCashuRecovery,
  readCashuRecovery,
  reEncryptCashuRecovery,
  saveCashuRecovery,
} from '../lib/cashu-recovery.js'
import { getStore, resetStorage } from './setup.js'

const proof = { id: '0011223344556677', secret: 'protected', C: `02${'b'.repeat(64)}`, amount: 8 }

beforeEach(resetStorage)

describe('Cashu emergency recovery journal', () => {
  it('stores proof recovery data encrypted and clears it explicitly', async () => {
    await saveCashuRecovery('wallet', 'password', 'https://mint.example.com', [proof])

    expect(await hasCashuRecovery('wallet')).toBe(true)
    expect(JSON.stringify(getStore().cashuRecovery_wallet)).not.toContain('protected')
    expect(await readCashuRecovery('wallet', 'password')).toMatchObject({
      mint: 'https://mint.example.com',
      proofs: [{ secret: 'protected', amount: 8 }],
    })

    await clearCashuRecovery('wallet')
    expect(await hasCashuRecovery('wallet')).toBe(false)
  })

  it('survives password rotation and rejects the old password', async () => {
    await saveCashuRecovery('wallet', 'old-password', 'https://mint.example.com', [proof])
    await reEncryptCashuRecovery('wallet', 'old-password', 'new-password')

    expect(await readCashuRecovery('wallet', 'new-password')).toMatchObject({ proofs: [proof] })
    await expect(readCashuRecovery('wallet', 'old-password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })
})
