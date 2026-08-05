/**
 * LNURL support — thin adapter over nostr-core's lnurl module.
 *
 * All protocol logic (bech32, LUD-01–21, pay/withdraw) lives in nostr-core.
 * This module provides sats-denominated convenience wrappers for the extension
 * (nostr-core uses millisatoshis natively).
 */

import {
  lnurl as lnurlCore,
  fetchWithdrawRequest as fetchWithdrawReq,
  decodeBolt11,
} from 'nostr-core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { parseSuccessAction } from './lnurlSuccess.js'
import { validateVerifyUrl } from './lnurlVerify.js'
import { requireSecureUrl } from './origins.js'

// Re-export primitives for direct use
export const { decodeLnurl, encodeLnurl, isLnurl, resolveUrl, parseLnurlMetadata } = lnurlCore

/**
 * Verify a payment via LUD-21 verify URL.
 * Returns { settled: boolean, preimage?, pr? } or null on failure.
 */
export async function verifyLnurlPayment(verifyUrl) {
  if (!verifyUrl) return null
  try {
    return await lnurlCore.verifyPayment({ verify: requireSecureUrl(verifyUrl).toString() })
  } catch {
    return null
  }
}

function lightningAddressUrl(input) {
  if (typeof input !== 'string') return null
  const match = input.trim().match(/^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i)
  if (!match) return null
  return `https://${match[2]}/.well-known/lnurlp/${encodeURIComponent(match[1])}`
}

export function resolveLnurlServiceUrl(input) {
  const resolved = lightningAddressUrl(input) || lnurlCore.resolveUrl(input)
  const url = typeof resolved === 'string' ? resolved : resolved?.url
  return requireSecureUrl(url).toString()
}

function normalizeCurrency(currency) {
  if (!currency || typeof currency !== 'object') return null
  const code = typeof currency.code === 'string' ? currency.code.trim().toUpperCase() : ''
  const multiplier = Number(currency.multiplier)
  if (!/^[A-Z]{3,8}$/.test(code) || !Number.isFinite(multiplier) || multiplier <= 0) return null
  return {
    code,
    symbol: typeof currency.symbol === 'string' ? currency.symbol : code,
    decimals: Number.isInteger(currency.decimals) ? currency.decimals : 0,
    minSendable: Number(currency.minSendable) || 0,
    maxSendable: Number(currency.maxSendable) || 0,
    multiplier,
  }
}

async function fetchLightningAddressPayRequest(input) {
  const url = lightningAddressUrl(input)
  if (!url) return null
  const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`LNURL HTTP ${response.status}`)
  const data = await response.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error')
  if (data.tag !== 'payRequest' || !data.callback) throw new Error('Invalid Lightning Address response')
  return data
}

function validatePayRequest(payReq) {
  if (!payReq || payReq.tag !== 'payRequest') throw new Error('Invalid LNURL pay response')
  requireSecureUrl(payReq.callback)
  const min = Number(payReq.minSendable)
  const max = Number(payReq.maxSendable)
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min <= 0 || max < min) {
    throw new Error('Invalid LNURL amount range')
  }
  if (typeof payReq.metadata !== 'string' || payReq.metadata.length > 65_536) {
    throw new Error('Invalid LNURL metadata')
  }
  try {
    if (!Array.isArray(JSON.parse(payReq.metadata))) throw new Error()
  } catch {
    throw new Error('Invalid LNURL metadata')
  }
  const commentAllowed = Number(payReq.commentAllowed || 0)
  if (!Number.isSafeInteger(commentAllowed) || commentAllowed < 0 || commentAllowed > 2_000) {
    throw new Error('Invalid LNURL comment limit')
  }
  return payReq
}

/**
 * Bind an LNURL callback invoice to the exact request the user approved.
 * LUD-06 requires the invoice description hash to commit to the metadata.
 */
