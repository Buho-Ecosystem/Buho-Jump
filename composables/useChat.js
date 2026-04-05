/**
 * Chat composable — NIP-17 (send + receive) with NIP-04 read-back.
 *
 * Sending:
 *   Local accounts → NIP-17 (kind 1059 gift wraps) with self-copy.
 *   NIP-46 accounts → kind 4 via remote signer (NIP-44 encrypt preferred, NIP-04 fallback).
 *
 * Receiving: NIP-17 (kind 1059) + NIP-04/NIP-44 (kind 4) — reads all formats.
 *
 * All data is scoped per-account — switching accounts triggers a
 * full reset: close subscriptions, load the new account's messages,
 * and re-subscribe to relays.
 */

import { ref, computed } from 'vue'
import {
  nip04, nip44, nip59, nip17, hexToBytes, addExpiration, isExpired,
} from 'nostr-core'
import { useMessaging } from './useMessaging.js'
import { getPool } from '../lib/relayPool.js'

/**
 * Get the active account from the background service worker.
 * Accounts are encrypted at rest — only the background has the password.
 */
async function getActiveAccount() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ACCOUNT' })
  return response?.result || null
}
import { getPoolRelays, getOutboxRelays, getInboxRelays, DEFAULT_CHAT_RELAYS } from '../lib/relays.js'
import { cleanMessageContent } from '../lib/utils.js'

// ── Singleton reactive state ──
const messages = ref({})     // { [pubkey]: Message[] }
const lastRead = ref({})     // { [pubkey]: timestamp }
const initialized = ref(false)
const error = ref(null)      // i18n key or null — set on init/subscribe failure
const currentAccountPubkey = ref(null) // tracks which account owns the data

let subscription = null
let subscriptionSignature = null // Cache to prevent duplicate subscriptions

// Performance: O(1) dedup, dirty tracking, timestamp cache
const messageIdSets = {}   // { [pubkey]: Set<id> } — for O(1) dedup
const dirtyKeys = new Set() // pubkeys with unsaved changes
let latestTimestamp = 0     // cached latest message timestamp across all conversations

// EOSE sync token — scoped per subscription to prevent race conditions.
// When subscribe() is called, a new token replaces the old one. Old subscription
// callbacks still reference their captured (abandoned) token, harmlessly.
let currentSyncToken = { complete: false }

// Reactions: { [messageId]: [{ emoji, sender, created_at }] }
const reactions = ref({})
const reactionIdSet = new Set() // O(1) dedup for reaction event IDs

// Deletions: { [messageId]: true } for reactive tracking
const deletedIds = ref({})

// Pending queues: reactions/deletions for messages not yet received
const pendingReactions = [] // { targetId, emoji, sender, created_at }
const pendingDeletions = [] // { targetId, sender }

// Message shape:
// { id, sender: 'me'|pubkey, content, created_at, protocol: 'nip17'|'nip04', type?: 'zap', status?: 'sending'|'sent'|'failed' }

