/**
 * Encrypted, mint-aware Cashu proof storage.
 *
 * Proofs are never pooled across issuers: every proof set is bound to its mint
 * URL. Legacy v1 stores are assigned to the wallet's configured mint on first
 * authenticated use.
 */

import { encryptData, decryptData, encryptionNeedsUpgrade } from './crypto.js'
import { verifiedSet } from './storage.js'
import { vaultIntegrityError } from './vaultIntegrity.js'
import { requireSecureUrl } from './origins.js'

const STORE_VERSION = 2
const MAX_PROOFS = 10_000
const MAX_COUNTER = Number.MAX_SAFE_INTEGER
const mutationTails = new Map()

function storageKey(walletId) {
  return `cashuProofs_${walletId}`
}

function normalizeMint(mintUrl) {
  if (mintUrl == null) return null
  return requireSecureUrl(mintUrl, { allowLoopback: true }).toString().replace(/\/$/, '')
}

function validateProof(proof) {
  const rawAmount = proof?.amount
  const amount = typeof rawAmount === 'number'
    ? rawAmount
    : typeof rawAmount === 'bigint'
      ? Number(rawAmount)
      : typeof rawAmount === 'string'
        ? Number(rawAmount)
        : typeof rawAmount?.toNumber === 'function'
          ? rawAmount.toNumber()
          : Number.NaN
  if (!proof || typeof proof !== 'object'
    || !Number.isSafeInteger(amount) || amount <= 0
    || typeof proof.id !== 'string' || !proof.id || proof.id.length > 256
    || typeof proof.secret !== 'string' || !proof.secret || proof.secret.length > 4096
    || typeof proof.C !== 'string' || !proof.C || proof.C.length > 1024) {
    throw new Error('Invalid Cashu proof data')
  }
  return { ...proof, amount }
}

function validateProofList(proofs) {
  if (!Array.isArray(proofs) || proofs.length > MAX_PROOFS) throw new Error('Invalid Cashu proof list')
  return proofs.map(validateProof)
}

function emptyProofStore() {
  return { version: STORE_VERSION, proofSets: [], counters: {}, relayEventIds: {}, lastSyncedAt: 0 }
}

function normalizeCounters(value) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cashu counter state')
  const counters = {}
  for (const [keysetId, next] of Object.entries(value)) {
    if (!keysetId || keysetId.length > 4096 || !Number.isSafeInteger(next) || next < 0) {
      throw new Error('Invalid Cashu counter state')
    }
    counters[keysetId] = next
  }
  return counters
}

function normalizeRelayEventIds(value) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cashu relay state')
  const ids = {}
  for (const [mint, eventIds] of Object.entries(value)) {
    const normalizedMint = normalizeMint(mint)
    if (!normalizedMint || !Array.isArray(eventIds) || eventIds.length > 100
      || eventIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id))) {
      throw new Error('Invalid Cashu relay state')
    }
    ids[normalizedMint] = [...new Set(eventIds)]
  }
  return ids
}

function serializeMutation(walletId, operation) {
  const previous = mutationTails.get(walletId) || Promise.resolve()
  const result = previous.then(operation, operation)
  mutationTails.set(walletId, result.then(() => undefined, () => undefined))
  return result
}

function normalizeStore(value) {
  if (!value || typeof value !== 'object') throw new Error('Cashu proof vault has an invalid shape')

  if (value.version === STORE_VERSION && Array.isArray(value.proofSets)) {
    const proofSets = value.proofSets.map(set => ({
      mint: normalizeMint(set?.mint),
      proofs: validateProofList(set?.proofs),
    }))
    if (proofSets.filter(set => set.mint == null).length > 1) {
      throw new Error('Cashu proof vault has multiple legacy proof sets')
    }
    return {
      version: STORE_VERSION,
      proofSets,
      counters: normalizeCounters(value.counters),
      relayEventIds: normalizeRelayEventIds(value.relayEventIds),
      lastSyncedAt: Number.isSafeInteger(value.lastSyncedAt) ? value.lastSyncedAt : 0,
    }
  }

  // v1: { proofs, lastSyncedAt }. The old implementation only configured one
  // active mint, so its mint is supplied by the caller during migration.
  if (Array.isArray(value.proofs)) {
    return {
      version: STORE_VERSION,
      proofSets: value.proofs.length > 0 ? [{ mint: null, proofs: validateProofList(value.proofs) }] : [],
      counters: {},
      relayEventIds: {},
      lastSyncedAt: Number.isSafeInteger(value.lastSyncedAt) ? value.lastSyncedAt : 0,
    }
  }

  throw new Error('Cashu proof vault has an invalid shape')
}

