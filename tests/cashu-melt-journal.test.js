import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCashuMeltJournal,
  hasCashuMeltJournal,
  readCashuMeltJournal,
  reEncryptCashuMeltJournal,
  saveCashuMeltJournal,
} from '../lib/cashu-melt-journal.js'
import { getStore, resetStorage } from './setup.js'

const entry = {
  mint: 'https://mint.example.com',
  quoteId: 'quote-id',
  inputSecrets: ['proof-secret'],
  outputData: [{ blindedMessage: { amount: 1, id: 'id', B_: 'point' }, blindingFactor: '1', secret: '00' }],
  amountSats: 7,
  inputTotal: 9,
  transactionId: 'payment-hash',
}

beforeEach(resetStorage)

describe('Cashu pending payment journal', () => {
  it('stores payment recovery data encrypted until explicitly cleared', async () => {
    await saveCashuMeltJournal('wallet', 'password', entry)

    expect(await hasCashuMeltJournal('wallet')).toBe(true)
    expect(JSON.stringify(getStore().cashuMeltJournal_wallet)).not.toContain('proof-secret')
    expect(await readCashuMeltJournal('wallet', 'password')).toMatchObject(entry)

    await clearCashuMeltJournal('wallet')
    expect(await hasCashuMeltJournal('wallet')).toBe(false)
  })

  it('survives password rotation and fails closed with the previous password', async () => {
    await saveCashuMeltJournal('wallet', 'old-password', entry)
    await reEncryptCashuMeltJournal('wallet', 'old-password', 'new-password')

    expect(await readCashuMeltJournal('wallet', 'new-password')).toMatchObject(entry)
    await expect(readCashuMeltJournal('wallet', 'old-password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })
})
