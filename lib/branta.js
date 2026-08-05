/**
 * Optional strict-privacy merchant verification through Branta.
 * A miss or network error is normal and never blocks a payment.
 */
import { BrantaServerBaseUrl } from '@branta-ops/branta'
import { BrantaService } from '@branta-ops/branta/v2'

export const BRANTA_LOOKUP_TIMEOUT_MS = 8_000
const CACHE_LIMIT = 100
const cache = new Map()
let service = null

function getService() {
  service ||= new BrantaService({ baseUrl: BrantaServerBaseUrl.Production, privacy: 'strict' })
  return service
}

function safeHttps(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export function normalizeBrantaResult(result) {
  const payment = Array.isArray(result?.payments) ? result.payments[0] : null
  if (!payment) return null
  const normalized = {
    name: typeof payment.platform === 'string' ? payment.platform.trim() : '',
    logoUrl: safeHttps(payment.platformLogoUrl),
    logoLightUrl: safeHttps(payment.platformLogoLightUrl),
    description: typeof payment.description === 'string' ? payment.description.trim() : '',
    verifyUrl: safeHttps(result.verifyUrl),
  }
  return Object.values(normalized).some(Boolean) ? normalized : null
}

export async function lookupBrantaVerification({ qrText, signal } = {}) {
  const value = typeof qrText === 'string' ? qrText.trim() : ''
  if (!value) return null
  if (cache.has(value)) return cache.get(value)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener?.('abort', abort, { once: true })
  const timer = setTimeout(abort, BRANTA_LOOKUP_TIMEOUT_MS)
  try {
    const result = await getService().getPaymentsByQrCode(value, undefined, controller.signal)
    const normalized = normalizeBrantaResult(result)
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
    cache.set(value, normalized)
    return normalized
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', abort)
  }
}
