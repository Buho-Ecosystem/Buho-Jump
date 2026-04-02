/**
 * NIP-60 relay sync — publish/fetch Cashu wallet events.
 *
 * Strategy: local-first, relay-backup.
 * - Local proof store is source of truth for instant display.
 * - Relay events published async (fire-and-forget) after every mutation.
 * - Relay restore is explicit (backup recovery or new device).
 */

import {
  createWalletEvent, parseWalletEvent,
  createTokenEvent, parseTokenEvent,
  createHistoryEvent,
  createTokenDeleteEvent,
  getWalletFilters,
  WALLET_KIND, TOKEN_KIND,
} from 'nostr-core'
import { getPool } from './relayPool.js'
import { getPoolRelays } from './relays.js'
import { log } from './logger.js'

/**
 * Publish event to relays and log per-relay results.
 * Returns count of successful publishes.
 */
async function publishToRelays(event, pubkey, tag) {
  const relays = await getPoolRelays(pubkey, 'account')
  const pool = getPool()
  const results = await Promise.allSettled(relays.map(url =>
    pool.publish([url], event)
  ))
  const ok = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    log.warn('cashu-sync', `${tag}_PARTIAL`, {
      ok, failed: failed.length,
      errors: failed.slice(0, 3).map(r => r.reason?.message || 'unknown'),
    })
  }
  if (ok === 0 && relays.length > 0) {
    log.warn('cashu-sync', `${tag}_ALL_FAILED`, { relayCount: relays.length })
  }
  return ok
}

/**
 * Publish wallet metadata (kind 17375) to relays.
 * Called on wallet creation and mint list changes.
 */
export async function publishWalletEvent(secretKey, walletPrivkey, mints, pubkey) {
  try {
    const event = createWalletEvent({ privkey: walletPrivkey, mints }, secretKey)
    const ok = await publishToRelays(event, pubkey, 'WALLET_PUBLISH')
    if (ok > 0) log.info('cashu-sync', 'WALLET_PUBLISHED', { mints: mints.length, relays: ok })
  } catch (err) {
    log.warn('cashu-sync', 'WALLET_PUBLISH_FAILED', { err: err?.message })
  }
}

/**
 * Publish token event (kind 7375) with current proofs for a mint.
 * Called after any proof mutation.
 */
export async function publishTokenEvent(secretKey, mintUrl, proofs, pubkey, delEventIds) {
  try {
    if (!proofs.length) return
    const event = createTokenEvent(
      { mint: mintUrl, proofs, unit: 'sat', del: delEventIds || [] },
      secretKey,
    )
    const ok = await publishToRelays(event, pubkey, 'TOKEN_PUBLISH')
    if (ok > 0) log.info('cashu-sync', 'TOKEN_PUBLISHED', { proofs: proofs.length, relays: ok })
    return event.id
  } catch (err) {
    log.warn('cashu-sync', 'TOKEN_PUBLISH_FAILED', { err: err?.message })
    return null
  }
}

/**
 * Publish a history event (kind 7376) recording a transaction.
 */
export async function publishHistoryEvent(secretKey, direction, amountSats, tokenEventIds, pubkey) {
  try {
    const history = {
      direction,
      amount: String(amountSats),
      unit: 'sat',
      events: (tokenEventIds || []).map(id => ({
        id,
        marker: direction === 'in' ? 'created' : 'destroyed',
      })),
    }
    const event = createHistoryEvent(history, secretKey)
    const ok = await publishToRelays(event, pubkey, 'HISTORY_PUBLISH')
    if (ok > 0) log.info('cashu-sync', 'HISTORY_PUBLISHED', { direction, amount: amountSats, relays: ok })
  } catch (err) {
    log.warn('cashu-sync', 'HISTORY_PUBLISH_FAILED', { err: err?.message })
  }
}

/**
 * Delete spent token events from relays (kind 5).
 */
export async function deleteTokenEvents(secretKey, tokenEventIds, pubkey) {
  try {
    if (!tokenEventIds?.length) return
    const event = createTokenDeleteEvent(tokenEventIds, secretKey)
    await publishToRelays(event, pubkey, 'TOKEN_DELETE')
  } catch (err) {
    log.debug('cashu-sync', 'DELETE_PUBLISH_FAILED', { err: err?.message })
  }
}

/**
 * Restore wallet state from relays.
 * Fetches kind 17375 (wallet) + 7375 (token) events, decrypts, returns data.
 * @returns {{ walletData: CashuWallet | null, proofs: CashuProof[] }}
 */
export async function restoreFromRelays(secretKey, pubkey) {
  const pool = getPool()
  const relays = await getPoolRelays(pubkey, 'account')
  const filters = getWalletFilters(pubkey)

  const events = await new Promise((resolve) => {
    const collected = []
    const timeout = setTimeout(() => resolve(collected), 10000)
    let sub
    try {
      sub = pool.subscribeMany(relays, filters, {
        onevent: (event) => collected.push(event),
        oneose: () => { clearTimeout(timeout); sub?.close(); resolve(collected) },
      })
    } catch {
      clearTimeout(timeout)
      resolve(collected)
    }
  })

  let walletData = null
  const allProofs = []

  for (const event of events) {
    try {
      if (event.kind === WALLET_KIND) {
        walletData = parseWalletEvent(event, secretKey)
      } else if (event.kind === TOKEN_KIND) {
        const token = parseTokenEvent(event, secretKey)
        if (token.proofs?.length) allProofs.push(...token.proofs)
      }
    } catch (err) {
      log.debug('cashu-sync', 'PARSE_FAILED', { kind: event.kind, err: err?.message })
    }
  }

  log.info('cashu-sync', 'RESTORE_COMPLETE', {
    hasWallet: !!walletData,
    proofCount: allProofs.length,
  })

  return { walletData, proofs: allProofs }
}
