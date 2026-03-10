/**
 * Nostr profile (kind 0) publishing and fetching.
 * Uses shared RelayPool for efficient connection reuse.
 */

import { finalizeEvent, hexToBytes } from 'nostr-core'
import { getPool } from './relayPool.js'
import { DEFAULT_ACCOUNT_RELAYS } from './relays.js'

const KIND_METADATA = 0

/**
 * Publish a kind 0 profile event.
 * @param {Object} profile - { name, about, picture, nip05 }
 * @param {string} secretHex - hex-encoded secret key
 * @param {string[]} [relays] - relay URLs to publish to
 * @returns {Promise<{ published: string[], failed: string[] }>}
 */
export async function publishProfile(profile, secretHex, relays = DEFAULT_ACCOUNT_RELAYS) {
  const content = JSON.stringify({
    ...(profile.name && { name: profile.name }),
    ...(profile.about && { about: profile.about }),
    ...(profile.picture && { picture: profile.picture }),
    ...(profile.nip05 && { nip05: profile.nip05 }),
  })

  const secretKey = hexToBytes(secretHex)
  const event = finalizeEvent(
    {
      kind: KIND_METADATA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    },
    secretKey
  )

  const pool = getPool()
  const published = []
  const failed = []

  const results = await Promise.allSettled(
    relays.map(async (url) => {
      await pool.publish([url], event)
      return url
    })
  )

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') published.push(results[i].value)
    else failed.push(relays[i])
  }

  return { published, failed }
}

/**
 * Fetch kind 0 profile for a pubkey.
 * @param {string} pubkey - hex pubkey
 * @param {string[]} [relays] - relay URLs to query
 * @returns {Promise<Object|null>} parsed profile content or null
 */
export async function fetchProfile(pubkey, relays = DEFAULT_ACCOUNT_RELAYS) {
  const pool = getPool()

  try {
    const events = await pool.querySync(relays, {
      kinds: [KIND_METADATA],
      authors: [pubkey],
      limit: 1,
    }, { maxWait: 8000 })

    if (events.length === 0) return null

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
    try {
      return JSON.parse(latest.content)
    } catch {
      return null
    }
  } catch {
    return null
  }
}