export function useChat() {

  // ── Computed: sorted conversations ──
  const conversations = computed(() => {
    const list = []
    for (const [pubkey, msgs] of Object.entries(messages.value)) {
      if (!msgs || msgs.length === 0) continue
      const sorted = [...msgs].sort((a, b) => b.created_at - a.created_at)
      const lastMsg = sorted[0]
      const lastReadTs = lastRead.value[pubkey] || 0
      const unread = sorted.filter(m => m.sender !== 'me' && m.created_at > lastReadTs).length
      list.push({ pubkey, lastMessage: lastMsg, unread })
    }
    return list.sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at || a.pubkey.localeCompare(b.pubkey))
  })

  const unreadTotal = computed(() =>
    conversations.value.reduce((sum, c) => sum + c.unread, 0)
  )

  // ── Storage key helpers (account-scoped) ──

  function storageKeys(accountPubkey) {
    return {
      messages: `chatMessages_${accountPubkey}`,
      lastRead: `chatLastRead_${accountPubkey}`,
    }
  }

  // ── Persistence ──

  async function loadMessages() {
    if (!currentAccountPubkey.value) {
      messages.value = {}
      lastRead.value = {}
      return
    }
    try {
      const keys = storageKeys(currentAccountPubkey.value)
      const data = await chrome.storage.local.get([keys.messages, keys.lastRead])
      messages.value = data[keys.messages] || {}
      lastRead.value = data[keys.lastRead] || {}

      // Rebuild ID sets and timestamp cache from loaded data
      latestTimestamp = 0
      for (const [pk, msgs] of Object.entries(messages.value)) {
        const idSet = new Set()
        for (const m of msgs) {
          idSet.add(m.id)
          if (m.created_at > latestTimestamp) latestTimestamp = m.created_at
        }
        messageIdSets[pk] = idSet
      }
    } catch (err) { console.warn('[chat] Could not load saved messages:', err) }
  }

  let persistTimer = null
  function persistMessages() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!currentAccountPubkey.value || dirtyKeys.size === 0) return
      try {
        const keys = storageKeys(currentAccountPubkey.value)
        const toSet = {}

        // Only serialize dirty conversations, merge with stored data
        if (dirtyKeys.has('__lastRead__')) {
          toSet[keys.lastRead] = JSON.parse(JSON.stringify(lastRead.value))
        }

        // Check if any message keys are dirty (not just __lastRead__)
        const dirtyPubkeys = [...dirtyKeys].filter(k => k !== '__lastRead__')
        if (dirtyPubkeys.length > 0) {
          const stored = await chrome.storage.local.get(keys.messages)
          const existing = stored[keys.messages] || {}
          for (const pk of dirtyPubkeys) {
            existing[pk] = JSON.parse(JSON.stringify(messages.value[pk]))
          }
          toSet[keys.messages] = existing
        }

        await chrome.storage.local.set(toSet)
        dirtyKeys.clear()
      } catch (err) { console.warn('[chat] Could not save messages:', err) }
    }, 500)
  }

  function addMessage(pubkey, msg) {
    if (!messages.value[pubkey]) {
      messages.value[pubkey] = []
    }
    // O(1) dedup via ID set
    if (!messageIdSets[pubkey]) messageIdSets[pubkey] = new Set(messages.value[pubkey].map(m => m.id))
    if (messageIdSets[pubkey].has(msg.id)) return
    messageIdSets[pubkey].add(msg.id)

    messages.value[pubkey] = [...messages.value[pubkey], msg]
    dirtyKeys.add(pubkey)
    if (msg.created_at > latestTimestamp) latestTimestamp = msg.created_at
    persistMessages()

    // Trigger browser notification only for real-time messages (after initial sync)
    if (currentSyncToken.complete && msg.sender !== 'me' && msg.type !== 'zap') {
      const preview = msg.content?.slice(0, 120) || ''
      chrome.runtime.sendMessage({
        type: 'NOTIFY_DM',
        params: [{ senderName: 'Someone', preview, messageId: msg.id }],
      }).catch(() => { /* background not ready */ })
    }

    // Apply any pending reactions/deletions for this message
    applyPendingForMessage(msg.id)
  }

  /**
   * Add a reaction to a message. If the target message hasn't arrived yet, queue it.
   */
  function addReaction(targetId, reaction) {
    if (reactionIdSet.has(reaction.id)) return
    reactionIdSet.add(reaction.id)

    // Check if target message exists in any conversation
    const found = findMessageConversation(targetId)
    if (found) {
      const existing = reactions.value[targetId] || []
      reactions.value = { ...reactions.value, [targetId]: [...existing, reaction] }
    } else {
      pendingReactions.push({ targetId, ...reaction })
    }
  }

  /**
   * Mark a message as deleted. If the target message hasn't arrived yet, queue it.
   */
  /**
   * Mark a message as deleted. Only the message author can delete their own message.
   * If the target message hasn't arrived yet, queue it for validation on arrival.
   */
  function addDeletion(targetId, sender) {
    if (deletedIds.value[targetId]) return

    const conversationPubkey = findMessageConversation(targetId)
    if (conversationPubkey) {
      // Validate: only the original author can delete
      const msgs = messages.value[conversationPubkey] || []
      const targetMsg = msgs.find(m => m.id === targetId)
      if (!targetMsg) return
      const authorPubkey = targetMsg.sender === 'me' ? currentAccountPubkey.value : targetMsg.sender
      if (sender !== authorPubkey) return // Reject spoofed deletion

      deletedIds.value = { ...deletedIds.value, [targetId]: true }
    } else {
      // Message not received yet — queue for validation on arrival
      pendingDeletions.push({ targetId, sender })
    }
  }

  /**
   * Apply queued reactions/deletions when their target message arrives.
   */
  function applyPendingForMessage(messageId) {
    // Apply pending reactions
    for (let i = pendingReactions.length - 1; i >= 0; i--) {
      if (pendingReactions[i].targetId === messageId) {
        const r = pendingReactions.splice(i, 1)[0]
        const existing = reactions.value[messageId] || []
        reactions.value = { ...reactions.value, [messageId]: [...existing, r] }
      }
    }
    // Apply pending deletions (with author validation)
    for (let i = pendingDeletions.length - 1; i >= 0; i--) {
      if (pendingDeletions[i].targetId === messageId) {
        const pending = pendingDeletions.splice(i, 1)[0]
        // Validate: deletion sender must match message author
        const authorPubkey = msg.sender === 'me' ? currentAccountPubkey.value : msg.sender
        if (pending.sender === authorPubkey) {
          deletedIds.value = { ...deletedIds.value, [messageId]: true }
        }
      }
    }
  }

  /**
   * Find which conversation contains a message ID (for reaction targeting).
   */
  function findMessageConversation(messageId) {
    for (const [pubkey, msgs] of Object.entries(messages.value)) {
      if (msgs.some(m => m.id === messageId)) return pubkey
    }
    return null
  }

  /**
   * Get reactions for a specific message.
   */
  function getReactions(messageId) {
    return computed(() => reactions.value[messageId] || [])
  }

  /**
   * Check if a message is deleted.
   */
  function isDeleted(messageId) {
    return !!deletedIds.value[messageId]
  }

  // ── Send ──

  async function sendMessage(recipientPubkey, content, { expiresAt, contentWarning, replyTo } = {}) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const now = Math.floor(Date.now() / 1000)
    const pool = getPool()
    const senderPubkey = account.pubkey

    // Generate a temporary ID for optimistic message
    const tempId = `pending-${now}-${Math.random().toString(36).slice(2, 8)}`

    // Add optimistic "sending" message immediately
    const optimistic = {
      id: tempId,
      sender: 'me',
      content,
      created_at: now,
      protocol: account.secretHex ? 'nip17' : 'nip04',
      status: 'sending',
    }
    if (replyTo) optimistic.replyTo = replyTo
    if (expiresAt) optimistic.expiresAt = expiresAt
    addMessage(recipientPubkey, optimistic)

    try {
      // Outbox model: own chat relays + recipient's NIP-65 write relays
      const ownChatRelays = await getPoolRelays(senderPubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
      let recipientWriteRelays = []
      try { recipientWriteRelays = await getOutboxRelays(recipientPubkey) } catch { /* ignore */ }
      const publishRelays = [...new Set([...ownChatRelays, ...recipientWriteRelays])]

      let finalId = tempId

      if (account.secretHex) {
        // ── Local account → NIP-17 gift wraps ──
        const secretKey = hexToBytes(account.secretHex)

        const tags = [['p', recipientPubkey]]
        if (expiresAt) addExpiration(tags, expiresAt)
        if (contentWarning) tags.push(['content-warning', contentWarning])
        if (replyTo?.id) tags.push(['e', replyTo.id, '', 'reply'])
        const rumor = nip59.createRumor({
          kind: 14,
          content,
          tags,
          created_at: now,
        }, senderPubkey)

        const sealForRecipient = nip59.createSeal(rumor, secretKey, recipientPubkey)
        const wrapForRecipient = nip59.createWrap(sealForRecipient, recipientPubkey)

        const sealForSelf = nip59.createSeal(rumor, secretKey, senderPubkey)
        const wrapForSelf = nip59.createWrap(sealForSelf, senderPubkey)

        // Pre-register rumor ID in dedup set BEFORE publishing.
        // The relay may echo the self-copy back before publish() resolves,
        // which would bypass dedup if we wait until updateMessageStatus.
        finalId = rumor.id
        if (!messageIdSets[recipientPubkey]) messageIdSets[recipientPubkey] = new Set()
        messageIdSets[recipientPubkey].add(finalId)

        await Promise.all([
          pool.publish(publishRelays, wrapForRecipient),
          pool.publish(publishRelays, wrapForSelf),
        ])
      } else {
        // ── NIP-46 account → kind 4 via remote signer (NIP-44 encrypt, NIP-04 fallback) ──
        const { send } = useMessaging()
        let ciphertext
        try {
          ciphertext = await send('CHAT_ENCRYPT', recipientPubkey, content, 'nip44')
        } catch {
          ciphertext = await send('CHAT_ENCRYPT', recipientPubkey, content)
        }
        const signed = await send('CHAT_SIGN', {
          kind: 4,
          content: ciphertext,
          tags: [['p', recipientPubkey]],
          created_at: now,
        })

        // Pre-register in dedup set before publishing (same race guard as NIP-17)
        finalId = signed.id
        if (!messageIdSets[recipientPubkey]) messageIdSets[recipientPubkey] = new Set()
        messageIdSets[recipientPubkey].add(finalId)

        await pool.publish(publishRelays, signed)
      }

      // Update optimistic message: replace temp ID with real ID, mark as sent
      updateMessageStatus(recipientPubkey, tempId, 'sent', finalId, publishRelays)
    } catch (err) {
      // Mark message as failed
      updateMessageStatus(recipientPubkey, tempId, 'failed')
      throw err
    }
  }

  function updateMessageStatus(pubkey, msgId, status, newId, relays) {
    const msgs = messages.value[pubkey]
    if (!msgs) return
    const idx = msgs.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const updated = { ...msgs[idx], status }
    if (relays) updated.publishedRelays = relays
    if (newId) {
      updated.id = newId
      // Update ID set: remove old, add new
      if (messageIdSets[pubkey]) {
        messageIdSets[pubkey].delete(msgId)
        messageIdSets[pubkey].add(newId)
      }
    }
    messages.value[pubkey] = [
      ...msgs.slice(0, idx),
      updated,
      ...msgs.slice(idx + 1),
    ]
    dirtyKeys.add(pubkey)
    persistMessages()
  }

  async function retryMessage(recipientPubkey, msgId) {
    const msgs = messages.value[recipientPubkey]
    if (!msgs) return
    const msg = msgs.find(m => m.id === msgId && m.status === 'failed')
    if (!msg) return

    // Remove the failed message
    messages.value[recipientPubkey] = msgs.filter(m => m.id !== msgId)
    if (messageIdSets[recipientPubkey]) messageIdSets[recipientPubkey].delete(msgId)
    dirtyKeys.add(recipientPubkey)
    persistMessages()

    // Re-send
    await sendMessage(recipientPubkey, msg.content)
  }

  /**
   * Record a zap sent to a contact (special message type).
   */
  /**
   * Record a zap sent to a contact (special message type).
   * Returns the message ID so the caller can update status on success/failure.
   */
  function addZapMessage(recipientPubkey, amountSats) {
    const id = `zap-${Date.now()}-${Math.random().toString(36).slice(2)}`
    addMessage(recipientPubkey, {
      id,
      sender: 'me',
      content: `${amountSats.toLocaleString()} sats`,
      created_at: Math.floor(Date.now() / 1000),
      protocol: 'zap',
      type: 'zap',
      status: 'sending',
    })
    return id
  }

  /**
   * Mark a zap message as sent or failed.
   */
  function updateZapStatus(recipientPubkey, zapId, status) {
    updateMessageStatus(recipientPubkey, zapId, status)
  }

  // ── Subscriptions ──

  async function subscribe(opts = {}) {
    const account = await getActiveAccount()
    if (!account?.pubkey) return

    const pool = getPool()
    const myPubkey = account.pubkey
    const secretKey = account.secretHex ? hexToBytes(account.secretHex) : null
    const isLocal = !!secretKey
    const { send } = !isLocal ? useMessaging() : {}

    // Determine "since" — use cached latest timestamp or 30 days ago
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 30
    const latest = Math.max(latestTimestamp, thirtyDaysAgo)
    // Go back 1 hour from latest to catch any we missed
    const since = Math.max(latest - 3600, thirtyDaysAgo)

    // Inbox model: chat relays + NIP-65 read relays + account relays (broad net)
    // Senders publish to our NIP-65 inbox relays, but if that list is missing
    // or incomplete, we also check account relays and defaults as fallback.
    const ownChatRelays = await getPoolRelays(myPubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const ownAccountRelays = await getPoolRelays(myPubkey, 'account').catch(() => [])
    let inboxRelays = []
    try { inboxRelays = await getInboxRelays(myPubkey) } catch { /* ignore */ }
    const subscribeRelays = [...new Set([...ownChatRelays, ...inboxRelays, ...ownAccountRelays])]

    // Subscription signature: skip re-subscribe if filters unchanged (prevents duplicate subs)
    const sig = `${myPubkey}:${isLocal}:${subscribeRelays.sort().join(',')}:${since}`
    if (!opts.force && subscription && subscriptionSignature === sig) return
    subscriptionSignature = sig

    // Cleanup previous
    if (subscription) {
      subscription.close()
      subscription = null
    }

    const subs = []

    // Create a new sync token scoped to THIS subscription cycle.
    // Old tokens from previous subscribe() calls are abandoned — their
    // EOSE callbacks write to a stale object that addMessage no longer checks.
    const syncToken = { complete: false }
    currentSyncToken = syncToken
    let eoseCount = 0
    const expectedEose = isLocal ? 3 : 2
    function onEose() {
      eoseCount++
      if (eoseCount >= expectedEose) syncToken.complete = true
    }

    // ── NIP-17: Gift wraps addressed to us (kind 1059) ──
    // Only for local accounts — unwrap requires the secret key
    if (isLocal) {
      subs.push(pool.subscribe(subscribeRelays, {
        kinds: [1059],
        '#p': [myPubkey],
        since,
      }, {
        oneose: onEose,
        onevent(event) {
          try {
            // Unwrap the gift wrap to get the raw rumor (kind-agnostic)
            const rumor = nip59.unwrap(event, secretKey)
            const senderPubkey = rumor.pubkey

            // ── Kind 7: Reaction ──
            if (rumor.kind === 7) {
              const eTag = rumor.tags?.find(t => t[0] === 'e')
              if (!eTag) return
              addReaction(eTag[1], {
                id: rumor.id,
                emoji: rumor.content || '+',
                sender: senderPubkey === myPubkey ? 'me' : senderPubkey,
                created_at: rumor.created_at,
              })
              return
            }

            // ── Kind 5: Deletion ──
            if (rumor.kind === 5) {
              const eTag = rumor.tags?.find(t => t[0] === 'e')
              if (!eTag) return
              addDeletion(eTag[1], senderPubkey)
              return
            }

            // ── Kind 14: Direct message ──
            if (rumor.kind !== 14) return // Ignore unknown kinds

            const expiry = rumor.tags ? (() => { const t = rumor.tags.find(t => t[0] === 'expiration'); return t ? parseInt(t[1]) : undefined })() : undefined

            if (senderPubkey === myPubkey) {
              // Self-copy: message we sent (from this or another client)
              const pTag = rumor.tags?.find(t => t[0] === 'p')
              if (!pTag) return
              addMessage(pTag[1], {
                id: rumor.id,
                sender: 'me',
                content: cleanMessageContent(rumor.content),
                created_at: rumor.created_at,
                protocol: 'nip17',
                expiresAt: expiry,
              })
            } else {
              // Incoming message from someone else
              addMessage(senderPubkey, {
                id: rumor.id,
                sender: senderPubkey,
                content: cleanMessageContent(rumor.content),
                created_at: rumor.created_at,
                protocol: 'nip17',
                expiresAt: expiry,
              })
            }
          } catch { /* expected — message not addressed to this account */ }
        },
      }))
    }

    // ── NIP-04/44: Legacy DMs sent TO us (kind 4) ──
    subs.push(pool.subscribe(subscribeRelays, {
      kinds: [4],
      '#p': [myPubkey],
      since,
    }, {
      oneose: onEose,
      async onevent(event) {
        try {
          let content
          if (isLocal) {
            try {
              const convKey = nip44.getConversationKey(secretKey, event.pubkey)
              content = nip44.decrypt(event.content, convKey)
            } catch {
              content = nip04.decrypt(secretKey, event.pubkey, event.content)
            }
          } else {
            // NIP-46: decrypt via remote signer (try NIP-44 first, fall back to NIP-04)
            try {
              content = await send('CHAT_DECRYPT', event.pubkey, event.content, 'nip44')
            } catch {
              content = await send('CHAT_DECRYPT', event.pubkey, event.content)
            }
          }
          addMessage(event.pubkey, {
            id: event.id,
            sender: event.pubkey,
            content: cleanMessageContent(content),
            created_at: event.created_at,
            protocol: 'nip04',
          })
        } catch { /* expected — message not addressed to this account */ }
      },
    }))

    // ── NIP-04/44: Legacy DMs sent BY us (kind 4, author = us) ──
    subs.push(pool.subscribe(subscribeRelays, {
      kinds: [4],
      authors: [myPubkey],
      since,
    }, {
      oneose: onEose,
      async onevent(event) {
        const pTag = event.tags.find(t => t[0] === 'p')
        if (!pTag) return
        const recipientPubkey = pTag[1]
        try {
          let content
          if (isLocal) {
            try {
              const convKey = nip44.getConversationKey(secretKey, recipientPubkey)
              content = nip44.decrypt(event.content, convKey)
            } catch {
              content = nip04.decrypt(secretKey, recipientPubkey, event.content)
            }
          } else {
            // NIP-46: decrypt via remote signer (try NIP-44 first, fall back to NIP-04)
            try {
              content = await send('CHAT_DECRYPT', recipientPubkey, event.content, 'nip44')
            } catch {
              content = await send('CHAT_DECRYPT', recipientPubkey, event.content)
            }
          }
          addMessage(recipientPubkey, {
            id: event.id,
            sender: 'me',
            content: cleanMessageContent(content),
            created_at: event.created_at,
            protocol: 'nip04',
          })
        } catch { /* expected — message not addressed to this account */ }
      },
    }))

    subscription = {
      close() { subs.forEach(s => s.close()) },
    }
  }

  // ── Helpers ──

  function markRead(pubkey) {
    lastRead.value = { ...lastRead.value, [pubkey]: Math.floor(Date.now() / 1000) }
    dirtyKeys.add('__lastRead__')
    persistMessages()
  }

  function getMessages(pubkey) {
    return computed(() => {
      const msgs = messages.value[pubkey] || []
      const now = Math.floor(Date.now() / 1000)
      return [...msgs]
        .filter(m => !m.expiresAt || m.expiresAt > now)
        .sort((a, b) => a.created_at - b.created_at)
    })
  }

  /**
   * Initialize chat for the current active account.
   * Safe to call multiple times — only reinits when account changes.
   */
  async function init() {
    try {
      error.value = null
      const account = await getActiveAccount()
      const pubkey = account?.pubkey || null

      // If same account and already initialized, skip
      if (initialized.value && pubkey === currentAccountPubkey.value) return

      // Account changed or first init — full reset
      cleanup()
      currentAccountPubkey.value = pubkey
      initialized.value = false

      if (!pubkey) {
        messages.value = {}
        lastRead.value = {}
        initialized.value = true
        return
      }

      await loadMessages()
      await subscribe()
    } catch (err) {
      console.warn('[chat] init failed:', err)
      error.value = 'chat.initFailed'
    } finally {
      initialized.value = true
    }
  }

  /**
   * Force re-init for account switch. Closes subscriptions,
   * clears in-memory state, and reinitializes for the new account.
   */
  async function switchAccount() {
    initialized.value = false
    currentAccountPubkey.value = null
    cleanup()
    messages.value = {}
    lastRead.value = {}
    await init()
  }

  function cleanup() {
    currentSyncToken = { complete: false }
    subscriptionSignature = null
    // Clear performance caches
    for (const k of Object.keys(messageIdSets)) delete messageIdSets[k]
    dirtyKeys.clear()
    latestTimestamp = 0
    // Clear reactions/deletions state
    reactions.value = {}
    reactionIdSet.clear()
    deletedIds.value = {}
    pendingReactions.length = 0
    pendingDeletions.length = 0
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (subscription) {
      subscription.close()
      subscription = null
    }
  }

  return {
    conversations,
    unreadTotal,
    messages,
    initialized,
    error,
    currentAccountPubkey,
    init,
    switchAccount,
    loadMessages,
    sendMessage,
    retryMessage,
    addZapMessage,
    updateZapStatus,
    subscribe,
    markRead,
    getMessages,
    getReactions,
    isDeleted,
    reactions,
    deletedIds,
    cleanup,
  }
}