export function validateLnurlInvoice(invoice, amountMsat, metadata) {
  if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) {
    throw new Error('Invalid LNURL payment amount')
  }
  let decoded
  try {
    decoded = decodeBolt11(invoice)
  } catch {
    throw new Error('LNURL callback returned an invalid invoice')
  }
  if (decoded.isExpired) throw new Error('LNURL callback returned an expired invoice')
  if (!Number.isSafeInteger(decoded.amountMsat) || decoded.amountMsat !== amountMsat) {
    throw new Error('LNURL invoice amount does not match the approved amount')
  }

  const metadataText = typeof metadata === 'string' ? metadata : '[]'
  const expectedHash = bytesToHex(sha256(utf8ToBytes(metadataText)))
  if (typeof decoded.descriptionHash !== 'string'
    || decoded.descriptionHash.toLowerCase() !== expectedHash) {
    throw new Error('LNURL invoice metadata does not match the payment request')
  }
  return decoded
}

/**
 * Fetch LNURL-pay parameters.
 * Accepts any LNURL format: bech32, LUD-17 scheme, raw URL, or Lightning Address.
 * Returns amounts in sats (converted from nostr-core's msats).
 */
export async function fetchLnurlPayParams(input) {
  // nostr-core intentionally returns the standard LNURL fields. For a
  // Lightning Address we fetch the same endpoint directly so optional
  // LUD-21 local-currency data is not discarded.
  const payReq = validatePayRequest(await fetchLightningAddressPayRequest(input)
    || await lnurlCore.fetchPayRequest(input))
  return {
    callback: payReq.callback,
    minSendable: Math.ceil(payReq.minSendable / 1000),
    maxSendable: Math.floor(payReq.maxSendable / 1000),
    // Raw millisatoshi bounds — use these for fixed-amount LNURL (e.g. merchant
    // QRs) where the value is not a whole number of sats and rounding to sats
    // would fall outside the service's allowed range.
    minSendableMsat: payReq.minSendable,
    maxSendableMsat: payReq.maxSendable,
    metadata: payReq.metadata || '[]',
    commentAllowed: payReq.commentAllowed || 0,
    tag: payReq.tag,
    currency: normalizeCurrency(payReq.currency),
    // Keep the raw response for requestInvoice
    _raw: payReq,
  }
}

/**
 * Execute LNURL-pay callback to get an invoice.
 * @param {object} payParams - Result from fetchLnurlPayParams (with _raw)
 * @param {number} amountSats - Amount in sats
 * @param {string} [comment] - Optional comment
 * @returns {{ invoice: string, successAction: object|null, verify: string|null }}
 */
export async function fetchLnurlPayInvoice(payParams, amountSats, comment, payout = null) {
  return fetchLnurlPayInvoiceMsat(payParams, amountSats * 1000, comment, payout)
}

/**
 * Execute the LNURL-pay callback using a raw millisatoshi amount (no sat
 * rounding). Use this for fixed-amount LNURL such as merchant QRs, where the
 * value is not a whole number of sats.
 * @param {object} payParams - Result from fetchLnurlPayParams (with _raw)
 * @param {number} amountMsat - Amount in millisatoshis
 * @param {string} [comment] - Optional comment
 * @returns {{ invoice: string, successAction: object|null, verify: string|null }}
 */
