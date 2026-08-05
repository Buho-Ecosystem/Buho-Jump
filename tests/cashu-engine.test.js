import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllProofs } from '../lib/cashu-store.js'
import { hasCashuMeltJournal } from '../lib/cashu-melt-journal.js'
import { resetStorage } from './setup.js'

const cashuMock = vi.hoisted(() => ({
  instances: [],
  encodedToken: null,
  tokenMetadata: { mint: 'https://mint.example.com', unit: 'sat', amount: 5 },
  requestOptions: null,
  behavior: {},
}))

vi.mock('@cashu/cashu-ts', () => {
  class Wallet {
    constructor(mint, options) {
      this.mint = mint
      this.options = options
      this.keyChain = {
        getKeysets: () => cashuMock.behavior.getKeysets?.() || [],
        ensureKeysetKeys: (...args) => cashuMock.behavior.ensureKeysetKeys?.(...args),
      }
      cashuMock.instances.push(this)
    }

    async loadMint() {}
    getMintInfo() { return cashuMock.behavior.getMintInfo?.() || { nuts: {} } }
    async createLockedMintQuote(...args) { return cashuMock.behavior.createLockedMintQuote(...args) }
    async createMintQuoteBolt11(...args) { return cashuMock.behavior.createMintQuoteBolt11(...args) }
    async checkMintQuoteBolt11(...args) { return cashuMock.behavior.checkMintQuoteBolt11(...args) }
    async mintProofsBolt11(...args) { return cashuMock.behavior.mintProofsBolt11(...args) }
    async send(...args) { return cashuMock.behavior.send(...args) }
    async receive(...args) { return cashuMock.behavior.receive(...args) }
    async createMeltQuoteBolt11(...args) { return cashuMock.behavior.createMeltQuoteBolt11(...args) }
    async prepareMelt(...args) { return cashuMock.behavior.prepareMelt(...args) }
    async completeMelt(...args) { return cashuMock.behavior.completeMelt(...args) }
    async checkMeltQuoteBolt11(...args) { return cashuMock.behavior.checkMeltQuoteBolt11(...args) }
    createMeltChangeProofs(...args) { return cashuMock.behavior.createMeltChangeProofs(...args) }
    async batchRestore(...args) { return cashuMock.behavior.batchRestore(...args) }
    async checkProofsStates(...args) { return cashuMock.behavior.checkProofsStates(...args) }
  }

  return {
    Wallet,
    CheckStateEnum: { UNSPENT: 'UNSPENT', PENDING: 'PENDING', SPENT: 'SPENT' },
    OutputData: {
      serialize: value => value,
      deserialize: value => value,
    },
    getEncodedToken: vi.fn(payload => {
      cashuMock.encodedToken = payload
      return 'cashuBtest-token'
    }),
    getTokenMetadata: vi.fn(() => cashuMock.tokenMetadata),
    getPubKeyFromPrivKey: vi.fn(() => new Uint8Array(33).fill(2)),
    setGlobalRequestOptions: vi.fn(options => { cashuMock.requestOptions = options }),
  }
})

import {
  createEcashToken,
  createMintQuote,
  meltTokens,
  mintTokens,
  receiveEcashToken,
  resolvePendingCashuMelt,
  restoreDeterministicProofs,
  teardownCashu,
} from '../lib/cashu-engine.js'
import { addProofs } from '../lib/cashu-store.js'

const MINT = 'https://mint.example.com'
const WALLET_ID = 'wallet-id'
const PASSWORD = 'password'
const SEED = new Uint8Array(64).fill(7)
const PRIVATE_KEY = '01'.padStart(64, '0')

function proof(secret, amount) {
  return { id: '0011223344556677', secret, C: `02${'a'.repeat(64)}`, amount }
}

beforeEach(() => {
  resetStorage()
  teardownCashu()
  cashuMock.instances.length = 0
  cashuMock.encodedToken = null
  cashuMock.tokenMetadata = { mint: MINT, unit: 'sat', amount: 5 }
  cashuMock.behavior = {}
})

