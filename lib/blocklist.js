/**
 * Per-site blocklist — prevents provider injection on blocked domains.
 * Blocked sites never see window.nostr or window.webln.
 */

export async function getBlocklist() {
  const data = await chrome.storage.local.get('blocklist')
  return data.blocklist || []
}

export async function isBlocked(host) {
  const list = await getBlocklist()
  return list.includes(host)
}

export async function addToBlocklist(host) {
  if (!host) return
  const list = await getBlocklist()
  if (!list.includes(host)) {
    list.push(host)
    await chrome.storage.local.set({ blocklist: list })
  }
}

export async function removeFromBlocklist(host) {
  const list = await getBlocklist()
  const filtered = list.filter((h) => h !== host)
  await chrome.storage.local.set({ blocklist: filtered })
}
