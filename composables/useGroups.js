/**
 * Groups composable — NIP-29 relay-based group chat.
 *
 * Each group lives on a specific relay. Messages are kind 9 (plaintext,
 * not encrypted). Admin actions use kinds 9000-9005. Group metadata,
 * members, and admins are kinds 39000-39002 (replaceable, managed by relay).
 *
 * All data is scoped per-account — switching accounts triggers a
 * full reset: close subscriptions, load the new account's data,
 * and re-subscribe to group relays.
 */

import { ref, computed } from 'vue'
import { nip29, finalizeEvent, hexToBytes } from 'nostr-core'
import { useMessaging } from './useMessaging.js'
import { getActiveAccount } from '../lib/accounts.js'
import { getPool } from '../lib/relayPool.js'
import { getPoolRelays, DEFAULT_CHAT_RELAYS } from '../lib/relays.js'

// ── Singleton reactive state ──

const groups = ref([])            // joined groups: [{ id, relay, name, about, picture, isOpen, isPublic, joinedAt }]
const messages = ref({})          // { ["groupId:relay"]: GroupMessage[] }
const lastRead = ref({})          // { ["groupId:relay"]: timestamp }
const invitations = ref([])       // [{ groupId, relay, inviterPubkey, timestamp }]
const initialized = ref(false)
const currentAccountPubkey = ref(null)

let subscriptions = []            // one sub per group + one for invitations

// Group message shape:
// { id, sender: pubkey, content, created_at, replyTo?, groupId }

// ── Helpers ──

function groupKey(groupId, relay) {
  return `${groupId}:${relay}`
}

function storageKeys(accountPubkey) {
  return {
    groups: `groupList_${accountPubkey}`,
    messages: `groupMessages_${accountPubkey}`,
    lastRead: `groupLastRead_${accountPubkey}`,
    invitations: `groupInvitations_${accountPubkey}`,
  }
}