describe('Cashu engine proof lifecycle', () => {
  it('uses a locked quote, deterministic outputs, DLEQ checks, and durable mint proofs', async () => {
    cashuMock.behavior.getMintInfo = () => ({ nuts: { '20': { supported: true } } })
    cashuMock.behavior.createLockedMintQuote = vi.fn(async () => ({
      quote: 'quote-id', request: 'lnbc1invoice', expiry: 2_000_000_000,
    }))
    cashuMock.behavior.mintProofsBolt11 = vi.fn(async () => [proof('minted', 8)])

    const quote = await createMintQuote(MINT, 8, WALLET_ID, PASSWORD, SEED, PRIVATE_KEY)
    expect(quote).toMatchObject({ quote: 'quote-id', locked: true })

    const result = await mintTokens(
      MINT, 8, quote.quote, WALLET_ID, PASSWORD, SEED, PRIVATE_KEY,
    )
    expect(result.amountSats).toBe(8)
    expect(await getAllProofs(WALLET_ID, PASSWORD, MINT))
      .toMatchObject([{ secret: 'minted', amount: 8 }])

    const instance = cashuMock.instances[0]
    expect(instance.options.requireSigDleq).toBe(true)
    expect(instance.options.secretsPolicy).toBe('deterministic')
    expect(instance.options.counterSource).toBeTruthy()
    expect(cashuMock.requestOptions).toEqual({ requestTimeout: 15_000 })
    expect(cashuMock.behavior.mintProofsBolt11)
      .toHaveBeenCalledWith(8, 'quote-id', { privkey: PRIVATE_KEY })
  })

  it('keeps change and removes only the proofs handed out as a portable token', async () => {
    await addProofs(WALLET_ID, [proof('original', 8)], PASSWORD, MINT)
    cashuMock.behavior.send = vi.fn(async () => ({
      keep: [proof('keep', 3)],
      send: [proof('send', 5)],
    }))

    const result = await createEcashToken(MINT, 5, WALLET_ID, PASSWORD, 'Lunch', SEED)
    expect(result).toMatchObject({ token: 'cashuBtest-token', amountSats: 5 })
    expect(cashuMock.encodedToken).toMatchObject({
      mint: MINT,
      unit: 'sat',
      memo: 'Lunch',
      proofs: [{ secret: 'send', amount: 5 }],
    })
    expect(await getAllProofs(WALLET_ID, PASSWORD, MINT))
      .toMatchObject([{ secret: 'keep', amount: 3 }])
  })

  it('uses the private receiving key when redeeming a P2PK token', async () => {
    cashuMock.behavior.receive = vi.fn(async () => [proof('received', 5)])

    const result = await receiveEcashToken(
      'cashuBtest-token', WALLET_ID, PASSWORD, SEED, PRIVATE_KEY,
    )
    expect(result).toMatchObject({ amountSats: 5, mint: MINT })
    expect(cashuMock.behavior.receive)
      .toHaveBeenCalledWith('cashuBtest-token', { privkey: PRIVATE_KEY })
    expect(await getAllProofs(WALLET_ID, PASSWORD, MINT))
      .toMatchObject([{ secret: 'received', amount: 5 }])
  })

  it('rejects a non-sat token before contacting its mint', async () => {
    cashuMock.tokenMetadata = { mint: MINT, unit: 'usd', amount: 5 }

    await expect(receiveEcashToken(
      'cashuBtest-token', WALLET_ID, PASSWORD, SEED, PRIVATE_KEY,
    )).rejects.toThrow('Only sat-denominated Cashu tokens are supported')
    expect(cashuMock.instances).toHaveLength(0)
  })

  it('scans retired keysets and keeps only mint-confirmed unspent recovery proofs', async () => {
    cashuMock.behavior.getKeysets = () => [{ id: 'current' }, { id: 'retired' }]
    cashuMock.behavior.ensureKeysetKeys = vi.fn(async () => {})
    cashuMock.behavior.batchRestore = vi.fn(async (_count, _batch, _start, keysetId) => ({
      proofs: [proof(`${keysetId}-proof`, keysetId === 'current' ? 2 : 4)],
      lastCounterWithSignature: keysetId === 'current' ? 10 : 20,
    }))
    cashuMock.behavior.checkProofsStates = vi.fn(async proofs => proofs.map(item => ({
      state: item.secret.startsWith('retired') ? 'UNSPENT' : 'SPENT',
    })))

    const result = await restoreDeterministicProofs(MINT, WALLET_ID, PASSWORD, SEED)
    expect(result).toMatchObject({ amountSats: 4, proofs: 1 })
    expect(cashuMock.behavior.batchRestore).toHaveBeenCalledTimes(2)
    expect(await getAllProofs(WALLET_ID, PASSWORD, MINT))
      .toMatchObject([{ secret: 'retired-proof', amount: 4 }])
  })

  it('recovers exact payment change after an uncertain mint response', async () => {
    await addProofs(WALLET_ID, [proof('original', 16)], PASSWORD, MINT)
    cashuMock.behavior.createMeltQuoteBolt11 = vi.fn(async () => ({
      quote: 'melt-quote', amount: 10, fee_reserve: 2, expiry: 2_000_000_000,
    }))
    cashuMock.behavior.send = vi.fn(async () => ({
      keep: [proof('keep', 4)],
      send: [proof('payment-input', 12)],
    }))
    cashuMock.behavior.prepareMelt = vi.fn(async () => ({
      quote: { quote: 'melt-quote' },
      outputData: [{ blinded: 'prepared-change' }],
    }))
    cashuMock.behavior.completeMelt = vi.fn(async () => {
      throw new Error('connection closed')
    })
    cashuMock.behavior.checkMeltQuoteBolt11 = vi.fn(async () => ({ state: 'PENDING' }))
    cashuMock.behavior.createMeltChangeProofs = vi.fn(() => [proof('change', 1)])

    await expect(meltTokens(
      MINT, 'lnbc1invoice', WALLET_ID, PASSWORD, SEED, { transactionId: 'tx-id' },
    )).rejects.toMatchObject({ code: 'CASHU_PAYMENT_PENDING' })
    expect(await hasCashuMeltJournal(WALLET_ID)).toBe(true)

    cashuMock.behavior.checkMeltQuoteBolt11 = vi.fn(async () => ({
      state: 'PAID', change: [{ C_: 'signature' }], payment_preimage: 'preimage',
    }))
    const recovered = await resolvePendingCashuMelt(WALLET_ID, PASSWORD, SEED)
    expect(recovered).toMatchObject({
      resolved: true,
      paid: true,
      transactionId: 'tx-id',
      feeSats: 1,
    })
    expect(await hasCashuMeltJournal(WALLET_ID)).toBe(false)
    expect(await getAllProofs(WALLET_ID, PASSWORD, MINT)).toMatchObject([
      { secret: 'keep', amount: 4 },
      { secret: 'change', amount: 1 },
    ])
  })
})
