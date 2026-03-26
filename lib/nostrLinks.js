/**
 * Parse and render nostr: URI references in message content.
 *
 * Uses nostr-core's NIP-27 extractReferences / replaceReferences
 * to find nostr:npub1..., nostr:note1..., nostr:nprofile1... etc.
 * and replace them with structured link data for rendering.
 *
 * Usage:
 *   import { parseNostrLinks } from './nostrLinks.js'
 *   const parts = parseNostrLinks('Hello nostr:npub1abc...xyz!')
 *   // [{ type: 'text', value: 'Hello ' }, { type: 'mention', npub: '...', display: 'npub1abc..xyz' }, ...]
 */

import { extractReferences, replaceReferences, nip19 } from 'nostr-core'

/**
 * Parse message content into an array of text and link segments.
 * @param {string} content
 * @returns {Array<{ type: 'text', value: string } | { type: 'mention', raw: string, display: string, href: string }>}
 */
export function parseNostrLinks(content) {
  if (!content) return [{ type: 'text', value: '' }]

  const refs = extractReferences(content)
  if (refs.length === 0) return [{ type: 'text', value: content }]

  const parts = []
  let lastIndex = 0

  for (const ref of refs) {
    // Add text before this reference
    if (ref.start > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, ref.start) })
    }

    // Decode the reference to get a display-friendly label
    const raw = ref.text // e.g. 'nostr:npub1abc...'
    const encoded = raw.replace(/^nostr:/, '')
    let display = encoded.slice(0, 12) + '…' + encoded.slice(-6)
    let href = `https://njump.me/${encoded}`

    try {
      const decoded = nip19.decode(encoded)
      if (decoded.type === 'npub') {
        display = 'npub1' + encoded.slice(5, 11) + '…' + encoded.slice(-4)
      } else if (decoded.type === 'note') {
        display = 'note1' + encoded.slice(5, 11) + '…' + encoded.slice(-4)
      } else if (decoded.type === 'nprofile') {
        const npub = nip19.npubEncode(decoded.data.pubkey)
        display = 'npub1' + npub.slice(5, 11) + '…' + npub.slice(-4)
      }
    } catch { /* use fallback display */ }

    parts.push({ type: 'mention', raw, display, href })
    lastIndex = ref.end
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return parts
}

/**
 * Check if content contains any nostr: references.
 */
export function hasNostrLinks(content) {
  if (!content) return false
  return extractReferences(content).length > 0
}
