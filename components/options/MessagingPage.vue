<script setup>
/**
 * Options page — Messaging management.
 * Three tabs: Conversations (DMs), Groups, Contacts.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { useToast } from '../../composables/useToast.js'
import { nip19 } from 'nostr-core'
import { formatTimestamp } from '../../lib/utils.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import BottomSheet from '../BottomSheet.vue'
import {
  MessageSquare, Users, UserCircle, Search,
  Zap, Globe, Shield, LogOut, Plus, Link,
  AlertTriangle, Loader2, ChevronRight,
} from 'lucide-vue-next'

const PAGE_SIZE = 20

const { t } = useI18n()
const { conversations, init: initChat, initialized: chatInit } = useChat()
const { groups, groupConversations, init: initGroups, initialized: groupsInit, joinRelayGroup, leaveGroup } = useGroups()
const { contacts, loading: contactsLoading, loadFollowList, getCachedProfile, fetchProfiles } = useContacts()
const { activeAccount } = useAccounts()
const { isMuted } = useMuteList()
const toast = useToast()

const tab = ref('conversations') // 'conversations' | 'groups' | 'contacts'
const search = ref('')
const initializing = ref(true)
const visibleCount = ref(PAGE_SIZE)

watch([tab, search], () => { visibleCount.value = PAGE_SIZE })

// Group join form
const showJoinForm = ref(false)
const joinRelay = ref('')
const joinGroupId = ref('')
const joining = ref(false)

// Leave confirmation
const leavingGroup = ref(null)
const leaveLoading = ref(false)

onMounted(async () => {
  try {
    await Promise.all([initChat(), initGroups()])
    if (activeAccount.value?.pubkey) {
      await loadFollowList(activeAccount.value.pubkey)
    }
    // Batch fetch profiles for conversations
    const pubkeys = conversations.value.map(c => c.pubkey).filter(pk => !getCachedProfile(pk))
    if (pubkeys.length > 0) fetchProfiles(pubkeys)
  } finally {
    initializing.value = false
  }
})

// ── Conversations tab ──
const filteredConversations = computed(() => {
  const q = search.value.toLowerCase()
  let list = conversations.value
  if (q) {
    list = list.filter(c => {
      const p = getCachedProfile(c.pubkey)
      const name = p?.display_name || p?.name || ''
      return name.toLowerCase().includes(q) || c.pubkey.includes(q)
    })
  }
  return list.filter(c => !isMuted(c.pubkey))
})

// ── Groups tab ──
const filteredGroups = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return groups.value
  return groups.value.filter(g =>
    (g.name || g.id).toLowerCase().includes(q)
  )
})

// ── Contacts tab ──
const filteredContacts = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return contacts.value
  return contacts.value.filter(c => {
    const name = c.profile?.display_name || c.profile?.name || ''
    const identity = c.profile?.nip05 || ''
    return name.toLowerCase().includes(q) || identity.toLowerCase().includes(q) || c.npub.includes(q)
  })
})

// Paginated contacts
const paginatedContacts = computed(() => filteredContacts.value.slice(0, visibleCount.value))
const hasMoreContacts = computed(() => visibleCount.value < filteredContacts.value.length)

function showMoreContacts() { visibleCount.value += PAGE_SIZE }

function profileName(pubkey) {
  const p = getCachedProfile(pubkey)
  return p?.display_name || p?.name || truncateNpub(pubkey)
}

function truncateNpub(pubkey) {
  try {
    const npub = nip19.npubEncode(pubkey)
    return npub.slice(0, 12) + '...' + npub.slice(-6)
  } catch { return pubkey.slice(0, 12) + '...' }
}

async function handleJoinGroup() {
  if (!joinRelay.value.trim() || !joinGroupId.value.trim()) return
  joining.value = true
  try {
    await joinRelayGroup(joinGroupId.value.trim(), joinRelay.value.trim())
    toast.success(t('group.accepted'))
    showJoinForm.value = false
    joinRelay.value = ''
    joinGroupId.value = ''
  } catch (err) {
    toast.error(err.message || t('group.joinFailed'))
  } finally {
    joining.value = false
  }
}

async function handleLeaveGroup() {
  if (!leavingGroup.value) return
  leaveLoading.value = true
  try {
    await leaveGroup(leavingGroup.value.id, leavingGroup.value.type, leavingGroup.value.relay)
    toast.info(t('group.leaveGroup'))
  } catch {
    toast.error(t('group.leaveFailed'))
  } finally {
    leaveLoading.value = false
    leavingGroup.value = null
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <!-- Header -->
    <div>
      <h1 class="text-lg font-extrabold">{{ t('options.messaging') }}</h1>
      <p class="text-xs text-text-muted mt-0.5">{{ t('options.messagingDesc') }}</p>
    </div>

    <!-- Tab bar -->
    <div class="flex bg-surface-card rounded-2xl border border-border p-0.5">
      <button v-for="tb in ['conversations', 'groups', 'contacts']" :key="tb"
        @click="tab = tb; search = ''"
        class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200"
        :class="tab === tb ? 'bg-brand text-surface-base' : 'text-text-muted hover:text-text-secondary'">
        <MessageSquare v-if="tb === 'conversations'" class="w-3.5 h-3.5" />
        <Users v-else-if="tb === 'groups'" class="w-3.5 h-3.5" />
        <UserCircle v-else class="w-3.5 h-3.5" />
        {{ tb === 'conversations' ? t('chat.filterDms') : tb === 'groups' ? t('group.title') : t('chat.contacts') }}
      </button>
    </div>

    <!-- Search -->
    <div class="relative">
      <Search class="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input v-model="search" :placeholder="t('chat.searchPlaceholder')"
        class="w-full bg-surface-card border border-border rounded-2xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
    </div>

    <!-- Loading -->
    <div v-if="initializing" class="space-y-2">
      <div v-for="i in 5" :key="i" class="skeleton-shimmer h-14 rounded-3xl" />
    </div>

    <!-- ═══ CONVERSATIONS TAB ═══ -->
    <template v-else-if="tab === 'conversations'">
      <div v-if="filteredConversations.length > 0" class="space-y-1">
        <div v-for="conv in filteredConversations" :key="conv.pubkey"
          class="flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
          <div class="w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :style="{ background: getCachedProfile(conv.pubkey)?.picture ? '' : getAvatarColor(conv.pubkey) }">
            <img v-if="getCachedProfile(conv.pubkey)?.picture" :src="getCachedProfile(conv.pubkey).picture" alt="" class="w-full h-full object-cover" />
            <span v-else class="text-sm font-semibold text-white">{{ profileName(conv.pubkey)[0].toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ profileName(conv.pubkey) }}</div>
            <div class="text-[11px] text-text-muted truncate">{{ conv.lastMessage?.content || '' }}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-[10px] text-text-muted">{{ conv.lastMessage ? formatTimestamp(conv.lastMessage.created_at, t) : '' }}</div>
            <span v-if="conv.unread > 0" class="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-brand text-surface-base font-semibold">
              {{ conv.unread > 99 ? '99+' : conv.unread }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="bg-surface-card rounded-3xl border border-border p-8 text-center">
        <MessageSquare class="w-6 h-6 text-text-muted mx-auto mb-2" />
        <p class="text-xs text-text-muted">{{ t('chat.emptyTitle') }}</p>
      </div>
    </template>

    <!-- ═══ GROUPS TAB ═══ -->
    <template v-else-if="tab === 'groups'">
      <!-- Actions -->
      <div class="flex gap-2">
        <button @click="showJoinForm = !showJoinForm"
          class="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-brand text-surface-base text-xs font-semibold hover:bg-brand-hover transition-all btn-primary">
          <Link class="w-3.5 h-3.5" />
          {{ t('group.joinGroup') }}
        </button>
      </div>

      <!-- Join form -->
      <div v-if="showJoinForm" class="bg-surface-card rounded-3xl border border-border shadow-sm p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold">{{ t('group.joinExisting') }}</span>
          <button @click="showJoinForm = false; joinRelay = ''; joinGroupId = ''"
            class="text-[10px] text-text-muted hover:text-text-secondary transition-colors">{{ t('common.cancel') }}</button>
        </div>
        <div class="space-y-1">
          <input v-model="joinRelay" :placeholder="t('group.serverPlaceholder')"
            class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted"
            :class="joinRelay.trim() && !joinRelay.trim().startsWith('wss://') ? 'border-error' : ''" />
          <p v-if="joinRelay.trim() && !joinRelay.trim().startsWith('wss://')" class="text-[9px] text-error px-1">{{ t('group.invalidRelay') }}</p>
        </div>
        <input v-model="joinGroupId" :placeholder="t('group.groupName')"
          class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
        <button @click="handleJoinGroup" :disabled="!joinRelay.trim() || !joinGroupId.trim() || joining || !joinRelay.trim().startsWith('wss://')"
          class="w-full py-2.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary flex items-center justify-center gap-1.5">
          <Loader2 v-if="joining" class="w-3.5 h-3.5 animate-spin" />
          {{ joining ? t('group.joining') : t('group.joinGroup') }}
        </button>
      </div>

      <!-- Group list -->
      <div v-if="filteredGroups.length > 0" class="space-y-1">
        <div v-for="g in filteredGroups" :key="`${g.id}:${g.relay}`"
          class="flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm group">
          <div class="w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :style="!g.picture ? { background: getAvatarColor(g.id) } : {}">
            <img v-if="g.picture" :src="g.picture" alt="" class="w-full h-full object-cover" />
            <Users v-else class="w-4 h-4 text-white" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ g.name || g.id }}</div>
            <div class="flex items-center gap-2 text-[10px] text-text-muted">
              <span v-if="g.about" class="truncate">{{ g.about }}</span>
              <span v-if="g.isOpen !== undefined" class="px-1.5 py-0.5 rounded-full bg-surface-elevated font-medium shrink-0">
                {{ g.isOpen ? t('group.openGroup') : t('group.closedGroup') }}
              </span>
            </div>
          </div>
          <button @click="leavingGroup = g"
            class="p-2 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all"
            :title="t('group.leaveGroup')">
            <LogOut class="w-3.5 h-3.5 text-text-muted hover:text-error" />
          </button>
        </div>
      </div>
      <div v-else-if="!showJoinForm" class="bg-surface-card rounded-3xl border border-border p-8 text-center">
        <Users class="w-6 h-6 text-text-muted mx-auto mb-2" />
        <p class="text-sm font-semibold mb-1">{{ t('group.noGroups') }}</p>
        <p class="text-xs text-text-muted">{{ t('group.noGroupsDesc') }}</p>
      </div>
    </template>

    <!-- ═══ CONTACTS TAB ═══ -->
    <template v-else-if="tab === 'contacts'">
      <div v-if="contactsLoading" class="space-y-2">
        <div v-for="i in 5" :key="i" class="skeleton-shimmer h-14 rounded-3xl" />
      </div>
      <div v-else-if="filteredContacts.length > 0" class="space-y-1">
        <div v-for="c in paginatedContacts" :key="c.pubkey"
          class="flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
          <div class="w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :style="!c.profile?.picture ? { background: getAvatarColor(c.pubkey) } : {}">
            <img v-if="c.profile?.picture" :src="c.profile.picture" alt="" class="w-full h-full object-cover" />
            <span v-else class="text-sm font-semibold text-white">{{ ((c.profile?.name || '?')[0]).toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ c.profile?.display_name || c.profile?.name || truncateNpub(c.pubkey) }}</div>
            <div v-if="c.profile?.nip05" class="text-[11px] text-brand truncate">{{ c.profile.nip05 }}</div>
            <div v-else class="text-[11px] text-text-muted truncate">{{ truncateNpub(c.pubkey) }}</div>
          </div>
        </div>
        <!-- Show more -->
        <button v-if="hasMoreContacts" @click="showMoreContacts"
          class="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-text-muted hover:text-brand font-semibold transition-all duration-200">
          <span>{{ t('common.showMore') }}</span>
          <span class="text-[10px] opacity-60">({{ t('common.showingOf', { shown: paginatedContacts.length, total: filteredContacts.length }) }})</span>
          <ChevronRight class="w-3 h-3" />
        </button>
      </div>
      <div v-else class="bg-surface-card rounded-3xl border border-border p-8 text-center">
        <UserCircle class="w-6 h-6 text-text-muted mx-auto mb-2" />
        <p class="text-xs text-text-muted">{{ t('chat.noContacts') }}</p>
      </div>
    </template>

    <!-- Leave group confirmation -->
    <BottomSheet :open="!!leavingGroup" variant="danger" @close="leavingGroup = null">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #title>{{ t('group.leaveConfirm') }}</template>
      <template #description>
        <span v-if="leavingGroup" class="font-semibold">{{ leavingGroup.name || leavingGroup.id }}</span>
        <br />{{ t('group.leaveConfirmDesc') }}
      </template>
      <template #actions>
        <button @click="leavingGroup = null"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleLeaveGroup" :disabled="leaveLoading"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="leaveLoading" class="w-3 h-3 animate-spin" />
          {{ t('group.leaveGroup') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
