import { describe, it, expect } from 'vitest'
import { mnemonicToSeedSync } from '@scure/bip39'
import { verifyEvent } from 'nostr-core'
import {
  deriveMintBackupKeys,
  buildMintBackupEvent,
  parseMintBackupEvent,
  MINT_BACKUP_KIND,
  MINT_BACKUP_D_TAG,
} from '../lib/cashu-mint-backup.js'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SEED = mnemonicToSeedSync(MNEMONIC)
const MINTS = ['https://mint.minibits.cash/Bitcoin', 'https://mint.example.com']

describe('deriveMintBackupKeys', () => {
  it('derives the same key pair for the same words every time', () => {
    const a = deriveMintBackupKeys(SEED)
    const b = deriveMintBackupKeys(mnemonicToSeedSync(MNEMONIC))
    expect(a.pubkey).toBe(b.pubkey)
    expect(a.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(Buffer.from(a.secretKey).toString('hex')).toBe(Buffer.from(b.secretKey).toString('hex'))
  })

  it('derives a different key for different words', () => {
    const other = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow')
    expect(deriveMintBackupKeys(other).pubkey).not.toBe(deriveMintBackupKeys(SEED).pubkey)
  })

  it('rejects anything but the 64-byte seed', () => {
    expect(() => deriveMintBackupKeys(new Uint8Array(32))).toThrow()
    expect(() => deriveMintBackupKeys(MNEMONIC)).toThrow()
  })
})

describe('mint backup events', () => {
  it('builds a valid, self-decryptable kind 30078 event per NUT-27', () => {
    const event = buildMintBackupEvent(SEED, MINTS, 1703721600)
    expect(event.kind).toBe(MINT_BACKUP_KIND)
    expect(event.created_at).toBe(1703721600)
    expect(event.tags).toContainEqual(['d', MINT_BACKUP_D_TAG])
    expect(event.pubkey).toBe(deriveMintBackupKeys(SEED).pubkey)
    expect(verifyEvent(event)).toBe(true)
    // Content must be NIP-44 ciphertext, not readable JSON
    expect(event.content.includes('mint.example.com')).toBe(false)

    const parsed = parseMintBackupEvent(event, SEED)
    expect(parsed).toEqual({ mints: MINTS, timestamp: 1703721600 })
  })

  it('refuses events signed by a different seed', () => {
    const otherSeed = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow')
    const event = buildMintBackupEvent(otherSeed, MINTS)
    expect(parseMintBackupEvent(event, SEED)).toBeNull()
  })

  it('drops insecure and duplicate mint URLs on parse', () => {
    const event = buildMintBackupEvent(SEED, [
      'https://mint.example.com',
      'https://mint.example.com/',
      'http://evil.example.com',
      'not a url',
    ])
    const parsed = parseMintBackupEvent(event, SEED)
    expect(parsed.mints).toEqual(['https://mint.example.com'])
  })

  it('returns null for garbage content', () => {
    const event = buildMintBackupEvent(SEED, MINTS)
    expect(parseMintBackupEvent({ ...event, content: 'AgB?broken' }, SEED)).toBeNull()
    expect(parseMintBackupEvent(null, SEED)).toBeNull()
  })
})
