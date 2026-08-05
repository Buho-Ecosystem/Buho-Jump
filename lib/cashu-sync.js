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
  verifyEvent,
} from 'nostr-core'
import { getPool } from './relayPool.js'
import { getPoolRelays } from './relays.js'
import { log } from './logger.js'
import { requireSecureUrl } from './origins.js'
import {
  buildMintBackupEvent, parseMintBackupEvent, deriveMintBackupKeys,
  MINT_BACKUP_KIND, MINT_BACKUP_D_TAG,
} from './cashu-mint-backup.js'

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
 * Publish the NUT-27 mint list backup (kind 30078, seed-derived key).
 * Called whenever the mint list changes. The event is addressable, so each
 * publish replaces the previous list.
 */
export async function publishMintBackupEvent(seed, mints, pubkey) {
  try {
    const event = buildMintBackupEvent(seed, mints)
    const ok = await publishToRelays(event, pubkey, 'MINT_BACKUP_PUBLISH')
    if (ok > 0) log.info('cashu-sync', 'MINT_BACKUP_PUBLISHED', { mints: mints.length, relays: ok })
  } catch (err) {
    log.warn('cashu-sync', 'MINT_BACKUP_PUBLISH_FAILED', { err: err?.message })
  }
}

/**
 * Fetch the newest NUT-27 mint backup for this seed from the account relays.
 * @returns {{ mints: string[], timestamp: number } | null}
 */
export async function fetchMintBackup(seed, pubkey) {
  const { pubkey: backupPubkey } = deriveMintBackupKeys(seed)
  const pool = getPool()
  const relays = await getPoolRelays(pubkey, 'account')
  if (!relays.length) return null
  const events = await pool.querySync(
    relays,
    { kinds: [MINT_BACKUP_KIND], authors: [backupPubkey], '#d': [MINT_BACKUP_D_TAG] },
    { maxWait: 8000 },
  )
  const newest = (events || [])
    .filter(event => verifyEvent(event))
    .sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return null
  return parseMintBackupEvent(newest, seed)
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
    return ok > 0 ? event.id : null
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
    if (!tokenEventIds?.length) return true
    const event = createTokenDeleteEvent(tokenEventIds, secretKey)
    return (await publishToRelays(event, pubkey, 'TOKEN_DELETE')) > 0
  } catch (err) {
    log.debug('cashu-sync', 'DELETE_PUBLISH_FAILED', { err: err?.message })
    return false
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
  const filters = [
    ...getWalletFilters(pubkey),
    { kinds: [5], authors: [pubkey], '#k': [String(TOKEN_KIND)] },
  ]

  const events = await new Promise((resolve) => {
    const collected = []
    const timeout = setTimeout(() => resolve(collected), 10000)
    let sub
    try {
      sub = pool.subscribeMany(relays, filters, {
        onevent: (event) => {
          if (collected.length < 5_000) collected.push(event)
        },
        oneose: () => { clearTimeout(timeout); sub?.close(); resolve(collected) },
      })
    } catch {
      clearTimeout(timeout)
      resolve(collected)
    }
  })

  let walletData = null
  let walletTimestamp = -1
  const tokenEvents = []
  const deletedEventIds = new Set()

  for (const event of events) {
    try {
      if (event.pubkey !== pubkey || !verifyEvent(event)) continue
      if (event.kind === WALLET_KIND) {
        if (event.created_at > walletTimestamp) {
          walletData = parseWalletEvent(event, secretKey)
          walletTimestamp = event.created_at
        }
      } else if (event.kind === TOKEN_KIND) {
        const token = parseTokenEvent(event, secretKey)
        tokenEvents.push({ event, token })
        for (const deletedId of token.del || []) deletedEventIds.add(deletedId)
      } else if (event.kind === 5
        && event.tags?.some(tag => tag[0] === 'k' && tag[1] === String(TOKEN_KIND))) {
        for (const tag of event.tags) {
          if (tag[0] === 'e' && /^[0-9a-f]{64}$/i.test(tag[1] || '')) deletedEventIds.add(tag[1])
        }
      }
    } catch (err) {
      log.debug('cashu-sync', 'PARSE_FAILED', { kind: event.kind, err: err?.message })
    }
  }

  const setsByMint = new Map()
  const seenSecrets = new Set()
  for (const { event, token } of tokenEvents.sort((a, b) => a.event.created_at - b.event.created_at)) {
    if (deletedEventIds.has(event.id) || token.unit && token.unit !== 'sat') continue
    let mint
    try {
      mint = requireSecureUrl(token.mint, { allowLoopback: true }).toString().replace(/\/$/, '')
    } catch { continue }
    const set = setsByMint.get(mint) || []
    for (const proof of token.proofs || []) {
      if (seenSecrets.has(proof.secret)) continue
      seenSecrets.add(proof.secret)
      set.push(proof)
    }
    setsByMint.set(mint, set)
  }
  const proofSets = [...setsByMint.entries()].map(([mint, proofs]) => ({ mint, proofs }))
  const proofCount = proofSets.reduce((count, set) => count + set.proofs.length, 0)

  log.info('cashu-sync', 'RESTORE_COMPLETE', {
    hasWallet: !!walletData,
    proofCount,
  })

  return { walletData, proofSets }
}
