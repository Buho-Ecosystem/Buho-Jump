/** Request the narrow host permission needed for a user-selected service. */

import { originPermissionPattern } from '../origins.js'

export async function hasOriginAccess(url) {
  try {
    if (!chrome.permissions?.contains) return true
    const origin = new URL(url).origin
    return await chrome.permissions.contains({ origins: [originPermissionPattern(origin)] })
  } catch {
    return false
  }
}

export async function requestOriginAccess(url) {
  try {
    if (!chrome.permissions?.request) return hasOriginAccess(url)
    const origin = new URL(url).origin
    // Call request directly from the click handler. Chromium requires a user
    // gesture and an awaited contains() call can consume that gesture.
    return await chrome.permissions.request({ origins: [originPermissionPattern(origin)] })
  } catch {
    return false
  }
}

export async function hasOriginsAccess(urls) {
  try {
    if (!chrome.permissions?.contains) return true
    const origins = [...new Set((urls || []).map(url => originPermissionPattern(new URL(url).origin)))]
    if (origins.length === 0) return true
    return await chrome.permissions.contains({ origins })
  } catch {
    return false
  }
}

export async function requestOriginsAccess(urls) {
  try {
    if (!chrome.permissions?.request) return hasOriginsAccess(urls)
    const origins = [...new Set((urls || []).map(url => originPermissionPattern(new URL(url).origin)))]
    if (origins.length === 0) return true
    // Keep this as the first asynchronous browser call so the permission
    // prompt remains tied to the user's confirmation click.
    return await chrome.permissions.request({ origins })
  } catch {
    return false
  }
}
