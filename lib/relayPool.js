/**
 * Shared relay pool singleton.
 * Used by chat, contacts, and profile fetching.
 *
 * Relay URL lists are managed in lib/relays.js — per-account, per-pool.
 * NOTE: Do NOT import from ./relays.js here to avoid circular dependency
 * (relays.js imports getPool from here).
 */

import { RelayPool } from 'nostr-core'

// Re-export for backward compat — consumers should migrate to lib/relays.js
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
]

let pool = null

export function getPool() {
  if (!pool) pool = new RelayPool()
  return pool
}
