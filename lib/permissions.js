/**
 * Per-domain permission storage for NIP-07 and WebLN methods.
 * Stores decisions as: { host: { method: { decision, created_at } } }
 * Supports per-kind signEvent permissions (e.g. signEvent:4)
 */

const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']

function storageKey(profileId) {
  return profileId ? `domain_policies_${profileId}` : 'domain_policies'
}

function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && !RESERVED_KEYS.includes(key)
}

export async function getPermissions(profileId) {
  const key = storageKey(profileId)
  const data = await chrome.storage.local.get(key)
  return data[key] || {}
}

export async function checkPermission(host, method, kind, profileId) {
  if (!isValidKey(host) || !isValidKey(method)) return null
  const policies = await getPermissions(profileId)
  const domain = policies[host]
  if (!domain) return null

  // For signEvent, check per-kind first, then fallback to general
  if (method === 'signEvent' && kind != null) {
    const perKind = domain[`signEvent:${kind}`]
    if (perKind) return perKind.decision
  }

  const entry = domain[method]
  return entry ? entry.decision : null
}

export async function setPermission(host, method, decision, kind, profileId) {
  if (!isValidKey(host) || !isValidKey(method)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)

  if (!policies[host]) policies[host] = {}

  const methodKey = method === 'signEvent' && kind != null ? `signEvent:${kind}` : method

  policies[host][methodKey] = {
    decision,
    created_at: Math.floor(Date.now() / 1000),
  }

  await chrome.storage.local.set({ [key]: policies })
}

export async function removePermission(host, method, profileId) {
  if (!isValidKey(host)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)

  if (policies[host]) {
    delete policies[host][method]
    if (Object.keys(policies[host]).length === 0) {
      delete policies[host]
    }
    await chrome.storage.local.set({ [key]: policies })
  }
}

export async function removeDomainPermissions(host, profileId) {
  if (!isValidKey(host)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)
  delete policies[host]
  await chrome.storage.local.set({ [key]: policies })
}

export async function clearAllPermissions(profileId) {
  const key = storageKey(profileId)
  await chrome.storage.local.remove(key)
}
