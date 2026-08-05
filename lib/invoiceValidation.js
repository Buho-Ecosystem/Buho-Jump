import { decodeBolt11 } from 'nostr-core'

export const MAX_SAFE_PAYMENT_SATS = Math.floor(Number.MAX_SAFE_INTEGER / 1000)
const MAX_INVOICE_LENGTH = 16_384

function validateAmountSats(amountSats) {
  return Number.isSafeInteger(amountSats)
    && amountSats > 0
    && amountSats <= MAX_SAFE_PAYMENT_SATS
}

/**
 * Decode and validate an invoice at the wallet boundary.
 *
 * Amountless invoices are only valid when the caller supplies the amount the
 * user approved. If both values are present they must agree exactly.
 */
export function validatePaymentInvoice(invoice, amountSats) {
  if (typeof invoice !== 'string' || invoice.length === 0 || invoice.length > MAX_INVOICE_LENGTH) {
    throw new Error('Invalid Lightning invoice')
  }

  let decoded
  try {
    decoded = decodeBolt11(invoice)
  } catch {
    throw new Error('Invalid Lightning invoice')
  }

  if (decoded.isExpired) throw new Error('Lightning invoice has expired')

  const invoiceAmountMsat = decoded.amountMsat
  if (invoiceAmountMsat == null) {
    if (!validateAmountSats(amountSats)) {
      const error = new Error('Amountless invoice requires an amount')
      error.code = 'INVOICE_AMOUNT_REQUIRED'
      throw error
    }
    return { decoded, amountMsat: amountSats * 1000, amountSats }
  }

  if (!Number.isSafeInteger(invoiceAmountMsat) || invoiceAmountMsat <= 0) {
    throw new Error('Invalid Lightning invoice amount')
  }
  if (amountSats != null && (!validateAmountSats(amountSats) || amountSats * 1000 !== invoiceAmountMsat)) {
    throw new Error('Lightning invoice amount does not match the approved amount')
  }

  return {
    decoded,
    amountMsat: invoiceAmountMsat,
    amountSats: Math.ceil(invoiceAmountMsat / 1000),
  }
}
