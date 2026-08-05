/**
 * LNbits client — REST API + WebSocket.
 *
 * REST: stateless HTTP wrapper for wallet operations.
 * WebSocket: persistent connection for real-time payment notifications.
 *
 * All methods accept { apiUrl, adminKey } from the stored wallet config.
 * Balance is returned by LNbits in millisatoshis; this module
 * normalises everything to satoshis for consistency with NWC/Cashu.
 */

import { requireSecureUrl } from './origins.js'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export function normalizeLnbitsUrl(apiUrl) {
  const url = requireSecureUrl(apiUrl, { allowLoopback: true })
  if (url.search) throw new Error('LNbits URL must not contain a query')
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

// ── REST API ────────────────────────────────────────────────────

/**
 * Validate credentials and fetch wallet info.
 * Use this on connect to verify the URL + key before storing.
 * @param {string} apiUrl - e.g. "https://legend.lnbits.com"
 * @param {string} adminKey
 * @returns {{ id: string, name: string, balance: number }}
 */
export async function lnbitsConnect(apiUrl, adminKey) {
  const info = await lnbitsRequest(apiUrl, adminKey, 'GET', '/api/v1/wallet')
  return {
    id: info.id,
    name: info.name,
    balance: Math.floor((info.balance ?? 0) / 1000),
  }
}

/**
 * Get wallet balance in sats.
 */
export async function lnbitsGetBalance(apiUrl, adminKey) {
  const res = await lnbitsRequest(apiUrl, adminKey, 'GET', '/api/v1/wallet')
  return Math.floor((res.balance ?? 0) / 1000)
}

/**
 * Create a Lightning invoice (receive).
 * @returns {{ invoice: string, payment_hash: string, checking_id: string }}
 */
export async function lnbitsMakeInvoice(apiUrl, adminKey, amountSats, memo) {
  const res = await lnbitsRequest(apiUrl, adminKey, 'POST', '/api/v1/payments', {
    out: false,
    amount: amountSats,
    memo: memo || '',
  })
  return {
    invoice: res.payment_request,
    payment_hash: res.payment_hash,
    checking_id: res.checking_id,
  }
}

/**
 * Pay a Lightning invoice (send). Requires admin key.
 * @returns {{ payment_hash: string, preimage: string }}
 */
export async function lnbitsPayInvoice(apiUrl, adminKey, bolt11, amountSats) {
  const body = {
    out: true,
    bolt11,
  }
  // LNbits accepts an explicit amount for amountless BOLT-11 invoices.
  if (amountSats != null) body.amount = amountSats
  const res = await lnbitsRequest(apiUrl, adminKey, 'POST', '/api/v1/payments', body)
  return {
    payment_hash: res.payment_hash,
    preimage: res.preimage || res.payment_hash,
  }
}

/**
 * Check whether a specific payment has been settled.
 * @returns {{ paid: boolean, details?: object }}
 */
export async function lnbitsCheckPayment(apiUrl, adminKey, checkingId) {
  return await lnbitsRequest(apiUrl, adminKey, 'GET', `/api/v1/payments/${checkingId}`)
}

/**
 * List payments (transactions).
 * @param {object} opts - { limit, offset }
 * @returns {Array} raw LNbits payment objects
 */
export async function lnbitsListPayments(apiUrl, adminKey, opts = {}) {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  const qs = params.toString()
  return await lnbitsRequest(apiUrl, adminKey, 'GET', `/api/v1/payments${qs ? '?' + qs : ''}`)
}

// ── WebSocket ───────────────────────────────────────────────────

/**
 * Manage a WebSocket connection to an LNbits instance for real-time
 * payment notifications. Handles reconnection with exponential backoff.
 *
 * Usage:
 *   const ws = createLnbitsWs(wallet, (amountSats, hash) => { ... })
 *   // later:
 *   ws.close()
 *
 * @param {{ apiUrl: string, lnbitsWalletId: string }} wallet
 * @param {(amountSats: number, paymentHash: string) => void} onPayment
 * @param {{ log?: Function }} opts
 * @returns {{ close: () => void }}
 */
export function createLnbitsWs(wallet, onPayment, opts = {}) {
  const log = opts.log || (() => {})
  const baseUrl = new URL(normalizeLnbitsUrl(wallet.apiUrl))
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const walletId = String(wallet.lnbitsWalletId || '')
  if (!walletId || walletId.length > 256) throw new Error('Invalid LNbits wallet ID')
  const path = `${baseUrl.pathname.replace(/\/$/, '')}/api/v1/ws/${encodeURIComponent(walletId)}`
  const wsUrl = `${protocol}//${baseUrl.host}${path}`
  const host = baseUrl.host

  let ws = null
  let retryTimer = null
  let retryDelay = 2000
  let closed = false // Explicit close flag — stops reconnect

  function connect() {
    if (closed) return
    try {
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        retryDelay = 2000 // Reset backoff on success
        log('info', 'lnbits', 'WS_CONNECTED', { host })
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          // LNbits sends { payment: { amount, payment_hash, ... } } for incoming payments
          if (msg.payment && msg.payment.amount > 0) {
            const amountSats = Math.floor(msg.payment.amount / 1000)
            onPayment(amountSats, msg.payment.payment_hash || '')
          }
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        ws = null
        if (closed) return
        // Reconnect with exponential backoff, max 30s
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 30000)
          connect()
        }, retryDelay)
      }

      ws.onerror = () => {
        // onclose fires after onerror — reconnect happens there
        log('debug', 'lnbits', 'WS_ERROR', { host })
      }
    } catch (err) {
      log('warn', 'lnbits', 'WS_CONNECT_FAILED', { err: err?.message })
    }
  }

  connect()

  return {
    close() {
      closed = true
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
      if (ws) { try { ws.close() } catch { /* best-effort */ } ws = null }
    },
  }
}

// ── Internal ────────────────────────────────────────────────────

async function lnbitsRequest(apiUrl, adminKey, method, path, body) {
  const baseUrl = normalizeLnbitsUrl(apiUrl)
  if (typeof adminKey !== 'string' || !adminKey || adminKey.length > 4096) {
    throw new Error('Enter a valid LNbits API key')
  }
  const url = baseUrl + path
  const headers = { 'X-Api-Key': adminKey, 'Content-Type': 'application/json' }

  const init = { method, headers, redirect: 'error' }
  if (body) init.body = JSON.stringify(body)

  const res = await fetch(url, init)

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const err = await res.json()
      if (err.detail) detail = err.detail
    } catch { /* ignore parse errors */ }
    throw new Error(detail)
  }

  const responseLength = Number(res.headers?.get?.('content-length'))
  if (Number.isFinite(responseLength) && responseLength > MAX_RESPONSE_BYTES) {
    throw new Error('LNbits response is too large')
  }

  return await res.json()
}
