/**
 * NIP-06 identity derivation and recovery discovery.
 *
 * A BIP-39 phrase can deterministically produce many Nostr identities. NIP-06
 * assigns them the paths m/44'/1237'/<account>'/0/0, where <account> starts at
 * zero. Derivation is local; only public keys are used for optional relay
 * discovery and secret key bytes are never returned by discovery functions.
 */

import { nip06, nip19 } from 'nostr-core'
import { getPool } from './relayPool.js'
import { DEFAULT_ACCOUNT_RELAYS } from './relays.js'

export const NIP06_MAX_ACCOUNT_INDEX = (2 ** 31) - 1
export const NIP06_RECOVERY_SCAN_COUNT = 20

export function normalizeMnemonic(mnemonic) {
  if (typeof mnemonic !== 'string') return ''
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function assertNip06AccountIndex(accountIndex) {
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > NIP06_MAX_ACCOUNT_INDEX) {
    throw new RangeError('NIP-06 account index must be an integer from 0 to 2147483647')
  }
}

/**
 * Derive one indexed NIP-06 identity. The caller owns the returned secretKey
 * byte array and should clear it after encoding or storing the key.
 */
export function deriveNip06Identity(mnemonic, accountIndex = 0) {
  const words = normalizeMnemonic(mnemonic)
  if (!nip06.validateMnemonic(words)) throw new Error('Invalid recovery words')
  assertNip06AccountIndex(accountIndex)

  const { secretKey, publicKey } = nip06.mnemonicToKey(words, accountIndex)
  return {
    accountIndex,
    path: nip06.getDerivationPath(accountIndex),
    secretKey,
    pubkey: publicKey,
    npub: nip19.npubEncode(publicKey),
  }
}

/**
 * Derive public previews for a consecutive range without retaining private
 * material. These previews are safe to send to the recovery UI.
 */
export function deriveNip06PublicCandidates(mnemonic, count = NIP06_RECOVERY_SCAN_COUNT, startIndex = 0) {
  if (!Number.isInteger(count) || count < 1 || count > NIP06_RECOVERY_SCAN_COUNT) {
    throw new RangeError(`Recovery scan count must be from 1 to ${NIP06_RECOVERY_SCAN_COUNT}`)
  }
  assertNip06AccountIndex(startIndex)
  assertNip06AccountIndex(startIndex + count - 1)

  return Array.from({ length: count }, (_, offset) => {
    const identity = deriveNip06Identity(mnemonic, startIndex + offset)
    identity.secretKey.fill(0)
    return {
      accountIndex: identity.accountIndex,
      path: identity.path,
      pubkey: identity.pubkey,
      npub: identity.npub,
      used: false,
      profile: null,
      lastSeenAt: null,
      evidenceKind: null,
    }
  })
}

function newestEvent(events) {
  return [...events].sort((a, b) => (b?.created_at || 0) - (a?.created_at || 0))[0] || null
}

function safeProfile(event) {
  if (!event || event.kind !== 0 || typeof event.content !== 'string') return null
  try {
    const value = JSON.parse(event.content)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const profile = {}
    for (const field of ['name', 'display_name', 'about', 'picture', 'nip05']) {
      if (typeof value[field] === 'string') profile[field] = value[field]
    }
    return profile
  } catch {
    return null
  }
}

/**
 * Check the first N indexed identities for public activity.
 *
 * Discovery deliberately queries each public key independently with limit 1,
 * so one busy account cannot hide a quieter sibling behind a shared relay
 * result limit. The caller must disclose that public relays can correlate the
 * queried identities before invoking this function.
 */
export async function discoverNip06Identities(mnemonic, options = {}) {
  const {
    count = NIP06_RECOVERY_SCAN_COUNT,
    relays = DEFAULT_ACCOUNT_RELAYS,
    pool = getPool(),
    maxWait = 6500,
  } = options
  const candidates = deriveNip06PublicCandidates(mnemonic, count)

  const activityResults = await Promise.allSettled(
    candidates.map((candidate) => pool.querySync(relays, {
      authors: [candidate.pubkey],
      limit: 1,
    }, { maxWait }))
  )

  let completedQueries = 0
  const profileByPubkey = new Map()
  for (let index = 0; index < activityResults.length; index++) {
    const result = activityResults[index]
    if (result.status !== 'fulfilled') continue
    completedQueries++

    const event = newestEvent(Array.isArray(result.value) ? result.value : [])
    if (!event) continue
    const candidate = candidates[index]
    candidate.used = true
    candidate.lastSeenAt = Number.isFinite(event.created_at) ? event.created_at : null
    candidate.evidenceKind = Number.isInteger(event.kind) ? event.kind : null
    const profile = safeProfile(event)
    if (profile) profileByPubkey.set(candidate.pubkey, profile)
  }

  const usedPubkeys = candidates.filter((candidate) => candidate.used).map((candidate) => candidate.pubkey)
  if (usedPubkeys.length > 0) {
    try {
      const profileEvents = await pool.querySync(relays, {
        kinds: [0],
        authors: usedPubkeys,
        limit: Math.max(usedPubkeys.length * relays.length, usedPubkeys.length),
      }, { maxWait })

      const latestByAuthor = new Map()
      for (const event of Array.isArray(profileEvents) ? profileEvents : []) {
        if (!usedPubkeys.includes(event?.pubkey)) continue
        const previous = latestByAuthor.get(event.pubkey)
        if (!previous || (event.created_at || 0) > (previous.created_at || 0)) {
          latestByAuthor.set(event.pubkey, event)
        }
      }
      for (const [pubkey, event] of latestByAuthor) {
        const profile = safeProfile(event)
        if (profile) profileByPubkey.set(pubkey, profile)
      }
    } catch {
      // Activity evidence is enough to offer a candidate; profiles are optional.
    }
  }

  for (const candidate of candidates) {
    candidate.profile = profileByPubkey.get(candidate.pubkey) || null
  }

  const connectionStatus = typeof pool.listConnectionStatus === 'function'
    ? pool.listConnectionStatus()
    : null
  const hasRelayStatus = connectionStatus instanceof Map && connectionStatus.size > 0
  const relayConnected = hasRelayStatus
    ? [...connectionStatus.values()].some(Boolean)
    : completedQueries > 0

  return {
    candidates,
    usedCount: candidates.filter((candidate) => candidate.used).length,
    networkChecked: candidates.some((candidate) => candidate.used) || relayConnected,
    scannedCount: candidates.length,
  }
}
