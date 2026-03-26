/**
 * Shared relay pool singleton with NIP-42 auto-auth.
 * Used by chat, contacts, profile fetching, and relay publishing.
 *
 * Relay URL lists are managed in lib/relays.js — per-account, per-pool.
 * NOTE: Do NOT import from ./relays.js here to avoid circular dependency.
 */

import { RelayPool } from 'nostr-core'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://purplepag.es',
  'wss://relay.snort.social',
]

let pool = null
let _authHandler = null
let _authedRelays = null // reference to the Set inside getPool(), for reset

/**
 * Set the NIP-42 auth handler. Called from background.js on startup.
 * The handler receives (relayUrl, challenge) and should sign + send the auth event.
 */
export function setAuthHandler(handler) {
  _authHandler = handler
}

/** Get the auth handler (used internally by the patched pool). */
export function getAuthHandler() {
  return _authHandler
}

export function getPool() {
  if (!pool) {
    pool = new RelayPool()

    // Monkey-patch ensureRelay to attach NIP-42 auth on every new relay
    const originalEnsureRelay = pool.ensureRelay.bind(pool)
    const authedRelays = new Set()
    _authedRelays = authedRelays

    pool.ensureRelay = async function (url, opts) {
      const relay = await originalEnsureRelay(url, opts)
      if (!authedRelays.has(relay.url)) {
        authedRelays.add(relay.url)
        relay.onauth = (challenge) => {
          const handler = getAuthHandler()
          if (handler) handler(relay, challenge)
        }
      }
      return relay
    }
  }
  return pool
}

/**
 * Clear the set of relays that have had NIP-42 auth handlers attached.
 * Call on account switch so auth challenges are re-handled with the new account's key.
 */
export function resetAuthedRelays() {
  if (_authedRelays) _authedRelays.clear()
}

/**
 * Get connection status for all relays in the pool.
 * @returns {Map<string, boolean>} url → connected
 */
export function getRelayStatus() {
  if (!pool) return new Map()
  return pool.listConnectionStatus()
}
