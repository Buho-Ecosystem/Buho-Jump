/** In-memory browser-session rate limiting for master-password verification. */

const KEY = 'masterPasswordRateLimit'
const FREE_FAILURES = 4
const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 15 * 60_000

export async function checkPasswordRateLimit(storage = chrome.storage.session, now = Date.now()) {
  const data = await storage.get(KEY)
  const state = data[KEY]
  if (!state?.blockedUntil || state.blockedUntil <= now) return { allowed: true, retryAfter: 0 }
  return { allowed: false, retryAfter: Math.ceil((state.blockedUntil - now) / 1000) }
}

export async function recordPasswordFailure(storage = chrome.storage.session, now = Date.now()) {
  const data = await storage.get(KEY)
  const failures = Math.max(0, Number(data[KEY]?.failures) || 0) + 1
  const exponent = Math.max(0, failures - FREE_FAILURES - 1)
  const delay = failures > FREE_FAILURES
    ? Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** exponent))
    : 0
  const state = { failures, blockedUntil: delay ? now + delay : 0 }
  await storage.set({ [KEY]: state })
  return { allowed: delay === 0, retryAfter: Math.ceil(delay / 1000) }
}

export async function clearPasswordFailures(storage = chrome.storage.session) {
  await storage.remove(KEY)
}
