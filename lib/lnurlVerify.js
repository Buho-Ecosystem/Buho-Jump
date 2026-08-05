/**
 * Safe, non-blocking LUD-21 payment and payout-delivery verification.
 */

import { requireSecureUrl } from './origins.js'

export function validateVerifyUrl(verifyUrl, callbackUrl) {
  if (typeof verifyUrl !== 'string' || !verifyUrl) return null
  try {
    const verify = new URL(verifyUrl)
    const callback = new URL(callbackUrl)
    if (verify.protocol !== 'https:' || verify.username || verify.password || verify.origin !== callback.origin) return null
    return verify.toString()
  } catch {
    return null
  }
}

export function normalizeVerifyResponse(data) {
  const payout = data && typeof data.mpesa === 'object' && data.mpesa
    ? data.mpesa
    : (data && typeof data.payout === 'object' && data.payout ? data.payout : null)
  return {
    hasPayout: !!payout,
    settled: data?.settled === true,
    delivered: payout?.delivered === true,
    receipt: payout?.receipt || null,
    recipient: payout?.recipient || null,
    amount: Number.isFinite(payout?.amount) ? payout.amount : null,
    completedAt: payout?.completedAt || null,
  }
}

export async function pollVerify(verifyUrl, onUpdate, options = {}) {
  const {
    timeoutMs = 90_000,
    intervalMs = 3_000,
    maxIntervalMs = 15_000,
    fetchTimeoutMs = 10_000,
    signal = null,
    expectPayout = false,
  } = options
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || (() => Date.now())
  if (!verifyUrl || typeof fetchImpl !== 'function') return null
  try { verifyUrl = requireSecureUrl(verifyUrl).toString() } catch { return null }

  const deadline = now() + timeoutMs
  let latest = null
  let waitMs = intervalMs

  while (!signal?.aborted) {
    try {
      const response = await fetchWithTimeout(fetchImpl, verifyUrl, fetchTimeoutMs, signal)
      if (response?.ok) {
        const normalized = normalizeVerifyResponse(await response.json())
        const status = expectPayout && !normalized.hasPayout
          ? { ...normalized, hasPayout: true }
          : normalized
        const changed = !latest
          || status.settled !== latest.settled
          || status.delivered !== latest.delivered
        latest = status
        if (changed && onUpdate) onUpdate(status)
        // Ordinary Lightning verification ends at settled. Fiat-payout
        // services include a payout object and keep polling until delivered.
        if (status.delivered || (status.settled && !status.hasPayout)) return status
      }
    } catch {
      // Verification is a progressive enhancement. Network failures, malformed
      // replies, and aborts never turn a successful payment into a failure.
    }

    if (signal?.aborted || now() >= deadline) return latest
    await sleep(waitMs, signal)
    waitMs = Math.min(Math.floor(waitMs * 1.5) || intervalMs, maxIntervalMs)
  }
  return latest
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    if (signal) {
      if (signal.aborted) finish()
      else signal.addEventListener?.('abort', finish, { once: true })
    }
  })
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs, externalSignal) {
  if (typeof AbortController === 'undefined' || !timeoutMs) {
    return fetchImpl(url, { ...(externalSignal ? { signal: externalSignal } : {}), redirect: 'error' })
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener?.('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  try {
    return await fetchImpl(url, { signal: controller.signal, redirect: 'error' })
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener?.('abort', abort)
  }
}
