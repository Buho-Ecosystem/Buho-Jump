/**
 * LNURL support — thin adapter over nostr-core's lnurl module.
 *
 * All protocol logic (bech32, LUD-01–21, pay/withdraw) lives in nostr-core.
 * This module provides sats-denominated convenience wrappers for the extension
 * (nostr-core uses millisatoshis natively).
 */

import {
  lnurl as lnurlCore,
} from 'nostr-core'

// Re-export primitives for direct use
export const { decodeLnurl, encodeLnurl, isLnurl, resolveUrl, parseLnurlMetadata } = lnurlCore

/**
 * Fetch LNURL-pay parameters.
 * Accepts any LNURL format: bech32, LUD-17 scheme, raw URL, or Lightning Address.
 * Returns amounts in sats (converted from nostr-core's msats).
 */
export async function fetchLnurlPayParams(input) {
  const payReq = await lnurlCore.fetchPayRequest(input)
  return {
    callback: payReq.callback,
    minSendable: Math.ceil(payReq.minSendable / 1000),
    maxSendable: Math.floor(payReq.maxSendable / 1000),
    metadata: payReq.metadata || '[]',
    commentAllowed: payReq.commentAllowed || 0,
    tag: payReq.tag,
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
export async function fetchLnurlPayInvoice(payParams, amountSats, comment) {
  const opts = comment ? { comment } : undefined
  const result = await lnurlCore.requestInvoice(payParams._raw, amountSats * 1000, opts)
  return {
    invoice: result.pr,
    successAction: result.successAction || null,
    verify: result.verify || null,
  }
}

/**
 * Full LNURL-pay flow: resolve → fetch params → get invoice.
 */
export async function executeLnurlPay(input, amountSats, comment) {
  const params = await fetchLnurlPayParams(input)

  if (amountSats < params.minSendable) {
    throw new Error(`Minimum amount is ${params.minSendable} sats`)
  }
  if (amountSats > params.maxSendable) {
    throw new Error(`Maximum amount is ${params.maxSendable} sats`)
  }

  return await fetchLnurlPayInvoice(params, amountSats, comment)
}
