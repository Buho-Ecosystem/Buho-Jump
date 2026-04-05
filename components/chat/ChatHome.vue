<script setup>
/**
 * Unified chat home — DMs + Groups in one list with filter tabs,
 * invitation banner, and floating action button.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { useOnline } from '../../composables/useOnline.js'
import { useRelayHealth } from '../../composables/useRelayHealth.js'
import ConversationItem from './ConversationItem.vue'
import GroupConversationItem from './GroupConversationItem.vue'
import GroupInvitationBanner from './GroupInvitationBanner.vue'
import ErrorBanner from '../ErrorBanner.vue'
import { MessageSquare, PenSquare, Search, ChevronDown, VolumeX, Users } from 'lucide-vue-next'

const { t } = useI18n()
const emit = defineEmits(['open', 'open-group', 'new-chat', 'new-group'])

const { conversations, messages: allMessages, init: initChat, initialized: chatInitialized, error: chatError, currentAccountPubkey } = useChat()
const { groupConversations, init: initGroups, initialized: groupsInitialized, error: groupError } = useGroups()
const { getCachedProfile, fetchProfiles } = useContacts()
const { online } = useOnline()
const { healthy: relayHealthy, refresh: refreshRelays } = useRelayHealth()

const connectionError = computed(() => chatError.value || groupError.value)
const { isMuted, isGroupMuted, load: loadMuteList } = useMuteList()
const dismissRelayWarning = ref(false)

const search = ref('')
const showMuted = ref(false)
const filter = ref('all') // 'all' | 'dms' | 'groups'

const initialized = computed(() => chatInitialized.value && groupsInitialized.value)

// Unified conversation list: DMs + Groups merged and sorted by recency
const unified = computed(() => {
  const q = search.value.toLowerCase()

  // DMs
  let dms = conversations.value
    .filter(c => !isMuted(c.pubkey))
    .map(c => ({ ...c, type: 'dm' }))

  // Groups (filter out muted)
  let grps = groupConversations.value
    .filter(c => !isGroupMuted(c.groupKey))
    .map(c => ({ ...c, type: 'group' }))

  // Search filter
  if (q) {
    dms = dms.filter(c => {
      const profile = getCachedProfile(c.pubkey)
      const name = profile?.display_name || profile?.name || ''
      const identity = profile?.nip05 || ''
      if (name.toLowerCase().includes(q) ||
        identity.toLowerCase().includes(q) ||
        c.pubkey.includes(q)) return true
      // Deep search: check all messages in this conversation
      const msgs = allMessages.value[c.pubkey]
      if (msgs) return msgs.some(m => m.content?.toLowerCase().includes(q))
      return false
    })
    grps = grps.filter(c => {
      const name = c.group?.name || c.group?.id || ''
      return name.toLowerCase().includes(q) ||
        c.lastMessage?.content?.toLowerCase().includes(q)
    })
  }

  // Tab filter
  if (filter.value === 'dms') return dms.sort(byRecency)
  if (filter.value === 'groups') return grps.sort(byRecency)
  return [...dms, ...grps].sort(byRecency)
})

const mutedConversations = computed(() =>
  conversations.value.filter(c => isMuted(c.pubkey))
)

const hasAnyContent = computed(() =>
  unified.value.length > 0 || mutedConversations.value.length > 0
)

const dmCount = computed(() => conversations.value.filter(c => !isMuted(c.pubkey)).length)
const groupCount = computed(() => groupConversations.value.filter(c => !isGroupMuted(c.groupKey)).length)

const mutedGroupConversations = computed(() =>
  groupConversations.value.filter(c => isGroupMuted(c.groupKey))
)

function tabLabel(f) {
  const label = t(`chat.filter${f[0].toUpperCase() + f.slice(1)}`)
  if (f === 'dms' && dmCount.value > 0) return `${label} (${dmCount.value})`
  if (f === 'groups' && groupCount.value > 0) return `${label} (${groupCount.value})`
  return label
}

function byRecency(a, b) {
  const aTs = a.lastMessage?.created_at || a.group?.joinedAt || 0
  const bTs = b.lastMessage?.created_at || b.group?.joinedAt || 0
  return bTs - aTs
}

onMounted(async () => {
  await Promise.all([initChat(), initGroups()])
  if (currentAccountPubkey.value) {
    await loadMuteList(currentAccountPubkey.value)
  }
  // Batch-fetch profiles for DM participants
  const pubkeys = conversations.value.map(c => c.pubkey).filter(pk => !getCachedProfile(pk))
  if (pubkeys.length > 0) fetchProfiles(pubkeys)
})
</script>

<template>
  <div class="relative h-full">
    <!-- Search bar -->
    <div class="px-3 pb-2">
      <div class="relative">
        <Search class="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          v-model="search"
          :placeholder="t('chat.searchPlaceholder')"
          class="chat-input-pill w-full pl-10 pr-4"
        />
      </div>
    </div>

    <!-- Filter tabs -->
    <div class="flex items-center gap-1 px-3 pb-2">
      <button
        v-for="f in ['all', 'dms', 'groups']"
        :key="f"
        @click="filter = f"
        class="px-3 py-1 rounded-full text-[11px] font-semibold transition-all duration-200"
        :class="filter === f
          ? 'bg-brand/10 text-brand'
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-elevated'"
      >
        {{ tabLabel(f) }}
      </button>
    </div>

    <!-- Invitation banner -->
    <GroupInvitationBanner />

    <!-- Offline / relay health / init error banners -->
    <ErrorBanner v-if="!online" type="warning" :message="t('common.offline')" class="mx-3 mb-2" />
    <ErrorBanner
      v-else-if="!relayHealthy && initialized && !dismissRelayWarning"
      type="warning"
      :message="t('chat.relaysDown')"
      :retry-label="t('common.retry')"
      @retry="refreshRelays"
      dismissable
      @dismiss="dismissRelayWarning = true"
      class="mx-3 mb-2"
    />
    <ErrorBanner v-else-if="connectionError" type="error" :message="t(connectionError)" class="mx-3 mb-2" />

    <!-- Loading skeleton -->
    <div v-if="!initialized" class="px-3 space-y-1">
      <div v-for="i in 5" :key="i" class="flex items-center gap-3 py-2.5">
        <div class="w-[48px] h-[48px] rounded-full skeleton-shimmer shrink-0" />
        <div class="flex-1 space-y-2">
          <div class="skeleton-shimmer h-3.5 rounded w-28" />
          <div class="skeleton-shimmer h-3 rounded w-44" />
        </div>
      </div>
    </div>

    <!-- Conversation list -->
    <div v-else-if="hasAnyContent" class="pb-16">
      <div class="divide-y divide-border/30">
        <template v-for="conv in unified" :key="conv.type === 'dm' ? conv.pubkey : conv.groupKey">
          <ConversationItem
            v-if="conv.type === 'dm'"
            :pubkey="conv.pubkey"
            :last-message="conv.lastMessage"
            :unread="conv.unread"
            @click="emit('open', conv.pubkey)"
          />
          <GroupConversationItem
            v-else
            :group="conv.group"
            :last-message="conv.lastMessage"
            :unread="conv.unread"
            @click="emit('open-group', conv.groupKey)"
          />
        </template>
      </div>

      <!-- Muted conversations (DMs only) -->
      <div v-if="mutedConversations.length > 0 && filter !== 'groups'" class="mt-1">
        <button @click="showMuted = !showMuted"
          class="w-full flex items-center gap-2 px-4 py-2 text-[10px] text-text-muted font-semibold uppercase tracking-wider hover:text-text-secondary transition-colors">
          <VolumeX class="w-3 h-3" />
          {{ t('chat.mutedSection', { count: mutedConversations.length }) }}
          <ChevronDown class="w-3 h-3 ml-auto transition-transform duration-200" :class="showMuted ? 'rotate-180' : ''" />
        </button>
        <div v-if="showMuted" class="divide-y divide-border/30 opacity-50">
          <ConversationItem
            v-for="conv in mutedConversations"
            :key="conv.pubkey"
            :pubkey="conv.pubkey"
            :last-message="conv.lastMessage"
            :unread="0"
            @click="emit('open', conv.pubkey)"
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center py-12 text-center space-y-4 px-6">
      <div class="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center">
        <MessageSquare class="w-7 h-7 text-brand" />
      </div>
      <div>
        <p class="text-sm font-semibold">{{ t('chat.emptyTitle') }}</p>
        <p class="text-xs text-text-muted mt-1 leading-relaxed">{{ t('chat.emptyDesc') }}</p>
      </div>
      <div class="flex gap-2">
        <button @click="emit('new-chat')"
          class="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-brand text-surface-base text-xs font-semibold hover:bg-brand-hover transition-all btn-primary">
          <PenSquare class="w-3.5 h-3.5" />
          {{ t('chat.startChat') }}
        </button>
        <button @click="emit('new-group')"
          class="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-surface-card border border-border text-xs font-semibold text-text-secondary hover:border-brand/20 hover:text-brand transition-all">
          <Users class="w-3.5 h-3.5" />
          {{ t('group.joinGroup') }}
        </button>
      </div>
    </div>

    <!-- FAB -->
    <button
      @click="emit('new-chat')"
      class="chat-fab absolute bottom-4 right-4 z-10"
      :title="t('chat.newChat')"
      :aria-label="t('chat.newChat')"
    >
      <PenSquare class="w-5 h-5" />
    </button>
  </div>
</template>
