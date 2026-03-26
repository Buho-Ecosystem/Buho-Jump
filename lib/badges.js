/**
 * NIP-58 badge helpers — fetch and display profile badges.
 *
 * Usage:
 *   import { fetchProfileBadges } from './badges.js'
 *   const badges = await fetchProfileBadges(pubkey, relays)
 */

import { parseBadgeDefinition, parseProfileBadges } from 'nostr-core'
import { getPool } from './relayPool.js'

const PROFILE_BADGES_KIND = 30008

/**
 * Fetch badges displayed on a user's profile.
 * @param {string} pubkey
 * @param {string[]} relays
 * @returns {Promise<Array<{ name, description, image, thumbUrl, awardedBy }>>}
 */
export async function fetchProfileBadges(pubkey, relays) {
  if (!pubkey || !relays?.length) return []

  const pool = getPool()

  const profileEvents = await pool.querySync(relays, {
    kinds: [PROFILE_BADGES_KIND],
    authors: [pubkey],
    '#d': ['profile_badges'],
    limit: 1,
  }, { maxWait: 5000 })

  if (!profileEvents.length) return []

  let parsed
  try { parsed = parseProfileBadges(profileEvents[0]) }
  catch { return [] }
  if (!parsed?.badges?.length) return []

  const badges = []
  for (const badge of parsed.badges.slice(0, 8)) {
    if (!badge.definitionAddress) continue
    try {
      const parts = badge.definitionAddress.split(':')
      if (parts.length < 3) continue
      const [kind, author, dTag] = parts
      const defEvents = await pool.querySync(relays, {
        kinds: [parseInt(kind)],
        authors: [author],
        '#d': [dTag],
        limit: 1,
      }, { maxWait: 3000 })

      if (defEvents.length) {
        const def = parseBadgeDefinition(defEvents[0])
        badges.push({
          name: def.name || dTag,
          description: def.description || '',
          image: def.image || '',
          thumbUrl: def.thumbUrl || def.image || '',
          awardedBy: author,
        })
      }
    } catch { /* skip unresolvable badges */ }
  }

  return badges
}
