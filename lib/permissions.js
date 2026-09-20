/**
 * Per-origin permission storage for NIP-07 and WebLN methods.
 * Stores decisions as: { origin: { method: { decision, created_at } } }
 * Supports per-kind signEvent permissions (e.g. signEvent:4)
 */

const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']
let mutationTail = Promise.resolve()
function serializeMutation(operation) {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}


import { isCanonicalWebOrigin } from './origins.js'

function storageKey(profileId) {
  return profileId ? `domain_policies_${profileId}` : 'domain_policies'
}

function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && !RESERVED_KEYS.includes(key)
}

function isValidOrigin(origin) {
  return isValidKey(origin) && isCanonicalWebOrigin(origin)
}

function sanitizePolicies(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean = {}
  for (const [origin, methods] of Object.entries(value)) {
    // Legacy hostname-only grants are intentionally dropped. Their original
    // scheme and port cannot be reconstructed safely.
    if (!isValidOrigin(origin) || !methods || typeof methods !== 'object' || Array.isArray(methods)) continue
    clean[origin] = methods
  }
  return clean
}

export async function getPermissions(profileId) {
  const key = storageKey(profileId)
  const data = await chrome.storage.local.get(key)
  return sanitizePolicies(data[key])
}

export async function checkPermission(origin, method, kind, profileId) {
  if (!isValidOrigin(origin) || !isValidKey(method)) return null
  const policies = await getPermissions(profileId)
  const domain = policies[origin]
  if (!domain) return null

  // For signEvent, check per-kind first, then fallback to general
  if (method === 'signEvent' && kind != null) {
    const perKind = domain[`signEvent:${kind}`]
    if (perKind) return perKind.decision
  }

  const entry = domain[method]
  return entry ? entry.decision : null
}

async function mutateSetPermission(origin, method, decision, kind, profileId) {
  if (!isValidOrigin(origin) || !isValidKey(method)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)

  if (!policies[origin]) policies[origin] = {}

  const methodKey = method === 'signEvent' && kind != null ? `signEvent:${kind}` : method

  policies[origin][methodKey] = {
    decision,
    created_at: Math.floor(Date.now() / 1000),
  }

  await chrome.storage.local.set({ [key]: policies })
}

// Apply one explicit site-wide choice in one storage write. Remove old kind
// exceptions so a previous allow cannot override a new site-wide block.
async function mutateSetSitePermission(origin, methods, decision, profileId) {
  if (!isValidOrigin(origin) || !['allow', 'deny'].includes(decision)) return
  if (!Array.isArray(methods) || !methods.every(isValidKey)) return
  const policies = await getPermissions(profileId)
  const domain = { ...policies[origin] }
  for (const key of Object.keys(domain)) {
    if (methods.includes(key.split(':')[0])) delete domain[key]
  }
  const created_at = Math.floor(Date.now() / 1000)
  for (const method of methods) domain[method] = { decision, created_at }
  policies[origin] = domain
  await chrome.storage.local.set({ [storageKey(profileId)]: policies })
}

async function mutateRemovePermission(origin, method, profileId) {
  if (!isValidOrigin(origin)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)

  if (policies[origin]) {
    delete policies[origin][method]
    if (Object.keys(policies[origin]).length === 0) {
      delete policies[origin]
    }
    await chrome.storage.local.set({ [key]: policies })
  }
}

async function mutateRemoveDomainPermissions(origin, profileId) {
  if (!isValidOrigin(origin)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)
  delete policies[origin]
  await chrome.storage.local.set({ [key]: policies })
}

async function mutateClearAllPermissions(profileId) {
  const key = storageKey(profileId)
  await chrome.storage.local.remove(key)
}

export function setPermission(...args) {
  return serializeMutation(() => mutateSetPermission(...args))
}

export function setSitePermission(...args) {
  return serializeMutation(() => mutateSetSitePermission(...args))
}

export function removePermission(...args) {
  return serializeMutation(() => mutateRemovePermission(...args))
}

export function removeDomainPermissions(...args) {
  return serializeMutation(() => mutateRemoveDomainPermissions(...args))
}

export function clearAllPermissions(...args) {
  return serializeMutation(() => mutateClearAllPermissions(...args))
}
