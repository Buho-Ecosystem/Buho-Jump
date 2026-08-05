import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCashuMintJournal,
  hasCashuMintJournal,
  listCashuMintQuotes,
  reEncryptCashuMintJournal,
  removeCashuMintQuote,
  saveCashuMintQuote,
} from '../lib/cashu-mint-journal.js'
import { getStore, resetStorage } from './setup.js'

const entry = {
  mint: 'https://mint.example.com/',
  quoteId: 'quote-id',
  amountSats: 21,
  expiry: 2_000_000_000,
}

beforeEach(resetStorage)

describe('Cashu deposit quote journal', () => {
  it('stores and removes incoming quotes without plaintext leakage', async () => {
    await saveCashuMintQuote('wallet', 'password', entry)

    expect(await hasCashuMintJournal('wallet')).toBe(true)
    expect(JSON.stringify(getStore().cashuMintJournal_wallet)).not.toContain('quote-id')
    expect(await listCashuMintQuotes('wallet', 'password')).toMatchObject([{
      ...entry,
      mint: 'https://mint.example.com',
    }])

    await removeCashuMintQuote('wallet', 'password', entry.quoteId)
    expect(await hasCashuMintJournal('wallet')).toBe(false)
  })

  it('survives password rotation and fails closed with the old password', async () => {
    await saveCashuMintQuote('wallet', 'old-password', entry)
    await reEncryptCashuMintJournal('wallet', 'old-password', 'new-password')

    expect(await listCashuMintQuotes('wallet', 'new-password')).toHaveLength(1)
    await expect(listCashuMintQuotes('wallet', 'old-password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('rejects insecure mint URLs and supports explicit clearing', async () => {
    await expect(saveCashuMintQuote('wallet', 'password', {
      ...entry, mint: 'http://mint.example.com',
    })).rejects.toThrow()
    await clearCashuMintJournal('wallet')
    expect(await listCashuMintQuotes('wallet', 'password')).toEqual([])
  })
})
