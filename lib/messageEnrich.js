/**
 * Message enrichment utilities — NIP-30 emoji, NIP-36 content warnings, NIP-10 threads.
 *
 * These extract metadata from event tags for display in chat bubbles.
 */

import { parseCustomEmojis, extractEmojiShortcodes, getContentWarning, parseThread } from 'nostr-core'

/**
 * Extract custom emoji definitions from event tags.
 * Returns a map of shortcode → url for rendering :shortcode: in content.
 * @param {{ tags?: string[][] }} event
 * @returns {Map<string, string>}
 */
export function getCustomEmojis(event) {
  if (!event?.tags) return new Map()
  try {
    const emojis = parseCustomEmojis(event)
    const map = new Map()
    for (const e of emojis) {
      if (e.shortcode && e.url) map.set(e.shortcode, e.url)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Replace :shortcode: in text with emoji image elements (returns HTML string).
 * Only replaces shortcodes that have a matching custom emoji definition.
 * @param {string} text
 * @param {Map<string, string>} emojiMap
 * @returns {string}
 */
export function renderCustomEmojis(text, emojiMap) {
  if (!text || emojiMap.size === 0) return text
  const shortcodes = extractEmojiShortcodes(text)
  if (shortcodes.length === 0) return text

  // HTML-escape the text first to prevent injection from message content
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  let result = escapeHtml(text)
  for (const code of shortcodes) {
    const url = emojiMap.get(code)
    if (url && /^https:\/\//.test(url)) {
      // Only allow https URLs, escape quotes to prevent injection
      const safeUrl = url.replace(/"/g, '&quot;')
      const safeCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(
        new RegExp(`:${safeCode}:`, 'g'),
        `<img src="${safeUrl}" alt=":${code}:" class="inline-block w-5 h-5 align-text-bottom" loading="lazy" />`
      )
    }
  }
  return result
}

/**
 * Extract content warning reason from event tags (NIP-36).
 * Returns the reason string or null if no warning.
 * @param {{ tags?: string[][] }} event
 * @returns {string|null}
 */
export function getWarning(event) {
  if (!event?.tags) return null
  try {
    return getContentWarning(event) ?? null
  } catch {
    return null
  }
}

/**
 * Extract thread references from event (NIP-10).
 * Returns { root, reply, mentions } or null.
 * @param {{ tags?: string[][] }} event
 * @returns {{ root?: { id: string }, reply?: { id: string }, mentions: Array<{ id: string }> } | null}
 */
export function getThreadRef(event) {
  if (!event?.tags) return null
  try {
    const thread = parseThread(event)
    if (!thread) return null
    return {
      root: thread.root || null,
      reply: thread.reply || null,
      mentions: thread.mentions || [],
    }
  } catch {
    return null
  }
}
