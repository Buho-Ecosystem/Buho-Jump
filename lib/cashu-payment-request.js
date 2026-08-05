/**
 * Cashu payment requests — NUT-18 (creqA) and NUT-26 (creqb) support.
 *
 * Pure helpers shared by the popup UI and the background worker:
 *   - detect and decode encoded payment requests, in both formats plus
 *     BIP-321 bitcoin: URIs that carry a creq parameter
 *   - build our own requests (encoded as creqA, the format every deployed
 *     wallet can read; we accept both formats when paying)
 *   - build and parse the PaymentRequestPayload JSON that wallets exchange
 *
 * Network delivery (Nostr DM or HTTP POST) lives in background.js.
 */

import {
  PaymentRequest,
  PaymentRequestTransportType,
  decodePaymentRequest,
  getEncodedToken,
} from '@cashu/cashu-ts'
import { nip19 } from 'nostr-core'
import { requireSecureUrl } from './origins.js'

const MAX_REQUEST_LENGTH = 4096
const MAX_PAYLOAD_LENGTH = 500_000
const MAX_PAYLOAD_PROOFS = 1000
const MAX_DESCRIPTION_LENGTH = 200
const MAX_MEMO_LENGTH = 140

/**
 * Pull an encoded payment request out of user input.
 * Accepts a raw creqA / creqb string or a bitcoin: URI with a creq parameter.
 * Returns the encoded request string, or null when the input is not one.
 */
export function extractPaymentRequest(input) {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s || s.length > 100_000) return null
  const lower = s.toLowerCase()

  if (lower.startsWith('bitcoin:')) {
    const queryStart = s.indexOf('?')
    if (queryStart === -1) return null
    for (const pair of s.slice(queryStart + 1).split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      if (pair.slice(0, eq).toLowerCase() !== 'creq') continue
      let value
      try { value = decodeURIComponent(pair.slice(eq + 1)).trim() } catch { return null }
      return isPaymentRequestString(value) ? value : null
    }
    return null
  }

  return isPaymentRequestString(s) ? s : null
}

function isPaymentRequestString(s) {
  const lower = s.toLowerCase()
  return (lower.startsWith('creqa') || lower.startsWith('creqb'))
    && s.length <= MAX_REQUEST_LENGTH
}

/**
 * Decode an encoded payment request into a normalized, validated shape the
 * UI can render directly.
 *
 * Returns { valid: true, ... } or { valid: false, reason } where reason is
 * one of 'format' | 'unit' | 'amount' | 'mints'.
 */
export function decodePaymentRequestInfo(encoded) {
  if (typeof encoded !== 'string' || !isPaymentRequestString(encoded.trim())) {
    return { valid: false, reason: 'format' }
  }

  let request
  try {
    request = decodePaymentRequest(encoded.trim())
  } catch {
    return { valid: false, reason: 'format' }
  }

  const unit = request.unit || 'sat'
  if (unit !== 'sat') return { valid: false, reason: 'unit' }

  let amountSats = null
  if (request.amount != null) {
    const value = typeof request.amount.toNumber === 'function'
      ? request.amount.toNumber()
      : Number(request.amount)
    if (!Number.isSafeInteger(value) || value <= 0) {
      return { valid: false, reason: 'amount' }
    }
    amountSats = value
  }

  const rawMints = Array.isArray(request.mints) ? request.mints : []
  const mints = []
  for (const candidate of rawMints) {
    try {
      mints.push(requireSecureUrl(candidate, { allowLoopback: true }).toString().replace(/\/$/, ''))
    } catch { /* drop unusable mint URLs */ }
  }
  if (rawMints.length > 0 && mints.length === 0) {
    return { valid: false, reason: 'mints' }
  }

  const transports = []
  for (const transport of request.transport || []) {
    if (transport?.type === PaymentRequestTransportType.NOSTR) {
      const decoded = decodeNostrTarget(transport.target)
      if (decoded) transports.push({ type: 'nostr', target: transport.target, ...decoded })
    } else if (transport?.type === PaymentRequestTransportType.POST) {
      try {
        transports.push({
          type: 'post',
          url: requireSecureUrl(transport.target, { allowLoopback: true }).toString(),
        })
      } catch { /* drop unusable endpoints */ }
    }
    // Unknown transport types are ignored for forward compatibility.
  }

  return {
    valid: true,
    encoded: encoded.trim(),
    id: typeof request.id === 'string' ? request.id.slice(0, 64) : '',
    amountSats,
    unit: 'sat',
    singleUse: request.singleUse === true,
    description: typeof request.description === 'string'
      ? request.description.slice(0, MAX_DESCRIPTION_LENGTH)
      : '',
    mints,
    mintHosts: mints.map(mint => new URL(mint).host),
    transports,
    // NUT-10 locked requests need P2PK/HTLC sending, which we do not offer yet.
    locked: request.nut10 != null,
  }
}

