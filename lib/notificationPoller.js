/**
 * Background notification poller — checks for new DMs and group messages
 * when the popup is closed.
 *
 * MV3 service workers can't hold persistent WebSocket connections, so we
 * use chrome.alarms to periodically wake the service worker and do a
 * one-shot relay query for recent messages. If new messages are found
 * that aren't in storage, we fire browser notifications.
 *
 * Poll interval: 2 minutes (configurable).
 * Each poll opens a short-lived relay connection, queries, and disconnects.
 */

import {
  nip04, nip44, nip17, hexToBytes,
} from 'nostr-core'
import { getActiveAccount } from './accounts.js'
import { getPool } from './relayPool.js'
import { getPoolRelays, getInboxRelays, DEFAULT_CHAT_RELAYS } from './relays.js'
import { notifyDm, notifyGroup } from './notifications.js'

const ALARM_NAME = 'buho-notif-poll'
const POLL_INTERVAL_MINUTES = 2
const POLL_STORAGE_KEY = 'notifPollLastCheck'

let _getPassword = null

/**
 * Start the background notification poller.
 * @param {Function} getPassword - Returns the current session password (or null if locked).
 */
export function startNotificationPoller(getPassword) {
  _getPassword = getPassword

  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: POLL_INTERVAL_MINUTES,
    periodInMinutes: POLL_INTERVAL_MINUTES,
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      pollForNewMessages().catch(() => { /* poll failed silently */ })
    }
  })
}

/**
 * One-shot poll: query relays for recent messages, compare with known IDs,
 * and fire notifications for anything new.
 */
async function pollForNewMessages() {
  const password = _getPassword?.()
  if (!password) return // locked — skip poll

  const account = await getActiveAccount(password)
  if (!account?.pubkey) return

  const myPubkey = account.pubkey
  const secretKey = account.secretHex ? hexToBytes(account.secretHex) : null

  // Only poll DMs for local accounts (need secret key to decrypt)
  if (!secretKey) return

  // Get last poll timestamp
  let lastCheck
  try {
    const data = await chrome.storage.local.get(POLL_STORAGE_KEY)
    lastCheck = data[POLL_STORAGE_KEY] || Math.floor(Date.now() / 1000) - 300 // default: 5 min ago
  } catch {
    lastCheck = Math.floor(Date.now() / 1000) - 300
  }

  const since = lastCheck
  const now = Math.floor(Date.now() / 1000)

  // Get known message IDs from storage to avoid re-notifying
  const knownIds = new Set()
  try {
    const chatKey = `chatMessages_${myPubkey}`
    const groupKey = `groupMessages_${myPubkey}`
    const storageData = await chrome.storage.local.get([chatKey, groupKey])
    for (const value of Object.values(storageData)) {
      if (typeof value !== 'object' || !value) continue
      for (const msgs of Object.values(value)) {
        if (Array.isArray(msgs)) msgs.forEach(m => knownIds.add(m.id))
      }
    }
  } catch { /* storage read failed */ }

  // Get relays
  const pool = getPool()
  const ownChatRelays = await getPoolRelays(myPubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
  let inboxRelays = []
  try { inboxRelays = await getInboxRelays(myPubkey) } catch { /* ignore */ }
  const relays = [...new Set([...ownChatRelays, ...inboxRelays])]

  // ── Poll NIP-17 gift wraps ──
  try {
    const events = await pool.querySync(relays, {
      kinds: [1059],
      '#p': [myPubkey],
      since,
    }, { maxWait: 8000 })

    for (const event of events) {
      try {
        const dm = nip17.unwrapDirectMessage(event, secretKey)
        if (dm.sender === myPubkey) continue // self-copy
        if (knownIds.has(dm.id)) continue // already known

        // Check if this is a group message (multiple p-tags)
        const pTags = dm.tags?.filter(t => t[0] === 'p') || []
        if (pTags.length > 1) {
          // Group message
          const subjectTag = dm.tags?.find(t => t[0] === 'subject')
          const groupName = subjectTag?.[1] || 'Group'
          const senderShort = dm.sender?.slice(0, 12) + '...'
          await notifyGroup(groupName, senderShort, dm.content, dm.id)
        } else {
          // Direct message
          const senderShort = dm.sender?.slice(0, 12) + '...'
          await notifyDm(senderShort, dm.content, dm.id)
        }
      } catch { /* decrypt failed */ }
    }
  } catch { /* relay query failed */ }

  // ── Poll NIP-04 DMs ──
  try {
    const events = await pool.querySync(relays, {
      kinds: [4],
      '#p': [myPubkey],
      since,
    }, { maxWait: 8000 })

    for (const event of events) {
      if (knownIds.has(event.id)) continue
      if (event.pubkey === myPubkey) continue // sent by us

      try {
        let content
        try {
          const convKey = nip44.getConversationKey(secretKey, event.pubkey)
          content = nip44.decrypt(event.content, convKey)
        } catch {
          content = nip04.decrypt(secretKey, event.pubkey, event.content)
        }
        const senderShort = event.pubkey.slice(0, 12) + '...'
        await notifyDm(senderShort, content, event.id)
      } catch { /* decrypt failed */ }
    }
  } catch { /* relay query failed */ }

  // Update last check timestamp
  try {
    await chrome.storage.local.set({ [POLL_STORAGE_KEY]: now })
  } catch { /* storage write failed */ }
}