function dedupeStore(store) {
  const seen = new Set()
  let count = 0
  store.proofSets = store.proofSets
    .map(set => ({
      mint: set.mint,
      proofs: set.proofs.filter(proof => {
        if (seen.has(proof.secret)) return false
        seen.add(proof.secret)
        count += 1
        if (count > MAX_PROOFS) throw new Error('Cashu proof limit exceeded')
        return true
      }),
    }))
    .filter(set => set.proofs.length > 0)
  return store
}

async function loadStore(walletId, password) {
  if (!password || !walletId) return emptyProofStore()
  const key = storageKey(walletId)
  const data = await chrome.storage.local.get(key)
  const blob = data[key]
  if (!blob?.encrypted) return emptyProofStore()
  try {
    const store = dedupeStore(normalizeStore(await decryptData(blob.encrypted, password)))
    if (encryptionNeedsUpgrade(blob.encrypted)) await writeProofStore(walletId, store, password)
    return store
  } catch (error) {
    throw vaultIntegrityError('Cashu proof vault', error)
  }
}

async function assignLegacyMint(walletId, store, password, mintUrl) {
  const legacy = store.proofSets.find(set => set.mint == null)
  if (!legacy) return false
  const mint = normalizeMint(mintUrl)
  if (!mint) throw new Error('A mint is required to migrate legacy Cashu proofs')
  const existing = store.proofSets.find(set => set.mint === mint)
  if (existing) existing.proofs.push(...legacy.proofs)
  else legacy.mint = mint
  store.proofSets = store.proofSets.filter(set => set !== legacy || set.mint != null)
  dedupeStore(store)
  await writeProofStore(walletId, store, password)
  return true
}

export async function readProofStore(walletId, password, legacyMint) {
  const store = await loadStore(walletId, password)
  if (legacyMint) await assignLegacyMint(walletId, store, password, legacyMint)
  return store
}

export async function writeProofStore(walletId, store, password) {
  if (!password || !walletId) throw new Error('Password and walletId required')
  const normalized = dedupeStore(normalizeStore(store))
  const encrypted = await encryptData(normalized, password)
  await verifiedSet(storageKey(walletId), { encrypted })
}

export async function getProofSets(walletId, password, legacyMint) {
  const store = await readProofStore(walletId, password, legacyMint)
  return store.proofSets.map(set => ({ mint: set.mint, proofs: [...set.proofs] }))
}

export async function getCashuBalance(walletId, password, legacyMint) {
  const sets = await getProofSets(walletId, password, legacyMint)
  return sets.reduce((sum, set) => sum + set.proofs.reduce((subtotal, proof) => subtotal + proof.amount, 0), 0)
}

export async function addProofs(walletId, newProofs, password, mintUrl) {
  const mint = normalizeMint(mintUrl)
  if (!mint) throw new Error('Cashu proof mint is required')
  const normalizedProofs = validateProofList(newProofs)
  return serializeMutation(walletId, async () => {
    const store = await loadStore(walletId, password)
    await assignLegacyMint(walletId, store, password, mint)
    const knownSecrets = new Set(store.proofSets.flatMap(set => set.proofs.map(proof => proof.secret)))
    const uniqueNew = normalizedProofs.filter(proof => !knownSecrets.has(proof.secret))
    if (uniqueNew.length === 0) return 0
    let set = store.proofSets.find(candidate => candidate.mint === mint)
    if (!set) {
      set = { mint, proofs: [] }
      store.proofSets.push(set)
    }
    set.proofs.push(...uniqueNew)
    await writeProofStore(walletId, store, password)
    return uniqueNew.length
  })
}

export async function removeProofs(walletId, secrets, password) {
  return serializeMutation(walletId, async () => {
    const store = await loadStore(walletId, password)
    const secretSet = new Set(Array.isArray(secrets) ? secrets : [])
    for (const set of store.proofSets) {
      set.proofs = set.proofs.filter(proof => !secretSet.has(proof.secret))
    }
    await writeProofStore(walletId, store, password)
  })
}

