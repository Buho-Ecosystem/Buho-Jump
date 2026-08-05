/**
 * Per-origin permission storage for NIP-07 and WebLN methods.
 * Stores decisions as: { origin: { method: { decision, created_at } } }
 * Supports per-kind signEvent permissions (e.g. signEvent:4)
 */

const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']

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

export async function setPermission(origin, method, decision, kind, profileId) {
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

export async function removePermission(origin, method, profileId) {
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

export async function removeDomainPermissions(origin, profileId) {
  if (!isValidOrigin(origin)) return
  const key = storageKey(profileId)
  const policies = await getPermissions(profileId)
  delete policies[origin]
  await chrome.storage.local.set({ [key]: policies })
}

export async function clearAllPermissions(profileId) {
  const key = storageKey(profileId)
  await chrome.storage.local.remove(key)
}
