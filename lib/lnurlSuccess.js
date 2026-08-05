/**
 * Safe LUD-09 success-action parsing and resolution.
 *
 * Success actions are untrusted data returned by a payment service. This
 * module validates them once at the network boundary so every UI surface can
 * safely render the same storage-friendly shape.
 */

import { decryptAesSuccessAction } from 'nostr-core'

export const SUCCESS_ACTION_MAX_CHARS = 144

function clampText(value) {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim()).slice(0, SUCCESS_ACTION_MAX_CHARS).join('')
}

function sameOrigin(first, second) {
  try {
    const firstUrl = new URL(first)
    const secondUrl = new URL(second)
    return firstUrl.protocol === 'https:'
      && !firstUrl.username
      && !firstUrl.password
      && firstUrl.origin === secondUrl.origin
  } catch {
    return false
  }
}

export function parseSuccessAction(raw, callbackUrl) {
  if (!raw || typeof raw !== 'object') return null

  if (raw.tag === 'message') {
    const message = clampText(raw.message)
    return message ? { tag: 'message', message } : null
  }

  if (raw.tag === 'url') {
    const description = clampText(raw.description)
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    } catch {
      return null
    }
    // LUD-09 requires the action URL to share the callback's host. Degrade a
    // mismatch to harmless text so a useful thank-you message is not lost.
    if (!sameOrigin(url, callbackUrl)) {
      return description ? { tag: 'message', message: description } : null
    }
    return { tag: 'url', description, url }
  }

  if (raw.tag === 'aes') {
    const ciphertext = typeof raw.ciphertext === 'string' ? raw.ciphertext.trim() : ''
    const iv = typeof raw.iv === 'string' ? raw.iv.trim() : ''
    if (!ciphertext || !iv) return null
    return { tag: 'aes', description: clampText(raw.description), ciphertext, iv }
  }

  return null
}

export async function resolveSuccessAction(action, preimage) {
  if (!action) return null
  if (action.tag === 'message') return { tag: 'message', message: action.message }
  if (action.tag === 'url') return { tag: 'url', description: action.description, url: action.url }
  if (action.tag !== 'aes') return null

  try {
    const secret = await decryptAesSuccessAction(action, preimage)
    return { tag: 'aes', description: action.description, secret, decryptError: false }
  } catch {
    return { tag: 'aes', description: action.description, secret: null, decryptError: true }
  }
}
