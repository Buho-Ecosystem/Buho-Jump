/**
 * Non-funded release smoke test for the built-in Cashu mint.
 *
 * This checks the real server without moving value. It loads mint metadata,
 * validates every advertised keyset, creates ordinary and wallet-locked
 * one-sat quotes, checks quote state, and opens a NUT-17 subscription.
 */

import { Wallet, getPubKeyFromPrivKey, setGlobalRequestOptions } from '@cashu/cashu-ts'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { DEFAULT_MINT } from '../lib/cashu-constants.js'

setGlobalRequestOptions({ requestTimeout: 15_000 })

function supports(info, nut) {
  return !!info?.nuts?.[String(nut)]?.supported
}

function supportsCachedRecovery(info) {
  const endpoints = info?.nuts?.['19']?.cached_endpoints
  if (!Array.isArray(endpoints)) return false
  const advertised = new Set(endpoints.map(endpoint => `${endpoint?.method}:${endpoint?.path}`))
  return [
    'POST:/v1/mint/bolt11',
    'POST:/v1/melt/bolt11',
    'POST:/v1/swap',
  ].every(endpoint => advertised.has(endpoint))
}

async function main() {
  const wallet = new Wallet(DEFAULT_MINT, { unit: 'sat', requireSigDleq: true })
  await wallet.loadMint()

  const info = wallet.getMintInfo()
  for (const nut of [7, 9, 12, 17, 20]) {
    if (!supports(info, nut)) throw new Error(`Default mint is missing required NUT-${nut}`)
  }
  if (!supportsCachedRecovery(info)) {
    throw new Error('Default mint is missing required NUT-19 cached recovery endpoints')
  }

  const keysets = wallet.keyChain.getKeysets()
  if (!keysets.length) throw new Error('Default mint returned no keysets')
  for (const keyset of keysets) await wallet.keyChain.ensureKeysetKeys(keyset.id)

  const quote = await wallet.createMintQuoteBolt11(1)
  if (!quote?.quote || !quote?.request) throw new Error('Default mint returned an invalid quote')
  const quoteState = await wallet.checkMintQuoteBolt11(quote.quote)
  if (quoteState.state !== 'UNPAID') throw new Error(`Unexpected quote state: ${quoteState.state}`)

  const privateKey = randomBytes(32)
  const publicKey = bytesToHex(getPubKeyFromPrivKey(privateKey))
  const lockedQuote = await wallet.createLockedMintQuote(1, publicKey)
  if (!lockedQuote?.quote || !lockedQuote?.request) {
    throw new Error('Default mint returned an invalid locked quote')
  }

  const startedAt = Date.now()
  try {
    const update = await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 1_500 })
    throw new Error(`An unpaid smoke-test quote unexpectedly changed state: ${update?.state}`)
  } catch (error) {
    if (error?.message?.startsWith('An unpaid smoke-test quote')) throw error
    if (Date.now() - startedAt < 800) throw error
  } finally {
    wallet.mint.disconnectWebSocket()
  }

  console.log(JSON.stringify({
    ok: true,
    mint: DEFAULT_MINT,
    software: info?.name || '',
    version: info?.version || '',
    keysets: keysets.length,
    ordinaryQuote: quoteState.state,
    lockedQuote: true,
    realtimeSubscription: true,
    cachedResponseRecovery: true,
  }, null, 2))
}

main().catch(error => {
  console.error(error?.message || error)
  process.exitCode = 1
})
