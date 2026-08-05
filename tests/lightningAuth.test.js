import { describe, expect, it, vi } from 'vitest'
import { mnemonicToSeedSync } from '@scure/bip39'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, lnurl } from 'nostr-core'
import {
  buildLud05Path,
  deriveLightningLinkingKey,
  signLud04Challenge,
  parseLightningLogin,
  buildLud04Callback,
  proveLightningLogin,
  submitLightningLogin,
} from '../lib/lightningAuth.js'

const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const K1 = 'e2af6254a8df433264fa23f67eb8188635d15ce883e8fc020989d5f82ae6f11e'
const AUTH_URL = `https://auth.example.com/login?tag=login&k1=${K1}&action=login`

describe('LUD-05 linking keys', () => {
  it('builds a stable domain-specific path', () => {
    const seed = mnemonicToSeedSync(MNEMONIC)
    const first = buildLud05Path(seed, 'stacker.news')
    const second = buildLud05Path(seed, 'stacker.news')
    const other = buildLud05Path(seed, 'nostr.land')
    expect(first).toEqual(second)
    expect(first.indices).toHaveLength(4)
    expect(first.path).toMatch(/^m\/138'\/[\d']+\/[\d']+\/[\d']+\/[\d']+$/)
    expect(first.indices).not.toEqual(other.indices)
  })

  it('derives deterministic compressed keys per domain', () => {
    const first = deriveLightningLinkingKey(MNEMONIC, 'stacker.news')
    const again = deriveLightningLinkingKey(MNEMONIC, 'stacker.news')
    const other = deriveLightningLinkingKey(MNEMONIC, 'nostr.land')
    expect(bytesToHex(first.publicKey)).toBe(bytesToHex(again.publicKey))
    expect(bytesToHex(first.publicKey)).not.toBe(bytesToHex(other.publicKey))
    expect(first.publicKey).toHaveLength(33)
    expect([2, 3]).toContain(first.publicKey[0])
  })

  it('matches the BuhoGO linking-key parity vector', () => {
    const key = deriveLightningLinkingKey(MNEMONIC, 'stacker.news')
    expect(key.path).toBe("m/138'/805585043/1765717960'/346453715/1845200076'")
    expect(bytesToHex(key.privateKey)).toBe('4839d18d102816edf15c6177f16822dcf0f80e18c0651170c3c1f1fbb30fb287')
    expect(bytesToHex(key.publicKey)).toBe('024dbdc860b837b9d0258658730731ebd1d447a693e7a3c601603e8e5a771475c4')
  })
})

describe('LUD-04 challenges', () => {
  it('parses bech32 and keyauth login carriers', () => {
    const encoded = lnurl.encodeLnurl(AUTH_URL)
    expect(parseLightningLogin(encoded)).toMatchObject({
      domain: 'auth.example.com',
      action: 'login',
      k1Hex: K1,
    })
    expect(parseLightningLogin(AUTH_URL.replace('https://', 'keyauth://')).domain).toBe('auth.example.com')
  })

  it('rejects insecure, non-login, and malformed challenges', () => {
    expect(() => parseLightningLogin(`keyauth://auth.example.com/?tag=payRequest&k1=${K1}`)).toThrow('not a Lightning Login')
    expect(() => parseLightningLogin(`keyauth://auth.example.com/?tag=login&k1=bad`)).toThrow('challenge is invalid')
    expect(() => parseLightningLogin('lnurla://')).toThrow()
  })

  it('signs the raw k1 digest with DER ECDSA', () => {
    const key = deriveLightningLinkingKey(MNEMONIC, 'auth.example.com')
    const k1 = Uint8Array.from(K1.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)))
    const signature = signLud04Challenge(k1, key.privateKey)
    expect(signature[0]).toBe(0x30)
    expect(secp256k1.verify(signature, k1, key.publicKey, { format: 'der', prehash: false })).toBe(true)
  })

  it('builds the callback without dropping the original challenge', () => {
    const callback = new URL(buildLud04Callback(AUTH_URL, 'abcd', '02ff'))
    expect(callback.searchParams.get('k1')).toBe(K1)
    expect(callback.searchParams.get('sig')).toBe('abcd')
    expect(callback.searchParams.get('key')).toBe('02ff')
  })

  it('creates a complete proof without exposing secret material', () => {
    const proof = proveLightningLogin(MNEMONIC, lnurl.encodeLnurl(AUTH_URL))
    expect(proof.challenge.domain).toBe('auth.example.com')
    expect(proof.linkingPubkey).toHaveLength(66)
    expect(proof.callbackUrl).toContain('sig=')
    expect(proof).not.toHaveProperty('privateKey')
  })
})

describe('Lightning Login callback', () => {
  it('accepts OK and preserves server rejection reasons', async () => {
    const okFetch = vi.fn(async () => ({ json: async () => ({ status: 'OK' }) }))
    const errorFetch = vi.fn(async () => ({ json: async () => ({ status: 'ERROR', reason: 'expired' }) }))
    await expect(submitLightningLogin(AUTH_URL, { fetchImpl: okFetch, timeoutMs: 20 })).resolves.toEqual({ ok: true })
    await expect(submitLightningLogin(AUTH_URL, { fetchImpl: errorFetch, timeoutMs: 20 })).resolves.toEqual({ ok: false, reason: 'expired' })
  })
})