export async function fetchLnurlPayInvoiceMsat(payParams, amountMsat, comment, payout = null) {
  let result
  const callback = payParams.callback || payParams._raw?.callback
  const secureCallback = requireSecureUrl(callback).toString()
  if (payout?.code && Number(payout.amount) > 0) {
    const separator = secureCallback.includes('?') ? '&' : '?'
    let url = `${secureCallback}${separator}amount=${encodeURIComponent(payout.amount)}&currency=${encodeURIComponent(payout.code)}`
    if (comment && payParams.commentAllowed > 0) {
      url += `&comment=${encodeURIComponent(String(comment).slice(0, payParams.commentAllowed))}`
    }
    const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`LNURL callback HTTP ${response.status}`)
    result = await response.json()
    if (result.status === 'ERROR') throw new Error(result.reason || 'LNURL callback error')
    if (!result.pr) throw new Error('LNURL callback did not return an invoice')
  } else {
    const opts = comment ? { comment } : undefined
    result = await lnurlCore.requestInvoice(payParams._raw, amountMsat, opts)
  }
  const decodedInvoice = validateLnurlInvoice(
    result.pr,
    amountMsat,
    payParams.metadata || payParams._raw?.metadata || '[]',
  )
  return {
    invoice: result.pr,
    amountMsat: decodedInvoice.amountMsat,
    successAction: parseSuccessAction(result.successAction, callback),
    verify: validateVerifyUrl(result.verify, callback),
    callback: secureCallback,
  }
}

/**
 * Full LNURL-pay flow: resolve → fetch params → get invoice.
 */
export async function executeLnurlPay(input, amountSats, comment, payout = null) {
  const params = await fetchLnurlPayParams(input)

  if (!payout && amountSats < params.minSendable) {
    throw new Error(`Minimum amount is ${params.minSendable} sats`)
  }
  if (!payout && amountSats > params.maxSendable) {
    throw new Error(`Maximum amount is ${params.maxSendable} sats`)
  }

  return await fetchLnurlPayInvoice(params, amountSats, comment, payout)
}

// ── LNURL-withdraw (LUD-03) ─────────────────────────────────────

/**
 * Fetch LNURL-withdraw parameters.
 * Accepts any LNURL format: bech32, LUD-17 scheme, raw URL.
 * Returns amounts in sats (converted from nostr-core's msats).
 */
export async function fetchLnurlWithdrawParams(input) {
  const withdrawReq = await fetchWithdrawReq(input)
  const callback = requireSecureUrl(withdrawReq.callback).toString()
  if (!/^[0-9a-f]{64}$/i.test(withdrawReq.k1 || '')) throw new Error('Invalid LNURL withdraw challenge')
  if (!Number.isSafeInteger(withdrawReq.minWithdrawable)
    || !Number.isSafeInteger(withdrawReq.maxWithdrawable)
    || withdrawReq.minWithdrawable <= 0
    || withdrawReq.maxWithdrawable < withdrawReq.minWithdrawable) {
    throw new Error('Invalid LNURL withdraw amount range')
  }
  return {
    callback,
    k1: withdrawReq.k1,
    defaultDescription: withdrawReq.defaultDescription || '',
    minWithdrawable: Math.ceil(withdrawReq.minWithdrawable / 1000),
    maxWithdrawable: Math.floor(withdrawReq.maxWithdrawable / 1000),
    tag: withdrawReq.tag,
    _raw: { ...withdrawReq, callback },
  }
}

/**
 * Execute LNURL-withdraw: submit a BOLT-11 invoice to the service.
 * The service will pay the invoice, so the user receives sats.
 * @param {object} withdrawParams - Result from fetchLnurlWithdrawParams (with _raw)
 * @param {string} invoice - BOLT-11 invoice generated by the user's wallet
 */
export async function executeLnurlWithdraw(withdrawParams, invoice) {
  const raw = withdrawParams?._raw || withdrawParams
  const callback = requireSecureUrl(raw?.callback).toString()
  if (!/^[0-9a-f]{64}$/i.test(raw?.k1 || '')) throw new Error('Invalid LNURL withdraw challenge')
  if (typeof invoice !== 'string' || !invoice.toLowerCase().startsWith('ln') || invoice.length > 16_384) {
    throw new Error('Invalid Lightning invoice')
  }
  const url = new URL(callback)
  url.searchParams.set('k1', raw.k1)
  url.searchParams.set('pr', invoice)
  const response = await fetch(url, { redirect: 'error', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`LNURL callback HTTP ${response.status}`)
  const result = await response.json()
  if (result?.status === 'ERROR') throw new Error(result.reason || 'LNURL withdraw was rejected')
}
