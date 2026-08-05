/**
 * LUD-04 Lightning Login and LUD-05 domain-key derivation.
 *
 * A seed-backed Identity derives a different secp256k1 linking key for every
 * website. The Nostr account key is never reused for login and neither the
 * mnemonic nor the per-site private key leaves the background worker.
 */

import { HDKey, HARDENED_OFFSET } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { bytesToHex, hexToBytes, lnurl } from 'nostr-core'
import { normalizeMnemonic } from './nostrIdentity.js'
import { requireSecureUrl } from './origins.js'

const ACTIONS = new Set(['register', 'login', 'link', 'auth'])
const HASHING_PATH = "m/138'/0"

function formatLud05Index(index) {
  return index >= HARDENED_OFFSET ? `${index - HARDENED_OFFSET}'` : `${index}`
}

export function buildLud05Path(seed, domain) {
  if (!(seed instanceof Uint8Array)) throw new TypeError('Seed must be bytes')
  if (typeof domain !== 'string' || !domain) throw new TypeError('Domain is required')

  const hashingNode = HDKey.fromMasterSeed(seed).derive(HASHING_PATH)
  if (!hashingNode.privateKey) throw new Error('LUD-05 hashing key derivation failed')
  const domainHash = hmac(sha256, hashingNode.privateKey, utf8ToBytes(domain))
  const view = new DataView(domainHash.buffer, domainHash.byteOffset, domainHash.byteLength)
  const indices = [
    view.getUint32(0, false),
    view.getUint32(4, false),
    view.getUint32(8, false),
    view.getUint32(12, false),
  ]

  return {
    indices,
    path: `m/138'/${indices.map(formatLud05Index).join('/')}`,
  }
}

export function deriveLightningLinkingKey(mnemonic, domain) {
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic))
  try {
    const { indices, path } = buildLud05Path(seed, domain)
    let node = HDKey.fromMasterSeed(seed).deriveChild(138 + HARDENED_OFFSET)
    for (const index of indices) node = node.deriveChild(index)
    if (!node.privateKey || !node.publicKey) {
      throw new Error(`LUD-05 linking key derivation failed at ${path}`)
    }
    return { privateKey: node.privateKey, publicKey: node.publicKey, path }
  } finally {
    seed.fill(0)
  }
}

export function signLud04Challenge(k1, privateKey) {
  if (!(k1 instanceof Uint8Array) || k1.length !== 32) {
    throw new TypeError('LUD-04 challenge must be 32 bytes')
  }
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new TypeError('LUD-04 linking key must be 32 bytes')
  }
  return secp256k1.sign(k1, privateKey, { prehash: false, format: 'der' })
}

export function decodeLightningLoginInput(input) {
  let value = String(input || '').trim()
  if (value.toLowerCase().startsWith('lightning:')) value = value.slice('lightning:'.length)
  const lower = value.toLowerCase()
  if (lower.startsWith('keyauth://')) return `https://${value.slice('keyauth://'.length)}`
  if (lower.startsWith('lnurla://')) return `https://${value.slice('lnurla://'.length)}`
  if (lower.startsWith('lnurl1')) return lnurl.decodeLnurl(value)
  throw new Error('This is not a Lightning Login code')
}

export function parseLightningLogin(input) {
  let url
  try {
    url = new URL(decodeLightningLoginInput(input))
  } catch (error) {
    if (error?.message === 'This is not a Lightning Login code') throw error
    throw new Error('This Lightning Login link is invalid')
  }
  requireSecureUrl(url.toString())
  if (url.searchParams.get('tag') !== 'login') throw new Error('This code is not a Lightning Login request')

  const k1Hex = url.searchParams.get('k1') || ''
  if (!/^[0-9a-f]{64}$/i.test(k1Hex)) throw new Error('The login challenge is invalid')
  const k1 = hexToBytes(k1Hex)
  const requestedAction = url.searchParams.get('action') || 'login'
  const action = ACTIONS.has(requestedAction) ? requestedAction : 'login'
  return {
    url: url.toString(),
    origin: url.origin,
    domain: url.hostname.toLowerCase(),
    action,
    k1,
    k1Hex: k1Hex.toLowerCase(),
  }
}

export function buildLud04Callback(challengeUrl, signatureHex, linkingPubkeyHex) {
  const url = new URL(challengeUrl)
  url.searchParams.set('sig', signatureHex)
  url.searchParams.set('key', linkingPubkeyHex)
  return url.toString()
}

export function proveLightningLogin(mnemonic, input) {
  const challenge = parseLightningLogin(input)
  const linkingKey = deriveLightningLinkingKey(mnemonic, challenge.domain)
  try {
    const signature = signLud04Challenge(challenge.k1, linkingKey.privateKey)
    return {
      challenge,
      callbackUrl: buildLud04Callback(
        challenge.url,
        bytesToHex(signature),
        bytesToHex(linkingKey.publicKey)
      ),
      linkingPubkey: bytesToHex(linkingKey.publicKey),
    }
  } finally {
    linkingKey.privateKey.fill(0)
  }
}

export async function submitLightningLogin(callbackUrl, options = {}) {
  const { fetchImpl = fetch, timeoutMs = 15000 } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const secureCallback = requireSecureUrl(callbackUrl).toString()
    const response = await fetchImpl(secureCallback, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    })
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      return { ok: false, reason: 'The website redirected the signed login request' }
    }
    let body
    try {
      body = await response.json()
    } catch {
      return { ok: false, reason: `The website returned HTTP ${response.status}` }
    }
    if (body?.status === 'OK') return { ok: true }
    if (body?.status === 'ERROR') return { ok: false, reason: body.reason || 'The website rejected the login' }
    return { ok: false, reason: 'The website returned an unexpected response' }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, reason: 'The website did not respond in time' }
    if (error instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(error.message || '')) {
      return { ok: false, requestSent: true }
    }
    return { ok: false, reason: error?.message || 'The website could not be reached' }
  } finally {
    clearTimeout(timeout)
  }
}