export function useGroups() {

  // ── Computed ──

  const groupConversations = computed(() => {
    const list = []
    for (const group of groups.value) {
      const key = groupKey(group.id, group.relay)
      const msgs = messages.value[key] || []
      if (msgs.length === 0) {
        // Show group even with no messages
        list.push({ groupKey: key, group, lastMessage: null, unread: 0, type: 'group' })
        continue
      }
      const sorted = [...msgs].sort((a, b) => b.created_at - a.created_at)
      const lastMsg = sorted[0]
      const lastReadTs = lastRead.value[key] || 0
      const unread = sorted.filter(m => m.sender !== currentAccountPubkey.value && m.created_at > lastReadTs).length
      list.push({ groupKey: key, group, lastMessage: lastMsg, unread, type: 'group' })
    }
    return list.sort((a, b) => {
      const aTs = a.lastMessage?.created_at || a.group.joinedAt || 0
      const bTs = b.lastMessage?.created_at || b.group.joinedAt || 0
      return bTs - aTs
    })
  })

  const unreadGroupTotal = computed(() =>
    groupConversations.value.reduce((sum, c) => sum + c.unread, 0)
  )

  // ── Persistence ──

  async function loadData() {
    if (!currentAccountPubkey.value) {
      groups.value = []
      messages.value = {}
      lastRead.value = {}
      invitations.value = []
      return
    }
    try {
      const keys = storageKeys(currentAccountPubkey.value)
      const data = await chrome.storage.local.get([keys.groups, keys.messages, keys.lastRead, keys.invitations])
      groups.value = data[keys.groups] || []
      messages.value = data[keys.messages] || {}
      lastRead.value = data[keys.lastRead] || {}
      invitations.value = data[keys.invitations] || []
    } catch { /* storage error */ }
  }

  let persistTimer = null
  function persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!currentAccountPubkey.value) return
      try {
        const keys = storageKeys(currentAccountPubkey.value)
        await chrome.storage.local.set({
          [keys.groups]: JSON.parse(JSON.stringify(groups.value)),
          [keys.messages]: JSON.parse(JSON.stringify(messages.value)),
          [keys.lastRead]: JSON.parse(JSON.stringify(lastRead.value)),
          [keys.invitations]: JSON.parse(JSON.stringify(invitations.value)),
        })
      } catch { /* storage error */ }
    }, 500)
  }

  // ── Message handling ──

  function addMessage(gKey, msg) {
    if (!messages.value[gKey]) {
      messages.value[gKey] = []
    }
    if (messages.value[gKey].some(m => m.id === msg.id)) return
    messages.value[gKey] = [...messages.value[gKey], msg]
    // Cap at 500 messages per group to limit storage
    if (messages.value[gKey].length > 500) {
      messages.value[gKey] = messages.value[gKey]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 500)
    }
    persist()
  }

  function getMessages(gKey) {
    return computed(() => {
      const msgs = messages.value[gKey] || []
      return [...msgs].sort((a, b) => a.created_at - b.created_at)
    })
  }

  function markRead(gKey) {
    lastRead.value = { ...lastRead.value, [gKey]: Math.floor(Date.now() / 1000) }
    persist()
  }

  // ── Send ──

  async function sendGroupMessage(groupId, relay, content, replyTo) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()
    const gKey = groupKey(groupId, relay)
    const now = Math.floor(Date.now() / 1000)
    const tempId = `gpending-${now}-${Math.random().toString(36).slice(2, 8)}`

    // Optimistic message
    addMessage(gKey, {
      id: tempId,
      sender: account.pubkey,
      content,
      created_at: now,
      groupId,
      replyTo: replyTo || undefined,
      status: 'sending',
    })

    try {
      const template = nip29.createGroupChatTemplate(groupId, content, replyTo || undefined)
      let signed

      if (account.secretHex) {
        signed = finalizeEvent(template, hexToBytes(account.secretHex))
      } else {
        const { send } = useMessaging()
        signed = await send('CHAT_SIGN', template)
      }

      await pool.publish([relay], signed)
      updateMessageStatus(gKey, tempId, 'sent', signed.id)
    } catch (err) {
      updateMessageStatus(gKey, tempId, 'failed')
      throw err
    }
  }

  function updateMessageStatus(gKey, msgId, status, newId) {
    const msgs = messages.value[gKey]
    if (!msgs) return
    const idx = msgs.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const updated = { ...msgs[idx], status }
    if (newId) updated.id = newId
    messages.value[gKey] = [...msgs.slice(0, idx), updated, ...msgs.slice(idx + 1)]
    persist()
  }

  async function retryMessage(gKey, msgId) {
    const msgs = messages.value[gKey]
    if (!msgs) return
    const msg = msgs.find(m => m.id === msgId && m.status === 'failed')
    if (!msg) return
    const group = groups.value.find(g => groupKey(g.id, g.relay) === gKey)
    if (!group) return

    messages.value[gKey] = msgs.filter(m => m.id !== msgId)
    persist()
    await sendGroupMessage(group.id, group.relay, msg.content, msg.replyTo)
  }

  // ── Group management ──

  async function fetchGroupInfo(groupId, relay) {
    const pool = getPool()
    const events = await pool.querySync([relay], {
      kinds: [39000, 39001, 39002],
      '#d': [groupId],
    }, { maxWait: 8000 })

    let metadata = null
    let members = []
    let admins = []

    for (const event of events) {
      if (event.kind === 39000) metadata = nip29.parseGroupMetadata(event)
      else if (event.kind === 39002) members = nip29.parseGroupMembers(event)
      else if (event.kind === 39001) admins = nip29.parseGroupAdmins(event)
    }

    return { metadata, members, admins }
  }

  async function joinGroup(groupId, relay) {
    const gKey = groupKey(groupId, relay)
    // Already joined?
    if (groups.value.some(g => groupKey(g.id, g.relay) === gKey)) return

    // Fetch metadata
    const { metadata, members, admins } = await fetchGroupInfo(groupId, relay)

    const group = {
      id: groupId,
      relay,
      name: metadata?.name || groupId,
      about: metadata?.about || '',
      picture: metadata?.picture || '',
      isOpen: metadata?.isOpen ?? true,
      isPublic: metadata?.isPublic ?? true,
      joinedAt: Math.floor(Date.now() / 1000),
    }

    groups.value = [...groups.value, group]
    persist()

    // Subscribe to this group
    subscribeGroup(group)
  }

  async function leaveGroup(groupId, relay) {
    const gKey = groupKey(groupId, relay)
    groups.value = groups.value.filter(g => groupKey(g.id, g.relay) !== gKey)
    delete messages.value[gKey]
    delete lastRead.value[gKey]
    persist()
    // Subscriptions will be rebuilt on next init or can close individually
    // For simplicity, just cleanup and resubscribe all
    closeSubscriptions()
    await subscribe()
  }

  // ── Admin actions ──

  async function adminAction(groupId, relay, action) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()
    const template = nip29.createGroupAdminTemplate(groupId, action)
    let signed

    if (account.secretHex) {
      signed = finalizeEvent(template, hexToBytes(account.secretHex))
    } else {
      const { send } = useMessaging()
      signed = await send('CHAT_SIGN', template)
    }

    await pool.publish([relay], signed)
  }

  // ── Invitations ──

  function addInvitation(groupId, relay, inviterPubkey) {
    const exists = invitations.value.some(
      inv => inv.groupId === groupId && inv.relay === relay
    )
    if (exists) return
    invitations.value = [...invitations.value, {
      groupId,
      relay,
      inviterPubkey,
      timestamp: Math.floor(Date.now() / 1000),
    }]
    persist()
  }

  async function acceptInvitation(groupId, relay) {
    invitations.value = invitations.value.filter(
      inv => !(inv.groupId === groupId && inv.relay === relay)
    )
    await joinGroup(groupId, relay)
  }

  function declineInvitation(groupId, relay) {
    invitations.value = invitations.value.filter(
      inv => !(inv.groupId === groupId && inv.relay === relay)
    )
    persist()
  }

  async function inviteUser(groupId, relay, pubkey) {
    await adminAction(groupId, relay, { type: 'add-user', pubkey })
  }

  // ── Subscriptions ──

  function subscribeGroup(group) {
    const pool = getPool()
    const gKey = groupKey(group.id, group.relay)

    // Determine "since" — latest message or 30 days ago
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 30
    const msgs = messages.value[gKey] || []
    let latest = thirtyDaysAgo
    for (const m of msgs) {
      if (m.created_at > latest) latest = m.created_at
    }
    const since = Math.max(latest - 3600, thirtyDaysAgo)

    // Kind 9 — group chat messages
    const chatSub = pool.subscribe([group.relay], {
      kinds: [9],
      '#h': [group.id],
      since,
    }, {
      onevent(event) {
        // Skip our own messages that we already have (optimistic)
        const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply')
        addMessage(gKey, {
          id: event.id,
          sender: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          groupId: group.id,
          replyTo: replyTag?.[1] || undefined,
        })
      },
    })

    // Kind 39000/39001/39002 — live metadata updates
    const metaSub = pool.subscribe([group.relay], {
      kinds: [39000, 39001, 39002],
      '#d': [group.id],
    }, {
      onevent(event) {
        const idx = groups.value.findIndex(g => g.id === group.id && g.relay === group.relay)
        if (idx === -1) return

        if (event.kind === 39000) {
          const meta = nip29.parseGroupMetadata(event)
          groups.value = groups.value.map((g, i) =>
            i === idx ? { ...g, name: meta.name || g.name, about: meta.about || g.about, picture: meta.picture || g.picture, isOpen: meta.isOpen, isPublic: meta.isPublic } : g
          )
          persist()
        }
        // Members and admins updates could be tracked too but we fetch on-demand via GroupInfo
      },
    })

    subscriptions.push(chatSub, metaSub)
  }

  async function subscribe() {
    const account = await getActiveAccount()
    if (!account?.pubkey) return

    closeSubscriptions()

    const pool = getPool()
    const myPubkey = account.pubkey

    // Subscribe to each joined group
    for (const group of groups.value) {
      subscribeGroup(group)
    }

    // Subscribe for invitations — kind 9000 (add-user) addressed to us
    const chatRelays = await getPoolRelays(myPubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const invSub = pool.subscribe(chatRelays, {
      kinds: [9000],
      '#p': [myPubkey],
      since: Math.floor(Date.now() / 1000) - 86400 * 30,
    }, {
      onevent(event) {
        const hTag = event.tags.find(t => t[0] === 'h')
        if (!hTag) return
        // The relay the invitation came from is the group's relay
        // We can infer it, but the event doesn't carry it explicitly.
        // Use a default: the relay URL this event came from.
        // For now, store with relay = event source or first chat relay.
        const relay = chatRelays[0] || ''
        addInvitation(hTag[1], relay, event.pubkey)
      },
    })
    subscriptions.push(invSub)
  }

  function closeSubscriptions() {
    for (const sub of subscriptions) {
      try { sub.close() } catch { /* best effort */ }
    }
    subscriptions = []
  }

  // ── Lifecycle ──

  async function init() {
    try {
      const account = await getActiveAccount()
      const pubkey = account?.pubkey || null

      if (initialized.value && pubkey === currentAccountPubkey.value) return

      cleanup()
      currentAccountPubkey.value = pubkey
      initialized.value = false

      if (!pubkey) {
        groups.value = []
        messages.value = {}
        lastRead.value = {}
        invitations.value = []
        initialized.value = true
        return
      }

      await loadData()
      await subscribe()
    } catch (err) {
      console.warn('[groups] init failed:', err)
    } finally {
      initialized.value = true
    }
  }

  async function switchAccount() {
    initialized.value = false
    currentAccountPubkey.value = null
    cleanup()
    groups.value = []
    messages.value = {}
    lastRead.value = {}
    invitations.value = []
    await init()
  }

  function cleanup() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    closeSubscriptions()
  }

  return {
    groups,
    invitations,
    groupConversations,
    unreadGroupTotal,
    initialized,
    currentAccountPubkey,
    init,
    switchAccount,
    cleanup,
    sendGroupMessage,
    retryMessage,
    getMessages,
    markRead,
    joinGroup,
    leaveGroup,
    fetchGroupInfo,
    adminAction,
    inviteUser,
    acceptInvitation,
    declineInvitation,
  }
}
