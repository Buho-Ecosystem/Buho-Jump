import { describe, it, expect } from 'vitest'
import { getTokenMetadata, PaymentRequest } from '@cashu/cashu-ts'
import {
  extractPaymentRequest,
  decodePaymentRequestInfo,
  buildPaymentRequest,
  makePaymentRequestId,
  buildPaymentPayload,
  looksLikePaymentPayload,
  parsePaymentPayload,
  payloadToToken,
} from '../lib/cashu-payment-request.js'

// Official NUT-18 example (10 sat, testnut mint, nostr transport)
const SPEC_CREQA = 'creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF4Imh0dHBzOi8vbm9mZWVzLnRlc3RudXQuY2FzaHUuc3BhY2U='

// Official NUT-26 test vector (demo123, 1000 sat, Coffee payment, single use)
const SPEC_CREQB = 'CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ'

// nprofile from the NUT-18 example
const SPEC_NPROFILE = 'nprofile1qy28wumn8ghj7un9d3shjtnyv9kh2uewd9hsz9mhwden5te0wfjkccte9curxven9eehqctrv5hszrthwden5te0dehhxtnvdakqqgydaqy7curk439ykptkysv7udhdhu68sucm295akqefdehkf0d495cwunl5'

const PROOF = {
  amount: 8,
  id: '009a1f293253e41e',
  secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
  C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
}

describe('extractPaymentRequest', () => {
  it('accepts raw creqA and creqb strings', () => {
    expect(extractPaymentRequest(SPEC_CREQA)).toBe(SPEC_CREQA)
    expect(extractPaymentRequest(SPEC_CREQB)).toBe(SPEC_CREQB)
    expect(extractPaymentRequest(`  ${SPEC_CREQB}  `)).toBe(SPEC_CREQB)
  })

  it('extracts the creq parameter from bitcoin: URIs', () => {
    expect(extractPaymentRequest(`bitcoin:?creq=${SPEC_CREQB}`)).toBe(SPEC_CREQB)
    expect(extractPaymentRequest(`bitcoin:?lightning=lnbc1abc&creq=${SPEC_CREQB}`)).toBe(SPEC_CREQB)
  })

  it('rejects everything else', () => {
    expect(extractPaymentRequest('lnbc10n1...')).toBeNull()
    expect(extractPaymentRequest('cashuBo2Ft...')).toBeNull()
    expect(extractPaymentRequest('bitcoin:?lightning=lnbc1abc')).toBeNull()
    expect(extractPaymentRequest('')).toBeNull()
    expect(extractPaymentRequest(null)).toBeNull()
  })
})

