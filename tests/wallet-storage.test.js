import { describe, it, expect, beforeEach } from 'vitest'
import { resetStorage } from './setup.js'
import {
  addWallet, addCashuWallet, addLnbitsWallet,
  getActiveWallet, getWalletSummaries, removeWallet,
  setActiveWallet, renameWallet, hasActiveWallet,
} from '../lib/wallet.js'

// All wallet operations require a password for encryption
const PW = 'test-password-123'

beforeEach(() => {
  resetStorage()
})

describe('wallet storage — multi-type', () => {
  describe('addWallet (NWC)', () => {
    it('creates an NWC wallet and sets it active', async () => {
      const id = await addWallet('nostr+walletconnect://relay?secret=abc', 'My NWC', PW)
      expect(id).toBeTruthy()
      const active = await getActiveWallet(PW)
      expect(active.type).toBe('nwc')
      expect(active.name).toBe('My NWC')
      expect(active.connectionUri).toContain('walletconnect')
    })
  })

  describe('addCashuWallet', () => {
    it('creates a Cashu wallet with mints', async () => {
      const id = await addCashuWallet('Cashu Wallet', ['https://mint.example.com'], PW)
      const active = await getActiveWallet(PW)
      expect(active.type).toBe('cashu')
      expect(active.mints).toEqual(['https://mint.example.com'])
    })
  })

  describe('addLnbitsWallet', () => {
    it('creates an LNbits wallet with apiUrl and adminKey', async () => {
      const id = await addLnbitsWallet('https://lnbits.example.com', 'admin123', 'wid1', 'My LNbits', PW)
      expect(id).toBeTruthy()
      const active = await getActiveWallet(PW)
      expect(active.type).toBe('lnbits')
      expect(active.apiUrl).toBe('https://lnbits.example.com')
      expect(active.adminKey).toBe('admin123')
      expect(active.lnbitsWalletId).toBe('wid1')
      expect(active.name).toBe('My LNbits')
    })

    it('strips trailing slash from apiUrl', async () => {
      await addLnbitsWallet('https://lnbits.example.com/', 'key', 'wid', 'W', PW)
      const active = await getActiveWallet(PW)
      expect(active.apiUrl).toBe('https://lnbits.example.com')
    })

    it('defaults name to "LNbits Wallet"', async () => {
      await addLnbitsWallet('https://x.com', 'key', 'wid', null, PW)
      const active = await getActiveWallet(PW)
      expect(active.name).toBe('LNbits Wallet')
    })
  })

  describe('multi-wallet management', () => {
    it('supports all three wallet types coexisting', async () => {
      await addWallet('nostr+walletconnect://r?s=1', 'NWC', PW)
      await addCashuWallet('Cashu', ['https://mint.com'], PW)
      await addLnbitsWallet('https://lb.com', 'key', 'w1', 'LNbits', PW)

      const summaries = await getWalletSummaries(PW)
      expect(summaries).toHaveLength(3)
      const types = summaries.map(s => s.type).sort()
      expect(types).toEqual(['cashu', 'lnbits', 'nwc'])
    })

    it('last added wallet becomes active', async () => {
      await addWallet('nostr+walletconnect://r?s=1', 'First', PW)
      await addLnbitsWallet('https://lb.com', 'key', 'w1', 'Second', PW)
      const active = await getActiveWallet(PW)
      expect(active.name).toBe('Second')
      expect(active.type).toBe('lnbits')
    })

    it('switching between types works', async () => {
      const nwcId = await addWallet('nostr+walletconnect://r?s=1', 'NWC', PW)
      await addLnbitsWallet('https://lb.com', 'key', 'w1', 'LNbits', PW)

      await setActiveWallet(nwcId, PW)
      const active = await getActiveWallet(PW)
      expect(active.type).toBe('nwc')
    })
  })

  describe('hasActiveWallet', () => {
    it('returns true for NWC wallet', async () => {
      await addWallet('nostr+walletconnect://r?s=1', 'W', PW)
      expect(await hasActiveWallet(PW)).toBe(true)
    })

    it('returns true for Cashu wallet', async () => {
      await addCashuWallet('W', ['https://mint.com'], PW)
      expect(await hasActiveWallet(PW)).toBe(true)
    })

    it('returns true for LNbits wallet', async () => {
      await addLnbitsWallet('https://lb.com', 'key', 'w1', 'W', PW)
      expect(await hasActiveWallet(PW)).toBe(true)
    })

    it('returns false when no wallets', async () => {
      expect(await hasActiveWallet(PW)).toBe(false)
    })
  })

  describe('removeWallet', () => {
    it('activates next wallet after removal', async () => {
      const first = await addWallet('nostr+walletconnect://r?s=1', 'First', PW)
      await addLnbitsWallet('https://lb.com', 'key', 'w1', 'Second', PW)

      // Second is active, remove it
      const summaries = await getWalletSummaries(PW)
      const activeId = summaries.find(s => s.isActive).id
      await removeWallet(activeId, PW)

      const remaining = await getWalletSummaries(PW)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].isActive).toBe(true)
      expect(remaining[0].name).toBe('First')
    })
  })
})
