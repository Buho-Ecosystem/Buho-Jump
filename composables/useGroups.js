/**
 * Groups composable — three group types following the 0xchat model:
 *
 * 1. PRIVATE GROUP (NIP-17 gift-wrap)
 *    - E2E encrypted, each message gift-wrapped to every member
 *    - Uses nip59.createRumor + createSeal + createWrap per member
 *    - Best for < 100 members (small trusted circles)
 *    - Managed locally — member list stored in extension
 *
 * 2. RELAY GROUP (NIP-29)
 *    - Relay-enforced access, messages NOT encrypted
 *    - Open groups: anyone can join; Closed: admin approval needed
 *    - Admin actions via kinds 9000-9005
 *    - Scales to large groups
 *
 * 3. OPEN CHANNEL (NIP-28)
 *    - Public, anyone can read and write
 *    - Kind 40 (create), 41 (metadata), 42 (message)
 *    - Best for open communities
 *
 * All data is scoped per-account. Switching accounts triggers a full reset.
 */

import { ref, computed } from 'vue'
import {
  nip28, nip29, nip59,
  finalizeEvent, hexToBytes, bytesToHex, getPublicKey,
} from 'nostr-core'
import { useMessaging } from './useMessaging.js'
import { getPool } from '../lib/relayPool.js'
import {
  createGroupIdentity, createEpoch, createEpochTicketsForMembers,
  encryptEpochPrivkey, decryptEpochPrivkey,
  parseEpochTicket, buildEpochMessageTags, parseGroupMessageTags,
} from '../lib/epoch.js'

/**
 * Get the active account from the background service worker.
 * Accounts are encrypted at rest — only the background has the password.
 */
async function getActiveAccount() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ACCOUNT' })
  return response?.result || null
}
import { getPoolRelays, getOutboxRelays, getInboxRelays, DEFAULT_CHAT_RELAYS } from '../lib/relays.js'

// ── Singleton reactive state ──

const groups = ref([])
// Group shape: { id, type: 'private'|'relay'|'channel', relay?, name, about, picture,
//   isOpen?, isPublic?, members?: string[], joinedAt,
//   // Epoch fields (private groups only):
//   groupPubkey?, groupPrivkeyEncrypted?, epochs?: [{ number, pubkey, privkeyEncrypted }],
//   currentEpoch?: number }

const messages = ref({})          // { [groupKey]: Message[] }
const lastRead = ref({})          // { [groupKey]: timestamp }
const invitations = ref([])       // { groupId, relay, inviterPubkey, type, timestamp }

// Relay group member/admin cache: { [groupKey]: { members, admins, fetchedAt } }
const memberCache = {}
const initialized = ref(false)
const error = ref(null)      // i18n key or null — set on init/subscribe failure
const currentAccountPubkey = ref(null)

let subscriptions = []

// Performance: O(1) dedup, dirty tracking, per-group timestamp cache
const groupIdSets = {}          // { [groupKey]: Set<id> } — for O(1) dedup
const dirtyGroupKeys = new Set() // group keys with unsaved changes
let dirtyMeta = false            // tracks changes to groups list or invitations
const groupLatestTs = {}         // { [groupKey]: number } — cached latest timestamp

// EOSE sync token — scoped per subscription cycle (same pattern as useChat.js)
let currentGroupSyncToken = { complete: false }

// Message shape (all group types):
// { id, sender, content, created_at, groupId, replyTo?, status? }

// ── Key helpers ──

function gkey(group) {
  if (group.type === 'private') return `priv||${group.id}`
  if (group.type === 'channel') return `chan||${group.id}`
  return `relay||${group.id}||${group.relay}`
}

function gkeyFromParts(type, id, relay) {
  if (type === 'private') return `priv||${id}`
  if (type === 'channel') return `chan||${id}`
  return `relay||${id}||${relay}`
}

function storageKeys(pubkey) {
  return {
    groups: `groupList_${pubkey}`,
    messages: `groupMessages_${pubkey}`,
    lastRead: `groupLastRead_${pubkey}`,
    invitations: `groupInvitations_${pubkey}`,
  }
}

