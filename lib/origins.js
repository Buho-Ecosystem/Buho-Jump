/**
 * Canonical web-origin and transport validation.
 *
 * Security decisions must be scoped to an origin (scheme + host + port), never
 * to a hostname. Keeping this logic in one module prevents permission, budget,
 * login, and wallet flows from slowly developing different trust boundaries.
 */

const WEB_PROTOCOLS = new Set(['https:', 'http:'])

export function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (value === 'localhost' || value === '::1') return true
  const octets = value.split('.').map(Number)
  return octets.length === 4
    && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && octets[0] === 127
}

/** Return a canonical http(s) origin, or null for malformed/non-web input. */
export function normalizeWebOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    if (!WEB_PROTOCOLS.has(url.protocol) || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function isCanonicalWebOrigin(value) {
  return normalizeWebOrigin(value) === value
}

/**
 * Validate a URL used for secrets or financial traffic.
 * HTTPS is mandatory. Plain HTTP is allowed only for explicit loopback
 * development endpoints when allowLoopback is true.
 */
export function requireSecureUrl(value, { allowLoopback = false } = {}) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('Enter a valid URL')
  }
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed')
  const secure = url.protocol === 'https:'
  const loopback = allowLoopback && url.protocol === 'http:' && isLoopbackHostname(url.hostname)
  if (!secure && !loopback) throw new Error('A secure HTTPS URL is required')
  url.hash = ''
  return url
}

/** Exact optional-host permission pattern, preserving non-default ports. */
export function originPermissionPattern(origin) {
  const normalized = normalizeWebOrigin(origin)
  if (!normalized) throw new Error('A valid website origin is required')
  return `${normalized}/*`
}
