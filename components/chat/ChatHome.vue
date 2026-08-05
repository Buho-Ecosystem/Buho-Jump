<script setup>
/**
 * Chat home — direct-message conversation list with search and a new-chat FAB.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { useOnline } from '../../composables/useOnline.js'
import { useRelayHealth } from '../../composables/useRelayHealth.js'
import ConversationItem from './ConversationItem.vue'
import ErrorBanner from '../ErrorBanner.vue'
import { MessageSquare, PenSquare, Search, ChevronDown, VolumeX } from 'lucide-vue-next'

const { t } = useI18n()
const emit = defineEmits(['open', 'new-chat'])

const { conversations, messages: allMessages, init: initChat, initialized, error: connectionError, currentAccountPubkey } = useChat()
const { getCachedProfile, fetchProfiles } = useContacts()
const { online } = useOnline()
const { healthy: relayHealthy, refresh: refreshRelays } = useRelayHealth()
const { isMuted, load: loadMuteList } = useMuteList()

const dismissRelayWarning = ref(false)
const search = ref('')
const showMuted = ref(false)

// DM conversation list (muted filtered out), searchable, newest first
const visibleConversations = computed(() => {
  const q = search.value.toLowerCase()
  let dms = conversations.value.filter(c => !isMuted(c.pubkey))
  if (q) {
    dms = dms.filter(c => {
      const profile = getCachedProfile(c.pubkey)
      const name = profile?.display_name || profile?.name || ''
      const identity = profile?.nip05 || ''
      if (name.toLowerCase().includes(q) || identity.toLowerCase().includes(q) || c.pubkey.includes(q)) return true
      const msgs = allMessages.value[c.pubkey]
      if (msgs) return msgs.some(m => m.content?.toLowerCase().includes(q))
      return false
    })
  }
  return [...dms].sort((a, b) => (b.lastMessage?.created_at || 0) - (a.lastMessage?.created_at || 0))
})

const mutedConversations = computed(() => conversations.value.filter(c => isMuted(c.pubkey)))
const hasAnyContent = computed(() => visibleConversations.value.length > 0 || mutedConversations.value.length > 0)

onMounted(async () => {
  await initChat()
  if (currentAccountPubkey.value) await loadMuteList(currentAccountPubkey.value)
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
        <ConversationItem
          v-for="conv in visibleConversations"
          :key="conv.pubkey"
          :pubkey="conv.pubkey"
          :last-message="conv.lastMessage"
          :unread="conv.unread"
          @click="emit('open', conv.pubkey)"
        />
      </div>

      <!-- Muted conversations -->
      <div v-if="mutedConversations.length > 0" class="mt-1">
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
      <img src="/Onboarding%20wizard/storyset-online-friends-bro.svg" alt="" class="w-36 h-28 object-contain -mb-2" />
      <div>
        <p class="text-sm font-semibold">{{ t('chat.emptyTitle') }}</p>
        <p class="text-xs text-text-muted mt-1 leading-relaxed">{{ t('chat.emptyDesc') }}</p>
      </div>
      <button @click="emit('new-chat')"
        class="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-brand text-surface-base text-xs font-semibold hover:bg-brand-hover transition-all btn-primary">
        <PenSquare class="w-3.5 h-3.5" />
        {{ t('chat.startChat') }}
      </button>
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
