/**
 * Shared timing and limit constants.
 *
 * Only constants imported by 2+ files live here.
 * Single-use constants stay local to their file.
 */

// Cache TTLs (used by lib/relays.js via TtlCache)
export const NIP65_CACHE_TTL = 15 * 60 * 1000
export const NIP11_CACHE_TTL = 30 * 60 * 1000

// Messaging timeouts (used by composables/useMessaging.js)
export const MESSAGING_DEFAULT_TIMEOUT = 15000
export const MESSAGING_SLOW_TIMEOUT = 45000

// Logger (used by lib/logger.js)
export const LOGGER_FLUSH_INTERVAL = 5000
export const LOGGER_MAX_ENTRIES = 200
