<script setup>
/**
 * Telegram-style chat home — conversation list with pill search bar
 * and floating action button for new chat.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import ConversationItem from './ConversationItem.vue'
import { MessageSquare, PenSquare, Search, Loader2, ChevronDown, VolumeX } from 'lucide-vue-next'

const { t } = useI18n()
const emit = defineEmits(['open', 'new-chat'])

const { conversations, init, initialized, currentAccountPubkey } = useChat()
const { getCachedProfile } = useContacts()
const { isMuted, load: loadMuteList } = useMuteList()
const search = ref('')
const showMuted = ref(false)

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  const list = q
    ? conversations.value.filter(c => {
        const profile = getCachedProfile(c.pubkey)
        const name = profile?.display_name || profile?.name || ''
        const identity = profile?.nip05 || ''
        // Search by name, identity, pubkey, or message content
        if (name.toLowerCase().includes(q) ||
          identity.toLowerCase().includes(q) ||
          c.pubkey.includes(q)) return true
        // Search message content within conversation
        if (c.lastMessage?.content?.toLowerCase().includes(q)) return true
        return false
      })
    : conversations.value
  return list.filter(c => !isMuted(c.pubkey))
})

const mutedConversations = computed(() =>
  conversations.value.filter(c => isMuted(c.pubkey))
)

onMounted(async () => {
  await init()
  if (currentAccountPubkey.value) {
    await loadMuteList(currentAccountPubkey.value)
  }
})
</script>

<template>
  <div class="relative h-full">
    <!-- Search bar (Telegram pill style) -->
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
    <div v-else-if="filtered.length > 0 || mutedConversations.length > 0" class="pb-16">
      <div class="divide-y divide-border/30">
        <ConversationItem
          v-for="conv in filtered"
          :key="conv.pubkey"
          :pubkey="conv.pubkey"
          :last-message="conv.lastMessage"
          :unread="conv.unread"
          @click="emit('open', conv.pubkey)"
        />
      </div>

      <!-- Muted conversations (collapsible) -->
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
    <div v-else class="flex flex-col items-center justify-center py-16 text-center space-y-3">
      <div class="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center">
        <MessageSquare class="w-7 h-7 text-brand" />
      </div>
      <div>
        <p class="text-sm font-semibold">{{ t('chat.emptyTitle') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('chat.emptyDesc') }}</p>
      </div>
    </div>

    <!-- FAB (Telegram-style floating action button) -->
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