export async function swapProofs(walletId, removeSecrets, addNew, password, mintUrl) {
  const mint = normalizeMint(mintUrl)
  if (!mint) throw new Error('Cashu proof mint is required')
  const normalizedNew = validateProofList(addNew)
  return serializeMutation(walletId, async () => {
    const store = await loadStore(walletId, password)
    await assignLegacyMint(walletId, store, password, mint)
    const secretSet = new Set(Array.isArray(removeSecrets) ? removeSecrets : [])
    for (const set of store.proofSets) {
      set.proofs = set.proofs.filter(proof => !secretSet.has(proof.secret))
    }
    let target = store.proofSets.find(set => set.mint === mint)
    if (!target) {
      target = { mint, proofs: [] }
      store.proofSets.push(target)
    }
    target.proofs.push(...normalizedNew)
    await writeProofStore(walletId, store, password)
  })
}

export async function getAllProofs(walletId, password, mintUrl) {
  const store = await loadStore(walletId, password)
  if (mintUrl) {
    const mint = normalizeMint(mintUrl)
    await assignLegacyMint(walletId, store, password, mint)
    return store.proofSets.find(set => set.mint === mint)?.proofs || []
  }
  return store.proofSets.flatMap(set => set.proofs)
}

export async function clearProofStore(walletId) {
  await chrome.storage.local.remove(storageKey(walletId))
}

/** Persistent NUT-13 counter allocator used by cashu-ts deterministic outputs. */
export function createCashuCounterSource(walletId, password, namespace = '') {
  const prefix = namespace ? `${namespace}#` : ''
  const storageKeyFor = keysetId => `${prefix}${keysetId}`
  return {
    reserve(keysetId, count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Cashu counter reservation')
      return serializeMutation(walletId, async () => {
        const store = await loadStore(walletId, password)
        const storageKey = storageKeyFor(keysetId)
        const start = store.counters[storageKey] || 0
        if (count === 0) return { start, count: 0 }
        const next = start + count
        if (!Number.isSafeInteger(next) || next > MAX_COUNTER) throw new Error('Cashu counter limit exceeded')
        store.counters[storageKey] = next
        await writeProofStore(walletId, store, password)
        return { start, count }
      })
    },
    advanceToAtLeast(keysetId, minNext) {
      if (!Number.isSafeInteger(minNext) || minNext < 0) throw new Error('Invalid Cashu counter')
      return serializeMutation(walletId, async () => {
        const store = await loadStore(walletId, password)
        const storageKey = storageKeyFor(keysetId)
        if ((store.counters[storageKey] || 0) >= minNext) return
        store.counters[storageKey] = minNext
        await writeProofStore(walletId, store, password)
      })
    },
    async snapshot() {
      const counters = (await loadStore(walletId, password)).counters
      if (!prefix) return { ...counters }
      return Object.fromEntries(Object.entries(counters)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]))
    },
  }
}

export async function mergeCashuCounters(walletId, password, counters) {
  const incoming = normalizeCounters(counters)
  return serializeMutation(walletId, async () => {
    const store = await loadStore(walletId, password)
    for (const [keysetId, next] of Object.entries(incoming)) {
      store.counters[keysetId] = Math.max(store.counters[keysetId] || 0, next)
    }
    await writeProofStore(walletId, store, password)
  })
}

export async function getRelayEventIds(walletId, password, mintUrl) {
  const mint = normalizeMint(mintUrl)
  return [...((await loadStore(walletId, password)).relayEventIds[mint] || [])]
}

/**
 * Return all mint snapshots that still have relay events.
 *
 * A mint may have no local proofs after a payment, but its previous relay
 * snapshot still needs to be deleted so spent proofs cannot reappear during
 * recovery.
 */
export async function getRelayMintStates(walletId, password) {
  const ids = (await loadStore(walletId, password)).relayEventIds
  return Object.entries(ids).map(([mint, eventIds]) => ({ mint, eventIds: [...eventIds] }))
}

export async function setRelayEventIds(walletId, password, mintUrl, eventIds) {
  const mint = normalizeMint(mintUrl)
  if (!Array.isArray(eventIds) || eventIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/i.test(id))) {
    throw new Error('Invalid Cashu relay event ID')
  }
  return serializeMutation(walletId, async () => {
    const store = await loadStore(walletId, password)
    if (eventIds.length > 0) store.relayEventIds[mint] = [...new Set(eventIds)].slice(-100)
    else delete store.relayEventIds[mint]
    store.lastSyncedAt = Date.now()
    await writeProofStore(walletId, store, password)
  })
}

export async function reEncryptProofStore(walletId, oldPassword, newPassword, legacyMint) {
  const store = await readProofStore(walletId, oldPassword, legacyMint)
  if (store.proofSets.length === 0
    && Object.keys(store.counters).length === 0
    && Object.keys(store.relayEventIds).length === 0) {
    await clearProofStore(walletId)
    return
  }
  await writeProofStore(walletId, store, newPassword)
}
