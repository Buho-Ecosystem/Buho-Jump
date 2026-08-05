import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage, getStore } from './setup.js'
import {
  saveTransactionMetadata,
  getTransactionMetadata,
  enrichTransactionsWithMetadata,
  reEncryptTransactionMetadata,
} from '../lib/transactionMetadata.js'

beforeEach(resetStorage)

describe('encrypted transaction metadata', () => {
  it('stores only sanitized fields and enriches matching transactions', async () => {
    await saveTransactionMetadata('pw', 'account-a', 'wallet-a', 'hash-1', {
      recipientName: 'Ada',
      successAction: { tag: 'message', message: 'x'.repeat(200) },
      unknownSecret: 'drop me',
    })
    const metadata = await getTransactionMetadata('pw', 'account-a', 'wallet-a', 'hash-1')
    expect(metadata.recipientName).toBe('Ada')
    expect(metadata.successAction.message).toHaveLength(144)
    expect(metadata.unknownSecret).toBeUndefined()
    expect(getStore().transactionMetadata.encrypted).toBeTruthy()

    const txs = await enrichTransactionsWithMetadata('pw', 'account-a', 'wallet-a', [{ payment_hash: 'hash-1' }])
    expect(txs[0].metadata.recipientName).toBe('Ada')
  })

  it('does not leak metadata between accounts or wallets', async () => {
    await saveTransactionMetadata('pw', 'account-a', 'wallet-a', 'same-hash', { recipientName: 'A' })
    expect(await getTransactionMetadata('pw', 'account-b', 'wallet-a', 'same-hash')).toBeNull()
    expect(await getTransactionMetadata('pw', 'account-a', 'wallet-b', 'same-hash')).toBeNull()
  })

  it('survives password re-encryption', async () => {
    await saveTransactionMetadata('old', 'account-a', 'wallet-a', 'hash-1', { personalNote: 'Lunch' })
    await reEncryptTransactionMetadata('old', 'new')
    expect((await getTransactionMetadata('new', 'account-a', 'wallet-a', 'hash-1')).personalNote).toBe('Lunch')
    await expect(getTransactionMetadata('old', 'account-a', 'wallet-a', 'hash-1'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('fails closed when encrypted metadata is corrupted', async () => {
    await saveTransactionMetadata('pw', 'account-a', 'wallet-a', 'hash-1', { personalNote: 'Lunch' })
    getStore().transactionMetadata.encrypted += 'corruption'
    await expect(getTransactionMetadata('pw', 'account-a', 'wallet-a', 'hash-1'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })
})
