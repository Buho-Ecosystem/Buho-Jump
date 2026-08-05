import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { lnurl } from 'nostr-core'
import { isSARetailerQR, isConvertibleQR, getMerchantInfo, convertToLightningAddress } from './merchantQR.js'
import { recognizePhoneNumber, matchMobilePaymentAddress } from './mobilePayments.js'

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
 * Strip protocol markers and metadata comments from chat message content.
 * Some clients embed markdown comments like `[//]: # (nip18)` in NIP-17 messages.
 */
export function cleanMessageContent(content) {
  if (!content) return ''
  return content
    .replace(/\[\/\/\]:\s*#\s*\([^)]*\)\s*/g, '')
    .trim()
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

  // Cashu ecash tokens
  if (s.startsWith('cashuA') || s.startsWith('cashuB')) {
    return { type: 'ecash-token', value: s }
  }

  // Cashu payment requests — NUT-18 (creqA) and NUT-26 (creqb)
  if (lower.startsWith('creqa') || lower.startsWith('creqb')) {
    return { type: 'payment-request', value: s }
  }

  // BIP-321 bitcoin: URIs — may carry a Lightning invoice and/or a Cashu
  // payment request. Lightning is preferred because any wallet type can pay it.
  if (lower.startsWith('bitcoin:')) {
    const query = s.includes('?') ? s.slice(s.indexOf('?') + 1) : ''
    let creq = ''
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const key = pair.slice(0, eq).toLowerCase()
      let value
      try { value = decodeURIComponent(pair.slice(eq + 1)).trim() } catch { continue }
      if (key === 'lightning' && value) return detectPaymentInput(value)
      if (key === 'creq' && value) creq = value
    }
    if (creq) return detectPaymentInput(creq)
    return { type: 'unknown', value: s }
  }

  // Keep large but valid token/invoice carriers above this guard. Other
  // payment inputs come from QR codes or short addresses; bounding them avoids
  // expensive regex and bech32 work on hostile pasted strings.
  if (s.length > 8192) {
    if (lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')) {
      return { type: 'invoice', value: lower }
    }
    return { type: 'unknown', value: s }
  }

  // Phone payout rails must run before retail QR detection because both may
  // be plain numeric strings. Recognition only accepts known mobile prefixes.
  const mobile = recognizePhoneNumber(s)
  if (mobile) {
    return { type: 'mobile-payment', value: mobile.lightningAddress, mobile }
  }

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

  // Nostr identity — npub or nprofile (resolve profile → Lightning address)
  if (lower.startsWith('npub1') || lower.startsWith('nprofile1')) {
    return { type: 'nostr-identity', value: s }
  }

  // Lightning Address
  if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) {
    return { type: 'lnaddress', value: s, mobile: matchMobilePaymentAddress(s) }
  }

  console.debug('[send] Unrecognized payment input:', s.slice(0, 30))
  return { type: 'unknown', value: s }
}
