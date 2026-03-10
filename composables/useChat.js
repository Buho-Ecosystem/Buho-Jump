/**
 * Chat composable — NIP-17 (primary) + NIP-04 (fallback) messaging.
 *
 * Manages relay subscriptions, message persistence, conversations,
 * unread tracking, and inline zaps.
 *
 * All data is scoped per-account — switching accounts triggers a
 * full reset: close subscriptions, load the new account's messages,
 * and re-subscribe to relays.
 *
 * Local accounts: NIP-17 (gift-wrapped, kind 1059 → kind 14)
 * NIP-46 accounts: NIP-04 (kind 4) via signer
 */

import { ref, computed } from 'vue'
import { nip04, finalizeEvent, hexToBytes } from 'nostr-core'
import { wrapDirectMessage, unwrapDirectMessage } from '../lib/nip17.js'
import { getActiveAccount } from '../lib/accounts.js'
import { getPool } from '../lib/relayPool.js'
import { getPoolRelays, getOutboxRelays, getInboxRelays, DEFAULT_CHAT_RELAYS } from '../lib/relays.js'

// ── Singleton reactive state ──
const messages = ref({})     // { [pubkey]: Message[] }
const lastRead = ref({})     // { [pubkey]: timestamp }
const initialized = ref(false)
const currentAccountPubkey = ref(null) // tracks which account owns the data

let subscription = null

