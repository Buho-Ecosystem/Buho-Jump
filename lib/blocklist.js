/**
 * Per-site blocklist — prevents provider injection on blocked domains.
 * Blocked sites never see window.nostr or window.webln.
 */

const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']

function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && !RESERVED_KEYS.includes(key)
}

export async function getBlocklist() {
  const data = await chrome.storage.local.get('blocklist')
  return data.blocklist || []
}

export async function isBlocked(host) {
  if (!isValidKey(host)) return false
  const list = await getBlocklist()
  return list.includes(host)
}

export async function addToBlocklist(host) {
  if (!isValidKey(host)) return
  const list = await getBlocklist()
  if (!list.includes(host)) {
    list.push(host)
    await chrome.storage.local.set({ blocklist: list })
  }
}

export async function removeFromBlocklist(host) {
  if (!isValidKey(host)) return
  const list = await getBlocklist()
  const filtered = list.filter((h) => h !== host)
  await chrome.storage.local.set({ blocklist: filtered })
}
