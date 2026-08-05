<script setup>
/**
 * Options page — Messaging management.
 * Two tabs: Conversations (DMs) and Contacts.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { nip19 } from 'nostr-core'
import { formatTimestamp } from '../../lib/utils.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import {
  MessageSquare, UserCircle, Search, ChevronRight,
} from 'lucide-vue-next'

const PAGE_SIZE = 20

const { t } = useI18n()
const { conversations, init: initChat, initialized: chatInit } = useChat()
const { contacts, loading: contactsLoading, loadFollowList, getCachedProfile, fetchProfiles } = useContacts()
const { activeAccount } = useAccounts()
const { isMuted } = useMuteList()

const tab = ref('conversations') // 'conversations' | 'contacts'
const search = ref('')
const initializing = ref(true)
const visibleCount = ref(PAGE_SIZE)

watch([tab, search], () => { visibleCount.value = PAGE_SIZE })

onMounted(async () => {
  try {
    await initChat()
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
    return 'User ' + npub.slice(5, 9) + '...' + npub.slice(-4)
  } catch { return 'User ' + pubkey.slice(0, 6) + '...' }
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
      <button v-for="tb in ['conversations', 'contacts']" :key="tb"
        @click="tab = tb; search = ''"
        class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200"
        :class="tab === tb ? 'bg-brand text-surface-base' : 'text-text-muted hover:text-text-secondary'">
        <MessageSquare v-if="tb === 'conversations'" class="w-3.5 h-3.5" />
        <UserCircle v-else class="w-3.5 h-3.5" />
        {{ tb === 'conversations' ? t('chat.filterDms') : t('chat.contacts') }}
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
        <img src="/Onboarding%20wizard/storyset-online-friends-bro.svg" alt="" class="w-40 h-28 object-contain mx-auto -mt-3 mb-1" />
        <p class="text-xs text-text-muted">{{ t('chat.emptyTitle') }}</p>
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
  </div>
</template>
