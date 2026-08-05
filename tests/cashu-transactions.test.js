import { beforeEach, describe, expect, it } from 'vitest'
import { getStore, resetStorage } from './setup.js'
import {
  getCashuTransactions,
  getCashuTx,
  recordCashuTx,
  reEncryptCashuTxHistory,
  updateCashuTx,
} from '../lib/cashu-transactions.js'

beforeEach(resetStorage)

describe('encrypted Cashu transaction history', () => {
  it('stores history encrypted and supports updates', async () => {
    const id = await recordCashuTx('wallet-a', {
      direction: 'out', amount: 21, description: 'Coffee', state: 'pending',
    }, 'password')

    expect(getStore()['cashuTxHistory_wallet-a'].encrypted).toBeTruthy()
    expect(JSON.stringify(getStore()['cashuTxHistory_wallet-a'])).not.toContain('Coffee')

    await updateCashuTx('wallet-a', id, { state: 'settled', feesPaid: 2 }, 'password')
    const { transactions } = await getCashuTransactions('wallet-a', {}, 'password')
    expect(transactions[0]).toMatchObject({
      payment_hash: id,
      state: 'settled',
      amount: 21_000,
      fees_paid: 2_000,
    })
  })

  it('migrates legacy plaintext history', async () => {
    getStore().cashuTxHistory_wallet_a = [{ payment_hash: 'legacy', amount: 1_000 }]
    const result = await getCashuTransactions('wallet_a', {}, 'password')
    expect(result.transactions[0].payment_hash).toBe('legacy')
    expect(getStore().cashuTxHistory_wallet_a.encrypted).toBeTruthy()
  })

  it('fails closed for a wrong password or corrupted vault', async () => {
    await recordCashuTx('wallet-a', { direction: 'in', amount: 5 }, 'password')
    await expect(getCashuTransactions('wallet-a', {}, 'wrong'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
    getStore()['cashuTxHistory_wallet-a'].encrypted += 'corruption'
    await expect(getCashuTransactions('wallet-a', {}, 'password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('survives password re-encryption', async () => {
    await recordCashuTx('wallet-a', { direction: 'in', amount: 8 }, 'old-password')
    await reEncryptCashuTxHistory('wallet-a', 'old-password', 'new-password')
    expect((await getCashuTransactions('wallet-a', {}, 'new-password')).transactions).toHaveLength(1)
    await expect(getCashuTransactions('wallet-a', {}, 'old-password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })

  it('uses a Lightning payment hash as an idempotency key', async () => {
    await recordCashuTx('wallet-a', {
      direction: 'out', amount: 21, state: 'pending', paymentHash: 'same-invoice',
    }, 'password')
    await recordCashuTx('wallet-a', {
      direction: 'out', amount: 21, state: 'pending', paymentHash: 'same-invoice',
    }, 'password')

    const { transactions } = await getCashuTransactions('wallet-a', {}, 'password')
    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({ payment_hash: 'same-invoice', state: 'pending' })
    expect(await getCashuTx('wallet-a', 'same-invoice', 'password'))
      .toMatchObject({ payment_hash: 'same-invoice' })
  })

  it('rejects malformed transaction records', async () => {
    await expect(recordCashuTx('wallet-a', {
      direction: 'sideways', amount: 1,
    }, 'password')).rejects.toThrow('Invalid Cashu transaction')
    await expect(recordCashuTx('wallet-a', {
      direction: 'in', amount: Number.MAX_SAFE_INTEGER,
    }, 'password')).rejects.toThrow('Invalid Cashu transaction')
  })
})