export function useGroups() {

  // ── Computed ──

  const groupConversations = computed(() => {
    const list = []
    for (const group of groups.value) {
      const key = gkey(group)
      const msgs = messages.value[key] || []
      const sorted = msgs.length > 0
        ? [...msgs].sort((a, b) => b.created_at - a.created_at)
        : []
      const lastMsg = sorted[0] || null
      const lastReadTs = lastRead.value[key] || 0
      const unread = sorted.filter(m =>
        m.sender !== currentAccountPubkey.value && m.created_at > lastReadTs
      ).length
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
      groups.value = []; messages.value = {}; lastRead.value = {}; invitations.value = []
      return
    }
    try {
      const keys = storageKeys(currentAccountPubkey.value)
      const data = await chrome.storage.local.get([keys.groups, keys.messages, keys.lastRead, keys.invitations])
      groups.value = data[keys.groups] || []
      messages.value = data[keys.messages] || {}
      lastRead.value = data[keys.lastRead] || {}
      invitations.value = data[keys.invitations] || []

      // Rebuild ID sets and timestamp caches
      for (const [key, msgs] of Object.entries(messages.value)) {
        const idSet = new Set()
        let latest = 0
        for (const m of msgs) {
          idSet.add(m.id)
          if (m.created_at > latest) latest = m.created_at
        }
        groupIdSets[key] = idSet
        groupLatestTs[key] = latest
      }
    } catch { /* storage error */ }
  }

  /** Mark metadata (groups list, lastRead, invitations) as needing persistence. */
  function persistMeta() {
    dirtyMeta = true
    persist()
  }

  let persistTimer = null
  function persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      if (!currentAccountPubkey.value) return
      if (dirtyGroupKeys.size === 0 && !dirtyMeta) return
      try {
        const keys = storageKeys(currentAccountPubkey.value)
        const toSet = {}

        // Always persist metadata if dirty (groups list, invitations, lastRead)
        if (dirtyMeta) {
          toSet[keys.groups] = JSON.parse(JSON.stringify(groups.value))
          toSet[keys.lastRead] = JSON.parse(JSON.stringify(lastRead.value))
          toSet[keys.invitations] = JSON.parse(JSON.stringify(invitations.value))
        }

        // Only serialize dirty group message arrays
        if (dirtyGroupKeys.size > 0) {
          const stored = await chrome.storage.local.get(keys.messages)
          const existing = stored[keys.messages] || {}
          for (const gk of dirtyGroupKeys) {
            existing[gk] = JSON.parse(JSON.stringify(messages.value[gk]))
          }
          toSet[keys.messages] = existing
        }

        await chrome.storage.local.set(toSet)
        dirtyGroupKeys.clear()
        dirtyMeta = false
      } catch { /* storage error */ }
    }, 500)
  }

  // ── Message handling ──

  function addMessage(key, msg) {
    if (!messages.value[key]) messages.value[key] = []
    // O(1) dedup via ID set
    if (!groupIdSets[key]) groupIdSets[key] = new Set(messages.value[key].map(m => m.id))
    if (groupIdSets[key].has(msg.id)) return
    groupIdSets[key].add(msg.id)

    messages.value[key] = [...messages.value[key], msg]
    // Cap at 500 per group
    if (messages.value[key].length > 500) {
      messages.value[key] = messages.value[key]
        .sort((a, b) => b.created_at - a.created_at).slice(0, 500)
      // Rebuild ID set after pruning
      groupIdSets[key] = new Set(messages.value[key].map(m => m.id))
    }
    dirtyGroupKeys.add(key)
    if (msg.created_at > (groupLatestTs[key] || 0)) groupLatestTs[key] = msg.created_at
    persist()

    // Trigger browser notification only for real-time messages (after initial sync)
    if (currentGroupSyncToken.complete && msg.sender && msg.sender !== currentAccountPubkey.value) {
      const group = groups.value.find(g => gkey(g) === key)
      const groupName = group?.name || group?.id || 'Group'
      const senderShort = msg.sender.slice(0, 12) + '...'
      const preview = msg.content?.slice(0, 120) || ''
      chrome.runtime.sendMessage({
        type: 'NOTIFY_GROUP',
        params: [{ groupName, senderName: senderShort, preview, messageId: msg.id }],
      }).catch(() => { /* background not ready */ })
    }
  }

  function getMessages(key) {
    return computed(() => {
      const msgs = messages.value[key] || []
      return [...msgs].sort((a, b) => a.created_at - b.created_at)
    })
  }

  function markRead(key) {
    lastRead.value = { ...lastRead.value, [key]: Math.floor(Date.now() / 1000) }
    persistMeta()
  }

  function updateMessageStatus(key, msgId, status, newId) {
    const msgs = messages.value[key]
    if (!msgs) return
    const idx = msgs.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const updated = { ...msgs[idx], status }
    if (newId) {
      updated.id = newId
      if (groupIdSets[key]) {
        groupIdSets[key].delete(msgId)
        groupIdSets[key].add(newId)
      }
    }
    messages.value[key] = [...msgs.slice(0, idx), updated, ...msgs.slice(idx + 1)]
    dirtyGroupKeys.add(key)
    persist()
  }

  // ══════════════════════════════════════════════
  // ══ SEND — dispatches by group type
  // ══════════════════════════════════════════════

  async function sendGroupMessage(group, content, replyTo) {
    if (group.type === 'private') return sendPrivateGroupMessage(group, content, replyTo)
    if (group.type === 'relay') return sendRelayGroupMessage(group, content, replyTo)
    if (group.type === 'channel') return sendChannelMessage(group, content, replyTo)
    throw new Error('Unknown group type')
  }

  // ── Private group (NIP-17 gift-wrap to all members) ──

  async function sendPrivateGroupMessage(group, content, replyTo) {
    const account = await getActiveAccount()
    if (!account?.secretHex) throw new Error('Private groups require a local account')

    const pool = getPool()
    const secretKey = hexToBytes(account.secretHex)
    const senderPubkey = account.pubkey
    const now = Math.floor(Date.now() / 1000)
    const key = gkey(group)
    const tempId = `gpend-${now}-${Math.random().toString(36).slice(2, 8)}`

    addMessage(key, {
      id: tempId, sender: senderPubkey, content, created_at: now,
      groupId: group.id, replyTo, status: 'sending',
    })

    try {
      const currentEpochEntry = group.epochs?.find(e => e.number === group.currentEpoch)
      if (!currentEpochEntry) throw new Error('No epoch key available')

      const tags = buildEpochMessageTags({
        epochPubkey: currentEpochEntry.pubkey,
        groupPubkey: group.groupPubkey || group.id,
        epochNumber: group.currentEpoch,
        replyTo,
      })

      const rumor = nip59.createRumor({
        kind: 14, content, tags, created_at: now,
      }, senderPubkey)

      // Gift-wrap to EACH member individually (standard NIP-17 pattern).
      // Each member decrypts with their own account key.
      const allRecipients = [...new Set([...(group.members || []), senderPubkey])]
      const chatRelays = await getPoolRelays(senderPubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)

      const wraps = allRecipients.map(recipientPubkey => {
        const seal = nip59.createSeal(rumor, secretKey, recipientPubkey)
        return nip59.createWrap(seal, recipientPubkey)
      })

      await Promise.all(wraps.map(wrap => pool.publish(chatRelays, wrap)))
      updateMessageStatus(key, tempId, 'sent', rumor.id)
    } catch (err) {
      updateMessageStatus(key, tempId, 'failed')
      throw err
    }
  }

  // ── Relay group (NIP-29 kind 9) ──

  async function sendRelayGroupMessage(group, content, replyTo) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()
    const now = Math.floor(Date.now() / 1000)
    const key = gkey(group)
    const tempId = `gpend-${now}-${Math.random().toString(36).slice(2, 8)}`

    addMessage(key, {
      id: tempId, sender: account.pubkey, content, created_at: now,
      groupId: group.id, replyTo, status: 'sending',
    })

    try {
      const template = nip29.createGroupChatTemplate(group.id, content, replyTo || undefined)
      let signed
      if (account.secretHex) {
        signed = finalizeEvent(template, hexToBytes(account.secretHex))
      } else {
        const { send } = useMessaging()
        signed = await send('CHAT_SIGN', template)
      }
      await pool.publish([group.relay], signed)
      updateMessageStatus(key, tempId, 'sent', signed.id)
    } catch (err) {
      updateMessageStatus(key, tempId, 'failed')
      throw err
    }
  }

  // ── Open channel (NIP-28 kind 42) ──

  async function sendChannelMessage(group, content, replyTo) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()
    const now = Math.floor(Date.now() / 1000)
    const key = gkey(group)
    const tempId = `gpend-${now}-${Math.random().toString(36).slice(2, 8)}`

    addMessage(key, {
      id: tempId, sender: account.pubkey, content, created_at: now,
      groupId: group.id, replyTo, status: 'sending',
    })

    try {
      const template = nip28.createChannelMessageEventTemplate(
        group.id, content, group.relay || undefined, replyTo || undefined
      )
      let signed
      if (account.secretHex) {
        signed = finalizeEvent(template, hexToBytes(account.secretHex))
      } else {
        const { send } = useMessaging()
        signed = await send('CHAT_SIGN', template)
      }
      const relays = group.relay
        ? [group.relay]
        : await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
      await pool.publish(relays, signed)
      updateMessageStatus(key, tempId, 'sent', signed.id)
    } catch (err) {
      updateMessageStatus(key, tempId, 'failed')
      throw err
    }
  }

  // ── Retry failed message ──

  async function retryMessage(key, msgId) {
    const msgs = messages.value[key]
    if (!msgs) return
    const msg = msgs.find(m => m.id === msgId && m.status === 'failed')
    if (!msg) return
    const group = groups.value.find(g => gkey(g) === key)
    if (!group) return

    messages.value[key] = msgs.filter(m => m.id !== msgId)
    if (groupIdSets[key]) groupIdSets[key].delete(msgId)
    dirtyGroupKeys.add(key)
    persist()
    await sendGroupMessage(group, msg.content, msg.replyTo)
  }

  // ══════════════════════════════════════════════
  // ══ GROUP MANAGEMENT
  // ══════════════════════════════════════════════

  // ── Create private group (local, no relay involved for creation) ──

  /**
   * Create a new epoch-based private group.
   * Generates group identity + epoch 0 + sends tickets to all members.
   */
  async function createPrivateGroup(name, about, memberPubkeys) {
    const account = await getActiveAccount()
    if (!account?.secretHex) throw new Error('Private groups require a local account')

    const secretKey = hexToBytes(account.secretHex)
    const { groupPrivkey, groupPubkey, epoch } = createGroupIdentity()

    // Encrypt group privkey and epoch privkey for storage
    const groupPrivkeyEncrypted = encryptEpochPrivkey(groupPrivkey, secretKey)
    const epochPrivkeyEncrypted = encryptEpochPrivkey(epoch.privkey, secretKey)

    const group = {
      id: groupPubkey, // group identity IS the ID
      type: 'private',
      name,
      about: about || '',
      picture: '',
      members: memberPubkeys,
      joinedAt: Math.floor(Date.now() / 1000),
      // Epoch fields
      groupPubkey,
      groupPrivkeyEncrypted,
      epochs: [{ number: epoch.number, pubkey: epoch.pubkey, privkeyEncrypted: epochPrivkeyEncrypted }],
      currentEpoch: epoch.number,
    }

    // Send epoch tickets to all members + self
    const allRecipients = [...new Set([...memberPubkeys, account.pubkey])]
    const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const tickets = createEpochTicketsForMembers({
      groupPrivkey, groupPubkey,
      epochNumber: epoch.number,
      epochPrivkey: epoch.privkey,
      memberPubkeys: allRecipients,
      senderSecretKey: secretKey,
    })

    const pool = getPool()
    await Promise.allSettled(tickets.map(t => pool.publish(chatRelays, t.wrap)))

    groups.value = [...groups.value, group]
    persistMeta()
    subscribePrivateGroup(group)
    return group
  }

  /**
   * Add a member to a private group.
   * Sends the current epoch ticket to the new member (no rotation needed).
   */
  async function addMemberToPrivateGroup(groupId, pubkey) {
    const idx = groups.value.findIndex(g => g.id === groupId && g.type === 'private')
    if (idx === -1) return
    const group = groups.value[idx]
    if (group.members?.includes(pubkey)) return

    const account = await getActiveAccount()
    if (!account?.secretHex || !group.groupPrivkeyEncrypted) return

    const secretKey = hexToBytes(account.secretHex)
    const currentEpochEntry = group.epochs?.find(e => e.number === group.currentEpoch)
    if (!currentEpochEntry) return

    // Decrypt group privkey and epoch privkey to create ticket
    const groupPrivkey = decryptEpochPrivkey(group.groupPrivkeyEncrypted, group.groupPubkey, secretKey)
    const epochPrivkey = decryptEpochPrivkey(currentEpochEntry.privkeyEncrypted, currentEpochEntry.pubkey, secretKey)

    const tickets = createEpochTicketsForMembers({
      groupPrivkey, groupPubkey: group.groupPubkey,
      epochNumber: group.currentEpoch,
      epochPrivkey,
      memberPubkeys: [pubkey],
      senderSecretKey: secretKey,
    })

    const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const pool = getPool()
    await Promise.allSettled(tickets.map(t => pool.publish(chatRelays, t.wrap)))

    // Update local member list
    groups.value = groups.value.map((g, i) =>
      i === idx ? { ...g, members: [...(g.members || []), pubkey] } : g
    )
    persistMeta()
  }

  /**
   * Remove a member from a private group.
   * ROTATES the epoch — generates new key, sends to remaining members only.
   * The removed member cannot decrypt future messages.
   */
  async function removeMemberFromPrivateGroup(groupId, pubkey) {
    const idx = groups.value.findIndex(g => g.id === groupId && g.type === 'private')
    if (idx === -1) return
    const group = groups.value[idx]

    const account = await getActiveAccount()
    if (!account?.secretHex || !group.groupPrivkeyEncrypted) return

    const secretKey = hexToBytes(account.secretHex)
    const groupPrivkey = decryptEpochPrivkey(group.groupPrivkeyEncrypted, group.groupPubkey, secretKey)

    // Generate new epoch
    const newEpochNumber = (group.currentEpoch || 0) + 1
    const newEpoch = createEpoch(newEpochNumber)
    const newEpochPrivkeyEncrypted = encryptEpochPrivkey(newEpoch.privkey, secretKey)

    // Remove member from list
    const remainingMembers = (group.members || []).filter(pk => pk !== pubkey)

    // Send new epoch tickets to remaining members + self (NOT the removed member)
    const allRecipients = [...new Set([...remainingMembers, account.pubkey])]
    const tickets = createEpochTicketsForMembers({
      groupPrivkey, groupPubkey: group.groupPubkey,
      epochNumber: newEpoch.number,
      epochPrivkey: newEpoch.privkey,
      memberPubkeys: allRecipients,
      senderSecretKey: secretKey,
    })

    const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const pool = getPool()
    await Promise.allSettled(tickets.map(t => pool.publish(chatRelays, t.wrap)))

    // Update local state
    const updatedEpochs = [
      ...(group.epochs || []),
      { number: newEpoch.number, pubkey: newEpoch.pubkey, privkeyEncrypted: newEpochPrivkeyEncrypted },
    ]
    groups.value = groups.value.map((g, i) =>
      i === idx ? { ...g, members: remainingMembers, epochs: updatedEpochs, currentEpoch: newEpoch.number } : g
    )
    persistMeta()

    // Re-subscribe with the updated group object (not stale reference)
    const updatedGroup = groups.value[idx]
    resubscribePrivateGroup(updatedGroup)
  }

  // ── Join relay group (NIP-29) ──

  async function joinRelayGroup(groupId, relay) {
    const key = gkeyFromParts('relay', groupId, relay)
    if (groups.value.some(g => gkey(g) === key)) return

    const { metadata } = await fetchRelayGroupInfo(groupId, relay)
    const group = {
      id: groupId, type: 'relay', relay, name: metadata?.name || groupId,
      about: metadata?.about || '', picture: metadata?.picture || '',
      isOpen: metadata?.isOpen ?? true, isPublic: metadata?.isPublic ?? true,
      joinedAt: Math.floor(Date.now() / 1000),
    }
    groups.value = [...groups.value, group]
    persistMeta()
    subscribeRelayGroup(group)
  }

  // ── Join open channel (NIP-28) ──

  async function joinChannel(channelId, relay) {
    const key = gkeyFromParts('channel', channelId, relay)
    if (groups.value.some(g => gkey(g) === key)) return

    // Fetch channel metadata (kind 40)
    const pool = getPool()
    const relays = relay ? [relay] : DEFAULT_CHAT_RELAYS
    const events = await pool.querySync(relays, {
      ids: [channelId],
      kinds: [40],
    }, { maxWait: 6000 })

    let meta = { name: channelId }
    if (events.length > 0) {
      meta = nip28.parseChannelMetadata(events[0])
    }

    const group = {
      id: channelId, type: 'channel', relay: relay || '',
      name: meta.name || channelId, about: meta.about || '',
      picture: meta.picture || '',
      joinedAt: Math.floor(Date.now() / 1000),
    }
    groups.value = [...groups.value, group]
    persistMeta()
    subscribeChannel(group)
  }

  // ── Create open channel (NIP-28 kind 40) ──

  async function createChannel(name, about, relay) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const pool = getPool()
    const template = nip28.createChannelEventTemplate({ name, about: about || '' })
    let signed
    if (account.secretHex) {
      signed = finalizeEvent(template, hexToBytes(account.secretHex))
    } else {
      const { send } = useMessaging()
      signed = await send('CHAT_SIGN', template)
    }

    const relays = relay ? [relay] : await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    await pool.publish(relays, signed)

    // The channel ID is the event ID of the kind 40
    await joinChannel(signed.id, relay || relays[0])
    return signed.id
  }

  // ── Leave any group ──

  function leaveGroup(groupId, type, relay) {
    const key = gkeyFromParts(type, groupId, relay)
    groups.value = groups.value.filter(g => gkey(g) !== key)
    delete messages.value[key]
    delete lastRead.value[key]
    delete groupIdSets[key]
    delete groupLatestTs[key]
    persistMeta()
    // Resubscribe to rebuild without this group
    closeSubscriptions()
    subscribe()
  }

  // ── Fetch relay group info (NIP-29 kinds 39000/39001/39002) ──

  async function fetchRelayGroupInfo(groupId, relay, opts = {}) {
    const cacheKey = `relay||${groupId}||${relay}`
    const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

    // Return cached data if fresh enough (unless force refresh)
    if (!opts.force && memberCache[cacheKey]) {
      const cached = memberCache[cacheKey]
      if (Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data
    }

    const pool = getPool()
    const events = await pool.querySync([relay], {
      kinds: [39000, 39001, 39002],
      '#d': [groupId],
    }, { maxWait: 8000 })

    let metadata = null, members = [], admins = []
    for (const event of events) {
      if (event.kind === 39000) metadata = nip29.parseGroupMetadata(event)
      else if (event.kind === 39002) members = nip29.parseGroupMembers(event)
      else if (event.kind === 39001) admins = nip29.parseGroupAdmins(event)
    }

    const data = { metadata, members, admins }
    memberCache[cacheKey] = { data, fetchedAt: Date.now() }
    return data
  }

  // ── Admin actions (NIP-29) ──

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

  /**
   * Update channel metadata (NIP-28 kind 41).
   */
  async function updateChannelMetadata(channelId, metadata, relay) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const template = nip28.createChannelMetadataEventTemplate(channelId, metadata, relay)
    let signed
    if (account.secretHex) {
      signed = finalizeEvent(template, hexToBytes(account.secretHex))
    } else {
      const { send } = useMessaging()
      signed = await send('CHAT_SIGN', template)
    }

    const pool = getPool()
    const relays = relay ? [relay] : DEFAULT_CHAT_RELAYS
    await pool.publish(relays, signed)

    // Update local group metadata
    const group = groups.value.find(g => g.id === channelId)
    if (group) {
      if (metadata.name) group.name = metadata.name
      if (metadata.about !== undefined) group.about = metadata.about
      if (metadata.picture !== undefined) group.picture = metadata.picture
      groups.value = [...groups.value]
      persistMeta()
    }
  }

  /**
   * Delete a message in a relay group (NIP-29 kind 9005).
   */
  async function deleteGroupMessage(groupId, relay, eventId) {
    await adminAction(groupId, relay, { type: 'delete-event', eventId })
  }

  /**
   * Hide a message in a channel (NIP-28 kind 43).
   */
  async function hideChannelMessage(messageId, reason, relay) {
    const account = await getActiveAccount()
    if (!account) throw new Error('No active account')

    const template = nip28.createChannelHideMessageEventTemplate(messageId, reason)
    let signed
    if (account.secretHex) {
      signed = finalizeEvent(template, hexToBytes(account.secretHex))
    } else {
      const { send } = useMessaging()
      signed = await send('CHAT_SIGN', template)
    }

    const pool = getPool()
    const relays = relay ? [relay] : DEFAULT_CHAT_RELAYS
    await pool.publish(relays, signed)
  }

  // ── Invitations ──

  function addInvitation(groupId, relay, inviterPubkey, type) {
    if (invitations.value.some(inv => inv.groupId === groupId && inv.relay === relay)) return
    invitations.value = [...invitations.value, {
      groupId, relay, inviterPubkey, type: type || 'relay',
      timestamp: Math.floor(Date.now() / 1000),
    }]
    persistMeta()
  }

  async function acceptInvitation(inv) {
    invitations.value = invitations.value.filter(
      i => !(i.groupId === inv.groupId && i.relay === inv.relay)
    )
    if (inv.type === 'relay') await joinRelayGroup(inv.groupId, inv.relay)
    else if (inv.type === 'channel') await joinChannel(inv.groupId, inv.relay)
    persistMeta()
  }

  function declineInvitation(inv) {
    invitations.value = invitations.value.filter(
      i => !(i.groupId === inv.groupId && i.relay === inv.relay)
    )
    persistMeta()
  }

  async function inviteUser(groupId, relay, pubkey) {
    await adminAction(groupId, relay, { type: 'add-user', pubkey })
  }

  // ══════════════════════════════════════════════
  // ══ SUBSCRIPTIONS — one per group type
  // ══════════════════════════════════════════════

  // onGroupEose is set per subscribe() call — see subscribe() below
  let onGroupEose = () => {}

  // Track active private group subscriptions by group key for cleanup
  const privateGroupSubs = {} // { [groupKey]: subscription }

  /**
   * Close and re-create subscription for a private group.
   * Ensures no duplicate subscriptions exist.
   */
  function resubscribePrivateGroup(group) {
    const key = gkey(group)
    // Close existing subscription for this group
    if (privateGroupSubs[key]) {
      privateGroupSubs[key].close()
      // Remove from global subscriptions array
      const idx = subscriptions.indexOf(privateGroupSubs[key])
      if (idx !== -1) subscriptions.splice(idx, 1)
      delete privateGroupSubs[key]
    }
    subscribePrivateGroup(group)
  }

  function subscribePrivateGroup(group) {
    const account = getActiveAccountSync()
    if (!account?.secretHex) return

    const pool = getPool()
    const secretKey = hexToBytes(account.secretHex)
    const myPubkey = account.pubkey
    const key = gkey(group)
    const chatRelays = getChatRelaysSync()
    const since = getGroupSince(key)
    const groupId = group.groupPubkey || group.id

    // Listen on own pubkey only — messages are wrapped to each member individually
    const sub = pool.subscribe(chatRelays, {
      kinds: [1059],
      '#p': [myPubkey],
      since,
    }, {
      oneose: onGroupEose,
      onevent(event) {
        try {
          const rumor = nip59.unwrap(event, secretKey)

          // ── Kind 1014: Epoch ticket ──
          if (rumor.kind === 1014) {
            const ticket = parseEpochTicket(rumor, groupId)
            if (!ticket) return
            handleIncomingEpochTicket(groupId, ticket, secretKey)
            return
          }

          // ── Kind 14: Group message ──
          if (rumor.kind !== 14) return

          const groupTags = parseGroupMessageTags(rumor.tags)
          if (!groupTags || groupTags.groupPubkey !== groupId) return

          // Validate epoch number is known (if present)
          if (groupTags.epochNumber != null && group.epochs) {
            const knownEpoch = group.epochs.some(e => e.number === groupTags.epochNumber)
            if (!knownEpoch) {
              console.debug(`[groups] Message from unknown epoch ${groupTags.epochNumber} in ${groupId.slice(0, 8)}`)
            }
          }

          const replyTag = rumor.tags?.find(t => t[0] === 'e' && t[3] === 'reply')
          addMessage(key, {
            id: rumor.id,
            sender: rumor.pubkey,
            content: rumor.content,
            created_at: rumor.created_at,
            groupId: group.id,
            replyTo: replyTag?.[1],
            epochNumber: groupTags.epochNumber,
          })
        } catch { /* not for us or decrypt failed */ }
      },
    })

    // Track for cleanup
    privateGroupSubs[key] = sub
    subscriptions.push(sub)
  }

  /**
   * Handle an incoming epoch ticket — store the new epoch key.
   * Uses group pubkey as identifier (not stale group object reference).
   */
  function handleIncomingEpochTicket(groupPubkey, ticket, accountSecretKey) {
    const idx = groups.value.findIndex(g => (g.groupPubkey || g.id) === groupPubkey)
    if (idx === -1) return

    const g = groups.value[idx]
    const existingEpoch = g.epochs?.find(e => e.number === ticket.epochNumber)
    if (existingEpoch) return // Already have this epoch — dedup

    const privkeyEncrypted = encryptEpochPrivkey(ticket.epochPrivkey, accountSecretKey)
    const updatedEpochs = [
      ...(g.epochs || []),
      { number: ticket.epochNumber, pubkey: ticket.epochPubkey, privkeyEncrypted },
    ]
    const isNewer = ticket.epochNumber > (g.currentEpoch || 0)

    groups.value = groups.value.map((gr, i) =>
      i === idx ? {
        ...gr,
        epochs: updatedEpochs,
        currentEpoch: isNewer ? ticket.epochNumber : gr.currentEpoch,
      } : gr
    )
    persistMeta()

    // No re-subscribe needed — messages are wrapped to member pubkey, not epoch pubkey
  }

  function subscribeRelayGroup(group) {
    const pool = getPool()
    const key = gkey(group)
    const since = getGroupSince(key)

    // Kind 9 — group chat messages
    const chatSub = pool.subscribe([group.relay], {
      kinds: [9],
      '#h': [group.id],
      since,
    }, {
      oneose: onGroupEose,
      onevent(event) {
        const replyTag = event.tags.find(t => t[0] === 'e' && t[3] === 'reply')
        addMessage(key, {
          id: event.id, sender: event.pubkey, content: event.content,
          created_at: event.created_at, groupId: group.id,
          replyTo: replyTag?.[1],
        })
      },
    })

    // Kind 39000/39001/39002 — live metadata updates
    const metaSub = pool.subscribe([group.relay], {
      kinds: [39000, 39001, 39002],
      '#d': [group.id],
    }, {
      onevent(event) {
        if (event.kind === 39000) {
          const meta = nip29.parseGroupMetadata(event)
          groups.value = groups.value.map(g =>
            g.id === group.id && g.relay === group.relay
              ? { ...g, name: meta.name || g.name, about: meta.about || g.about, picture: meta.picture || g.picture, isOpen: meta.isOpen, isPublic: meta.isPublic }
              : g
          )
          persistMeta()
        }
      },
    })

    subscriptions.push(chatSub, metaSub)
  }

  function subscribeChannel(group) {
    const pool = getPool()
    const key = gkey(group)
    const since = getGroupSince(key)
    const relays = group.relay ? [group.relay] : getChatRelaysSync()

    // Kind 42 — channel messages
    const sub = pool.subscribe(relays, {
      kinds: [42],
      '#e': [group.id],
      since,
    }, {
      oneose: onGroupEose,
      onevent(event) {
        const parsed = nip28.parseChannelMessage(event)
        if (parsed.channelId !== group.id) return
        addMessage(key, {
          id: event.id, sender: event.pubkey, content: parsed.content,
          created_at: event.created_at, groupId: group.id,
          replyTo: parsed.replyTo,
        })
      },
    })
    subscriptions.push(sub)
  }

  // ── Subscribe all ──

  async function subscribe() {
    const account = await getActiveAccount()
    if (!account?.pubkey) return

    closeSubscriptions()

    // Create a new sync token scoped to THIS subscription cycle
    const syncToken = { complete: false }
    currentGroupSyncToken = syncToken
    let eoseCount = 0
    const eoseExpected = (groups.value.length || 0) + 1 // 1 per group chat sub + 1 invitation sub
    onGroupEose = () => {
      eoseCount++
      if (eoseCount >= eoseExpected) syncToken.complete = true
    }

    for (const group of groups.value) {
      if (group.type === 'private') subscribePrivateGroup(group)
      else if (group.type === 'relay') subscribeRelayGroup(group)
      else if (group.type === 'channel') subscribeChannel(group)
    }

    // Subscribe for NIP-29 invitations (kind 9000 add-user addressed to us)
    const pool = getPool()
    const chatRelays = await getPoolRelays(account.pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
    const invSub = pool.subscribe(chatRelays, {
      kinds: [9000],
      '#p': [account.pubkey],
      since: Math.floor(Date.now() / 1000) - 86400 * 30,
    }, {
      oneose: onGroupEose,
      onevent(event) {
        const hTag = event.tags.find(t => t[0] === 'h')
        if (!hTag) return
        // Infer relay from chat relays (best effort)
        addInvitation(hTag[1], chatRelays[0] || '', event.pubkey, 'relay')
      },
    })
    subscriptions.push(invSub)
  }

  // ── Helpers ──

  function getGroupSince(key) {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 86400 * 30
    const latest = Math.max(groupLatestTs[key] || 0, thirtyDaysAgo)
    return Math.max(latest - 3600, thirtyDaysAgo)
  }

  let _cachedAccount = null
  let _cachedChatRelays = null

  function getActiveAccountSync() {
    return _cachedAccount
  }

  function getChatRelaysSync() {
    return _cachedChatRelays || DEFAULT_CHAT_RELAYS
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
      error.value = null
      const account = await getActiveAccount()
      const pubkey = account?.pubkey || null

      if (initialized.value && pubkey === currentAccountPubkey.value) return

      cleanup()
      currentAccountPubkey.value = pubkey
      _cachedAccount = account
      initialized.value = false

      if (!pubkey) {
        groups.value = []; messages.value = {}; lastRead.value = {}; invitations.value = []
        initialized.value = true
        return
      }

      _cachedChatRelays = await getPoolRelays(pubkey, 'chat').catch(() => DEFAULT_CHAT_RELAYS)
      await loadData()
      await subscribe()
    } catch (err) {
      console.warn('[groups] init failed:', err)
      error.value = 'group.initFailed'
    } finally {
      initialized.value = true
    }
  }

  async function switchAccount() {
    initialized.value = false
    currentAccountPubkey.value = null
    _cachedAccount = null
    _cachedChatRelays = null
    cleanup()
    groups.value = []; messages.value = {}; lastRead.value = {}; invitations.value = []
    await init()
  }

  function cleanup() {
    currentGroupSyncToken = { complete: false }
    onGroupEose = () => {}
    // Clear performance caches
    for (const k of Object.keys(groupIdSets)) delete groupIdSets[k]
    for (const k of Object.keys(groupLatestTs)) delete groupLatestTs[k]
    for (const k of Object.keys(privateGroupSubs)) delete privateGroupSubs[k]
    dirtyGroupKeys.clear()
    dirtyMeta = false
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
    closeSubscriptions()
  }

  return {
    // State
    groups,
    invitations,
    groupConversations,
    unreadGroupTotal,
    initialized,
    error,
    currentAccountPubkey,
    // Lifecycle
    init,
    switchAccount,
    cleanup,
    // Messaging
    sendGroupMessage,
    retryMessage,
    getMessages,
    markRead,
    // Group management
    createPrivateGroup,
    addMemberToPrivateGroup,
    removeMemberFromPrivateGroup,
    joinRelayGroup,
    joinChannel,
    createChannel,
    leaveGroup,
    fetchRelayGroupInfo,
    adminAction,
    inviteUser,
    updateChannelMetadata,
    deleteGroupMessage,
    hideChannelMessage,
    // Invitations
    acceptInvitation,
    declineInvitation,
    // Helpers
    gkey,
  }
}
