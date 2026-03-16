import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { lnurl } from 'nostr-core'
import { isSARetailerQR, isConvertibleQR, getMerchantInfo, convertToLightningAddress } from './merchantQR.js'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function truncateKey(key, start = 10, end = 6) {
  if (!key || key.length <= start + end) return key
  return key.slice(0, start) + '\u2026' + key.slice(-end)
}

export function msatsToSats(msats) {
  return Math.floor(msats / 1000)
}

export function satsToMsats(sats) {
  return sats * 1000
}

export function formatSats(sats) {
  return new Intl.NumberFormat().format(sats)
}

/**
 * Format a unix timestamp as a relative time string.
 * Accepts an optional i18n translator `t` to return translated strings.
 * Falls back to compact English (e.g. "5m") when no translator is provided.
 */
export function formatTimestamp(ts, t) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = (now - d) / 1000

  if (t) {
    if (diff < 60) return t('chat.justNow')
    if (diff < 3600) return t('chat.minutesAgo', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('chat.hoursAgo', { n: Math.floor(diff / 3600) })
    if (diff < 604800) return t('chat.daysAgo', { n: Math.floor(diff / 86400) })
  } else {
    if (diff < 60) return 'now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  }

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatFullDate(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Detect what a payment input string is.
 * Returns { type, value } where type is 'invoice', 'lnurl', 'lnaddress', or 'unknown'.
 */
export function detectPaymentInput(input) {
  const s = input.trim()
  const lower = s.toLowerCase()

  // SA retail QR codes (Pick n Pay, Checkers, Shoprite, Woolworths, etc.)
  if (isSARetailerQR(s)) {
    const merchant = getMerchantInfo(s)
    if (isConvertibleQR(s)) {
      const lnAddress = convertToLightningAddress(s)
      return { type: 'merchant', value: lnAddress, merchant, qrPayload: s }
    }
    return { type: 'merchant-unsupported', value: s, merchant }
  }

  // Lightning invoices
  if (lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')) {
    return { type: 'invoice', value: lower }
  }

  // Strip lightning: prefix and re-detect
  if (lower.startsWith('lightning:')) {
    return detectPaymentInput(s.slice(10))
  }

  // LUD-17 scheme URLs — detect specific type for routing
  if (lower.startsWith('lnurlp://')) return { type: 'lnurl', value: s, lnurlType: 'pay' }
  if (lower.startsWith('lnurlw://')) return { type: 'lnurl', value: s, lnurlType: 'withdraw' }
  if (lower.startsWith('keyauth://')) return { type: 'lnurl', value: s, lnurlType: 'auth' }

  // Legacy bech32-encoded LNURL (via nostr-core)
  if (lnurl.isLnurl(s)) {
    return { type: 'lnurl', value: s }
  }

  // Lightning Address
  if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) {
    return { type: 'lnaddress', value: s }
  }

  return { type: 'unknown', value: s }
}
