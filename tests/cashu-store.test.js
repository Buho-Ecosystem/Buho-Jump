import { beforeEach, describe, expect, it } from 'vitest'
import { encryptData } from '../lib/crypto.js'
import {
  addProofs,
  createCashuCounterSource,
  getAllProofs,
  getCashuBalance,
  getProofSets,
  getRelayMintStates,
  readProofStore,
  reEncryptProofStore,
  removeProofs,
  setRelayEventIds,
} from '../lib/cashu-store.js'
import { getStore, resetStorage } from './setup.js'

const PASSWORD = 'test-password'
const MINT_A = 'https://mint-a.example.com'
const MINT_B = 'https://mint-b.example.com'

function proof(secret, amount = 1) {
  return { id: '0011223344556677', secret, C: `02${'a'.repeat(64)}`, amount }
}

beforeEach(resetStorage)

describe('mint-aware Cashu proof storage', () => {
  it('keeps proofs and balances isolated by mint', async () => {
    await addProofs('wallet', [proof('mint-a', 4)], PASSWORD, MINT_A)
    await addProofs('wallet', [proof('mint-b', 8)], PASSWORD, MINT_B)

    expect(await getAllProofs('wallet', PASSWORD, MINT_A)).toMatchObject([{ secret: 'mint-a', amount: 4 }])
    expect(await getAllProofs('wallet', PASSWORD, MINT_B)).toMatchObject([{ secret: 'mint-b', amount: 8 }])
    expect(await getCashuBalance('wallet', PASSWORD)).toBe(12)
  })

  it('deduplicates proof secrets across all mints', async () => {
    await addProofs('wallet', [proof('same', 2)], PASSWORD, MINT_A)
    await addProofs('wallet', [proof('same', 2)], PASSWORD, MINT_B)

    const sets = await getProofSets('wallet', PASSWORD)
    expect(sets).toHaveLength(1)
    expect(sets[0].mint).toBe(MINT_A)
  })

  it('retains relay cleanup state after the last proof is spent', async () => {
    const eventId = 'f'.repeat(64)
    await addProofs('wallet', [proof('spent', 2)], PASSWORD, MINT_A)
    await setRelayEventIds('wallet', PASSWORD, MINT_A, [eventId])
    await removeProofs('wallet', ['spent'], PASSWORD)

    expect(await getProofSets('wallet', PASSWORD)).toEqual([])
    expect(await getRelayMintStates('wallet', PASSWORD)).toEqual([{
      mint: MINT_A,
      eventIds: [eventId],
    }])
  })

  it('migrates a legacy proof store only when its configured mint is known', async () => {
    getStore().cashuProofs_wallet = {
      encrypted: await encryptData({ proofs: [proof('legacy', '16')], lastSyncedAt: 10 }, PASSWORD),
    }

    const migrated = await readProofStore('wallet', PASSWORD, MINT_A)
    expect(migrated.version).toBe(2)
    expect(migrated.proofSets[0]).toMatchObject({ mint: MINT_A })
    expect(migrated.proofSets[0].proofs[0].amount).toBe(16)
  })

  it('allocates deterministic counters without overlap under concurrency', async () => {
    const source = createCashuCounterSource('wallet', PASSWORD)
    const ranges = await Promise.all([
      source.reserve('keyset', 3),
      source.reserve('keyset', 2),
      source.reserve('keyset', 4),
    ])

    expect(ranges).toEqual([
      { start: 0, count: 3 },
      { start: 3, count: 2 },
      { start: 5, count: 4 },
    ])
    expect(await source.snapshot()).toEqual({ keyset: 9 })
  })

  it('keeps deterministic counters separate for identical keyset IDs at different mints', async () => {
    const mintA = createCashuCounterSource('wallet', PASSWORD, MINT_A)
    const mintB = createCashuCounterSource('wallet', PASSWORD, MINT_B)

    expect(await mintA.reserve('same-keyset', 5)).toEqual({ start: 0, count: 5 })
    expect(await mintB.reserve('same-keyset', 2)).toEqual({ start: 0, count: 2 })
    expect(await mintA.snapshot()).toEqual({ 'same-keyset': 5 })
    expect(await mintB.snapshot()).toEqual({ 'same-keyset': 2 })
  })

  it('preserves deterministic counters during password rotation even with zero balance', async () => {
    const source = createCashuCounterSource('wallet', PASSWORD, MINT_A)
    await source.reserve('keyset', 7)

    await reEncryptProofStore('wallet', PASSWORD, 'new-password', MINT_A)
    const rotated = createCashuCounterSource('wallet', 'new-password', MINT_A)
    expect(await rotated.reserve('keyset', 1)).toEqual({ start: 7, count: 1 })
  })

  it('fails closed for the wrong password or corrupted encrypted data', async () => {
    await addProofs('wallet', [proof('safe', 1)], PASSWORD, MINT_A)
    await expect(getProofSets('wallet', 'wrong-password'))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })

    getStore().cashuProofs_wallet.encrypted += 'corrupt'
    await expect(getProofSets('wallet', PASSWORD))
      .rejects.toMatchObject({ code: 'VAULT_INTEGRITY' })
  })
})