describe('decodePaymentRequestInfo', () => {
  it('decodes the official NUT-18 example', () => {
    const info = decodePaymentRequestInfo(SPEC_CREQA)
    expect(info.valid).toBe(true)
    expect(info.id).toBe('b7a90176')
    expect(info.amountSats).toBe(10)
    expect(info.unit).toBe('sat')
    expect(info.mints).toEqual(['https://nofees.testnut.cashu.space'])
    expect(info.mintHosts).toEqual(['nofees.testnut.cashu.space'])
    expect(info.transports).toHaveLength(1)
    expect(info.transports[0].type).toBe('nostr')
    expect(info.transports[0].pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(info.transports[0].relays.length).toBeGreaterThan(0)
    expect(info.locked).toBe(false)
  })

  it('decodes the official NUT-26 test vector', () => {
    const info = decodePaymentRequestInfo(SPEC_CREQB)
    expect(info.valid).toBe(true)
    expect(info.id).toBe('demo123')
    expect(info.amountSats).toBe(1000)
    expect(info.singleUse).toBe(true)
    expect(info.description).toBe('Coffee payment')
    expect(info.mints).toEqual(['https://mint.example.com'])
    expect(info.transports).toEqual([])
  })

  it('rejects garbage and non-sat units', () => {
    expect(decodePaymentRequestInfo('creqAnotbase64!!!').valid).toBe(false)
    expect(decodePaymentRequestInfo('hello').valid).toBe(false)
    const usd = buildRawRequest({ amount: 100, unit: 'usd' })
    const info = decodePaymentRequestInfo(usd)
    expect(info.valid).toBe(false)
    expect(info.reason).toBe('unit')
  })

  it('rejects requests whose only mints are insecure URLs', () => {
    const encoded = buildRawRequest({ amount: 5, unit: 'sat', mints: ['http://evil.example.com'] })
    const info = decodePaymentRequestInfo(encoded)
    expect(info.valid).toBe(false)
    expect(info.reason).toBe('mints')
  })

  it('flags NUT-10 locked requests instead of failing', () => {
    const encoded = buildRawRequest({
      amount: 5,
      unit: 'sat',
      nut10: { kind: 'P2PK', data: '02' + '11'.repeat(32) },
    })
    const info = decodePaymentRequestInfo(encoded)
    expect(info.valid).toBe(true)
    expect(info.locked).toBe(true)
  })
})

describe('buildPaymentRequest', () => {
  it('builds a creqA request other wallets can decode', () => {
    const encoded = buildPaymentRequest({
      id: 'abc12345',
      amountSats: 2100,
      description: 'Lunch',
      mints: ['https://mint.minibits.cash/Bitcoin'],
      nprofile: SPEC_NPROFILE,
    })
    expect(encoded.startsWith('creqA')).toBe(true)
    const info = decodePaymentRequestInfo(encoded)
    expect(info.valid).toBe(true)
    expect(info.id).toBe('abc12345')
    expect(info.amountSats).toBe(2100)
    expect(info.description).toBe('Lunch')
    expect(info.mints).toEqual(['https://mint.minibits.cash/Bitcoin'])
    expect(info.transports[0].type).toBe('nostr')
    expect(info.transports[0].target).toBe(SPEC_NPROFILE)
  })

  it('supports amountless requests', () => {
    const encoded = buildPaymentRequest({ id: 'noamount', nprofile: SPEC_NPROFILE })
    const info = decodePaymentRequestInfo(encoded)
    expect(info.valid).toBe(true)
    expect(info.amountSats).toBeNull()
  })

  it('requires a nostr address and a sane amount', () => {
    expect(() => buildPaymentRequest({ id: 'x', nprofile: 'npub1abc' })).toThrow()
    expect(() => buildPaymentRequest({ id: 'x', amountSats: -5, nprofile: SPEC_NPROFILE })).toThrow()
    expect(() => buildPaymentRequest({ id: 'x', amountSats: 1.5, nprofile: SPEC_NPROFILE })).toThrow()
  })
})

describe('makePaymentRequestId', () => {
  it('returns unique 8-char hex ids', () => {
    const a = makePaymentRequestId()
    const b = makePaymentRequestId()
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })
})

describe('payment payloads', () => {
  it('round-trips through build and parse', () => {
    const payload = buildPaymentPayload({
      id: 'abc12345',
      memo: 'thanks',
      mint: 'https://mint.example.com',
      proofs: [PROOF],
    })
    const json = JSON.stringify(payload)
    expect(looksLikePaymentPayload(json)).toBe(true)
    const parsed = parsePaymentPayload(json)
    expect(parsed.valid).toBe(true)
    expect(parsed.id).toBe('abc12345')
    expect(parsed.memo).toBe('thanks')
    expect(parsed.mint).toBe('https://mint.example.com')
    expect(parsed.amountSats).toBe(8)
    expect(parsed.proofs).toHaveLength(1)
  })

  it('treats a missing or empty unit as sat (cashu.me sends "")', () => {
    const base = { mint: 'https://mint.example.com', proofs: [PROOF] }
    expect(parsePaymentPayload(JSON.stringify({ ...base, unit: '' })).valid).toBe(true)
    expect(parsePaymentPayload(JSON.stringify(base)).valid).toBe(true)
    expect(parsePaymentPayload(JSON.stringify({ ...base, unit: 'usd' })).valid).toBe(false)
  })

  it('rejects malformed payloads', () => {
    const good = { mint: 'https://mint.example.com', unit: 'sat', proofs: [PROOF] }
    expect(parsePaymentPayload('not json {')).toEqual({ valid: false })
    expect(parsePaymentPayload(JSON.stringify({ ...good, mint: 'http://mint.example.com' })).valid).toBe(false)
    expect(parsePaymentPayload(JSON.stringify({ ...good, proofs: [] })).valid).toBe(false)
    expect(parsePaymentPayload(JSON.stringify({ ...good, proofs: [{ ...PROOF, amount: -1 }] })).valid).toBe(false)
    expect(parsePaymentPayload(JSON.stringify({ ...good, proofs: [{ ...PROOF, secret: '' }] })).valid).toBe(false)
    expect(looksLikePaymentPayload('hello there')).toBe(false)
  })

  it('converts a payload into a redeemable cashu token', () => {
    const parsed = parsePaymentPayload(JSON.stringify(buildPaymentPayload({
      memo: 'coffee',
      mint: 'https://mint.example.com',
      proofs: [PROOF],
    })))
    const token = payloadToToken(parsed)
    expect(token.startsWith('cashuB')).toBe(true)
    const metadata = getTokenMetadata(token)
    expect(metadata.mint).toBe('https://mint.example.com')
    const amount = typeof metadata.amount?.toNumber === 'function'
      ? metadata.amount.toNumber()
      : Number(metadata.amount)
    expect(amount).toBe(8)
  })
})

describe('detectPaymentInput integration', () => {
  it('classifies payment requests and bitcoin: URIs', async () => {
    const { detectPaymentInput } = await import('../lib/utils.js')
    expect(detectPaymentInput(SPEC_CREQA).type).toBe('payment-request')
    expect(detectPaymentInput(SPEC_CREQB).type).toBe('payment-request')
    const uri = detectPaymentInput(`bitcoin:?creq=${SPEC_CREQB}`)
    expect(uri.type).toBe('payment-request')
    expect(uri.value).toBe(SPEC_CREQB)
    // Lightning wins when both are present: any wallet type can pay it
    const both = detectPaymentInput(`bitcoin:?lightning=lnbc10n1pabcdef&creq=${SPEC_CREQB}`)
    expect(both.type).toBe('invoice')
    expect(detectPaymentInput('bitcoin:?amount=0.001').type).toBe('unknown')
  })
})

// Build an encoded request directly with cashu-ts to create shapes our
// builder refuses to produce (foreign units, insecure mints, locks).
function buildRawRequest({ amount, unit, mints, nut10 }) {
  const request = new PaymentRequest(undefined, 'test', amount, unit, mints, undefined, false, nut10)
  return request.toEncodedRequest()
}
