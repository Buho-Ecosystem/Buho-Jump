/**
 * LNURL support — decode bech32-encoded LNURLs and execute LNURL-pay flows.
 * Lightning Address resolution is handled by nostr-core's fetchInvoice.
 * This module adds raw LNURL bech32 decoding + LNURL-pay callback execution.
 *
 * Specs: LUD-06 (pay), LUD-16 (Lightning Address)
 */

/**
 * Decode an LNURL to a plain HTTPS URL.
 * Supports:
 * - Legacy bech32-encoded LNURL (lnurl1...)
 * - LUD-17 protocol schemes (lnurlp://, lnurlw://, keyauth://)
 */
export function decodeLnurl(lnurl) {
  const clean = lnurl.trim()
  const lower = clean.toLowerCase()

  // LUD-17: protocol-specific URL schemes → convert to HTTPS
  const lud17Match = lower.match(/^(lnurlp|lnurlw|lnurlc|keyauth):\/\/(.+)/)
  if (lud17Match) {
    const rest = clean.slice(clean.indexOf('://') + 3)
    const isOnion = rest.split('/')[0].endsWith('.onion')
    return `${isOnion ? 'http' : 'https'}://${rest}`
  }

  // Legacy: strip lightning: prefix
  const bech32str = lower.replace('lightning:', '')
  if (!bech32str.startsWith('lnurl1')) return null

  try {
    // Manual bech32 decode (LNURL uses bech32, not bech32m)
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    const data = bech32str.slice(bech32str.indexOf('1') + 1, bech32str.length - 6) // strip prefix + checksum
    const values = []
    for (const c of data) {
      const v = CHARSET.indexOf(c)
      if (v === -1) return null
      values.push(v)
    }

    // Convert 5-bit groups to 8-bit bytes
    let bits = 0
    let value = 0
    const bytes = []
    for (const v of values) {
      value = (value << 5) | v
      bits += 5
      while (bits >= 8) {
        bits -= 8
        bytes.push((value >> bits) & 0xff)
      }
    }

    return new TextDecoder().decode(new Uint8Array(bytes))
  } catch {
    return null
  }
}

/**
 * Fetch LNURL-pay parameters from a decoded URL.
 * Returns: { callback, minSendable, maxSendable, metadata, tag }
 */
export async function fetchLnurlPayParams(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`LNURL server error: ${res.status}`)
  const data = await res.json()

  if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error')
  if (data.tag !== 'payRequest') throw new Error(`Unsupported LNURL type: ${data.tag}`)

  return {
    callback: data.callback,
    minSendable: Math.ceil(data.minSendable / 1000), // msats → sats
    maxSendable: Math.floor(data.maxSendable / 1000),
    metadata: data.metadata || '[]',
    commentAllowed: data.commentAllowed || 0,
    tag: data.tag,
  }
}

/**
 * Execute LNURL-pay callback to get an invoice.
 * @param {string} callback - The callback URL from fetchLnurlPayParams
 * @param {number} amountSats - Amount in sats
 * @param {string} [comment] - Optional comment
 * @returns {{ invoice: string, successAction: object|null }}
 */
export async function fetchLnurlPayInvoice(callback, amountSats, comment) {
  const url = new URL(callback)
  url.searchParams.set('amount', String(amountSats * 1000)) // sats → msats
  if (comment) url.searchParams.set('comment', comment)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`LNURL callback error: ${res.status}`)
  const data = await res.json()

  if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL payment error')
  if (!data.pr) throw new Error('No invoice returned by LNURL service')

  return {
    invoice: data.pr,
    successAction: data.successAction || null,
  }
}

/**
 * Full LNURL-pay flow: decode → fetch params → get invoice.
 */
export async function executeLnurlPay(lnurl, amountSats, comment) {
  const url = decodeLnurl(lnurl)
  if (!url) throw new Error('Invalid LNURL')

  const params = await fetchLnurlPayParams(url)

  if (amountSats < params.minSendable) {
    throw new Error(`Minimum amount is ${params.minSendable} sats`)
  }
  if (amountSats > params.maxSendable) {
    throw new Error(`Maximum amount is ${params.maxSendable} sats`)
  }

  return await fetchLnurlPayInvoice(params.callback, amountSats, comment)
}