function decodeNostrTarget(target) {
  try {
    const { type, data } = nip19.decode(target)
    if (type === 'nprofile') return { pubkey: data.pubkey, relays: data.relays || [] }
    if (type === 'npub') return { pubkey: data, relays: [] }
  } catch { /* not a nostr target */ }
  return null
}

/** Random 8-hex-char payment id, matching what other wallets emit. */
export function makePaymentRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build an encoded payment request for receiving sats over Nostr.
 * Encodes as creqA — the format all deployed wallets decode.
 *
 * @param {object} options
 * @param {string} options.id - payment id (see makePaymentRequestId)
 * @param {number|null} options.amountSats - requested amount; null lets the payer choose
 * @param {string} options.description - note shown to the payer
 * @param {string[]} options.mints - mints we accept payment from
 * @param {string} options.nprofile - our Nostr address (pubkey + relays)
 * @returns {string} encoded creqA request
 */
export function buildPaymentRequest({ id, amountSats = null, description = '', mints = [], nprofile }) {
  if (typeof nprofile !== 'string' || !nprofile.startsWith('nprofile1')) {
    throw new Error('A Nostr address is required to receive the payment')
  }
  if (amountSats != null && (!Number.isSafeInteger(amountSats) || amountSats <= 0)) {
    throw new Error('Invalid request amount')
  }
  const transport = [{
    type: PaymentRequestTransportType.NOSTR,
    target: nprofile,
    tags: [['n', '17']],
  }]
  const request = new PaymentRequest(
    transport,
    id || makePaymentRequestId(),
    amountSats ?? undefined,
    'sat',
    mints.length ? mints : undefined,
    description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || undefined,
    false,
  )
  return request.toEncodedRequest()
}

/**
 * Build the PaymentRequestPayload object a payer sends to the receiver
 * (as a NIP-17 DM body or an HTTP POST body, JSON-stringified).
 */
export function buildPaymentPayload({ id, memo, mint, proofs }) {
  const payload = { mint, unit: 'sat', proofs }
  if (id) payload.id = id
  if (memo) payload.memo = String(memo).slice(0, MAX_MEMO_LENGTH)
  return payload
}

/** Cheap check so message handlers can skip non-payload content early. */
export function looksLikePaymentPayload(content) {
  if (typeof content !== 'string') return false
  const s = content.trim()
  return s.startsWith('{') && s.includes('"proofs"') && s.includes('"mint"')
}

/**
 * Parse and validate an incoming PaymentRequestPayload JSON string.
 * Returns { valid: true, ... } or { valid: false }.
 * Note: some wallets send an empty unit string; that is treated as sat.
 */
export function parsePaymentPayload(content) {
  if (!looksLikePaymentPayload(content) || content.length > MAX_PAYLOAD_LENGTH) {
    return { valid: false }
  }

  let payload
  try {
    payload = JSON.parse(content)
  } catch {
    return { valid: false }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false }

  const unit = payload.unit || 'sat'
  if (unit !== 'sat') return { valid: false }

  let mint
  try {
    mint = requireSecureUrl(payload.mint, { allowLoopback: true }).toString().replace(/\/$/, '')
  } catch {
    return { valid: false }
  }

  const proofs = payload.proofs
  if (!Array.isArray(proofs) || proofs.length === 0 || proofs.length > MAX_PAYLOAD_PROOFS) {
    return { valid: false }
  }
  let amountSats = 0
  for (const proof of proofs) {
    if (!proof || typeof proof !== 'object'
      || !Number.isSafeInteger(proof.amount) || proof.amount <= 0
      || typeof proof.secret !== 'string' || !proof.secret || proof.secret.length > 1000
      || typeof proof.C !== 'string' || !proof.C
      || typeof proof.id !== 'string' || !proof.id) {
      return { valid: false }
    }
    amountSats += proof.amount
    if (!Number.isSafeInteger(amountSats)) return { valid: false }
  }

  return {
    valid: true,
    id: typeof payload.id === 'string' ? payload.id.slice(0, 64) : '',
    memo: typeof payload.memo === 'string' ? payload.memo.slice(0, MAX_MEMO_LENGTH) : '',
    mint,
    mintHost: new URL(mint).host,
    unit: 'sat',
    proofs,
    amountSats,
  }
}

/**
 * Convert a validated payload into a standard cashu token string so it can
 * be redeemed through the existing token-receive path.
 */
export function payloadToToken(payload) {
  return getEncodedToken({
    mint: payload.mint,
    unit: 'sat',
    proofs: payload.proofs,
    memo: payload.memo || undefined,
  })
}