// Message shape:
// { id, sender: 'me'|pubkey, content, created_at, protocol: 'nip17'|'nip04', type?: 'zap' }

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
    } catch { /* storage error */ }
  }

  let persistTimer = null
  function persistMessages() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!currentAccountPubkey.value) return
      try {
        const keys = storageKeys(currentAccountPubkey.value)
        await chrome.storage.local.set({
          [keys.messages]: JSON.parse(JSON.stringify(messages.value)),
          [keys.lastRead]: JSON.parse(JSON.stringify(lastRead.value)),
        })
      } catch { /* storage error */ }
    }, 500)
  }

  function addMessage(pubkey, msg) {
    if (!messages.value[pubkey]) {
      messages.value[pubkey] = []
    }
    // Deduplicate by id
    if (messages.value[pubkey].some(m => m.id === msg.id)) return
    messages.value[pubkey] = [...messages.value[pubkey], msg]
    persistMessages()

    // Trigger browser notification for incoming messages (not from us)
    if (msg.sender !== 'me' && msg.type !== 'zap') {
      const preview = msg.content?.slice(0, 120) || ''
      chrome.runtime.sendMessage({
        type: 'NOTIFY_DM',
        params: [{ senderName: pubkey.slice(0, 12) + '...', preview, messageId: msg.id }],
      }).catch(() => { /* background not ready */ })
    }
  }

  // ── Send ──

  async function sendMessage(recipientPubkey, content) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()

    // Outbox model: own chat relays + recipient's NIP-65 write relays
    const ownChatRelays = account.pubkey
      ? await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
      : DEFAULT_CHAT_RELAYS
    let recipientWriteRelays = []
    try { recipientWriteRelays = await getOutboxRelays(recipientPubkey) } catch { /* ignore */ }
    const publishRelays = [...new Set([...ownChatRelays, ...recipientWriteRelays])]

    if (account.mode === 'local' && account.secretHex) {
      // NIP-17: Gift-wrapped DM
      const secretKey = hexToBytes(account.secretHex)
      const wrap = wrapDirectMessage(content, secretKey, recipientPubkey)

      await pool.publish(publishRelays, wrap)

      addMessage(recipientPubkey, {
        id: wrap.id,
        sender: 'me',
        content,
        created_at: Math.floor(Date.now() / 1000),
        protocol: 'nip17',
      })
    } else {
      // NIP-04 fallback (works for both local and NIP-46 via background)
      const secretKey = hexToBytes(account.secretHex || account.nip46ClientSecretHex)
      const encrypted = nip04.encrypt(secretKey, recipientPubkey, content)

      const event = finalizeEvent({
        kind: 4,
        tags: [['p', recipientPubkey]],
        content: encrypted,
        created_at: Math.floor(Date.now() / 1000),
      }, secretKey)

      await pool.publish(publishRelays, event)

      addMessage(recipientPubkey, {
        id: event.id,
        sender: 'me',
        content,
        created_at: Math.floor(Date.now() / 1000),
        protocol: 'nip04',
      })
    }
  }

  /**
   * Record a zap sent to a contact (special message type).
   */
  function addZapMessage(recipientPubkey, amountSats) {
    addMessage(recipientPubkey, {
      id: `zap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sender: 'me',
      content: `${amountSats.toLocaleString()} sats`,
      created_at: Math.floor(Date.now() / 1000),
      protocol: 'zap',
      type: 'zap',
    })
  }

  // ── Subscriptions ──

  async function subscribe() {
    const account = await getActiveAccount()
    if (!account?.pubkey) return

    // Cleanup previous
    if (subscription) {
      subscription.close()
      subscription = null
    }

    const pool = getPool()
    const myPubkey = account.pubkey
    const secretKey = account.secretHex ? hexToBytes(account.secretHex) : null

    if (!secretKey) return // Can't decrypt without secret key

    // Determine "since" — last known message or 30 days ago
    let since = Math.floor(Date.now() / 1000) - 86400 * 30
    for (const msgs of Object.values(messages.value)) {
      for (const m of msgs) {
        if (m.created_at > since) since = m.created_at
      }
    }
    // Go back 1 hour from latest to catch any we missed
    since = Math.max(since - 3600, Math.floor(Date.now() / 1000) - 86400 * 30)

    // Inbox model: own chat relays + own NIP-65 read relays
    const ownChatRelays = account.pubkey
      ? await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
      : DEFAULT_CHAT_RELAYS
    let inboxRelays = []
    try { inboxRelays = await getInboxRelays(myPubkey) } catch { /* ignore */ }
    const subscribeRelays = [...new Set([...ownChatRelays, ...inboxRelays])]

    const subs = []

    // NIP-17: Gift wraps addressed to us (kind 1059)
    subs.push(pool.subscribe(subscribeRelays, {
      kinds: [1059],
      '#p': [myPubkey],
      since,
    }, {
      onevent(event) {
        try {
          const dm = unwrapDirectMessage(event, secretKey)
          if (dm.sender === myPubkey) return // Skip our own wrapped messages
          addMessage(dm.sender, {
            id: dm.id,
            sender: dm.sender,
            content: dm.content,
            created_at: dm.created_at,
            protocol: 'nip17',
          })
        } catch { /* decryption failed — not for us or corrupt */ }
      },
    }))

    // NIP-04: DMs sent TO us (kind 4)
    subs.push(pool.subscribe(subscribeRelays, {
      kinds: [4],
      '#p': [myPubkey],
      since,
    }, {
      onevent(event) {
        try {
          const content = nip04.decrypt(secretKey, event.pubkey, event.content)
          addMessage(event.pubkey, {
            id: event.id,
            sender: event.pubkey,
            content,
            created_at: event.created_at,
            protocol: 'nip04',
          })
        } catch { /* decryption failed */ }
      },
    }))

    // NIP-04: DMs sent BY us (kind 4, author = us)
    subs.push(pool.subscribe(subscribeRelays, {
      kinds: [4],
      authors: [myPubkey],
      since,
    }, {
      onevent(event) {
        const pTag = event.tags.find(t => t[0] === 'p')
        if (!pTag) return
        const recipientPubkey = pTag[1]
        try {
          const content = nip04.decrypt(secretKey, recipientPubkey, event.content)
          addMessage(recipientPubkey, {
            id: event.id,
            sender: 'me',
            content,
            created_at: event.created_at,
            protocol: 'nip04',
          })
        } catch { /* decryption failed */ }
      },
    }))

    subscription = {
      close() { subs.forEach(s => s.close()) },
    }
  }

  // ── Helpers ──

  function markRead(pubkey) {
    lastRead.value = { ...lastRead.value, [pubkey]: Math.floor(Date.now() / 1000) }
    persistMessages()
  }

  function getMessages(pubkey) {
    return computed(() => {
      const msgs = messages.value[pubkey] || []
      return [...msgs].sort((a, b) => a.created_at - b.created_at)
    })
  }

  /**
   * Initialize chat for the current active account.
   * Safe to call multiple times — only reinits when account changes.
   */
  async function init() {
    try {
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
    currentAccountPubkey,
    init,
    switchAccount,
    loadMessages,
    sendMessage,
    addZapMessage,
    subscribe,
    markRead,
    getMessages,
    cleanup,
  }
}
