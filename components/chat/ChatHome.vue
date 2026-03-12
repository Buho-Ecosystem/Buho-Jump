<script setup>
/**
 * Telegram-style chat home — conversation list with pill search bar
 * and floating action button for new chat.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import ConversationItem from './ConversationItem.vue'
import { MessageSquare, PenSquare, Search, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const emit = defineEmits(['open', 'new-chat'])

const { conversations, init, initialized } = useChat()
const { getCachedProfile } = useContacts()
const search = ref('')

const filtered = computed(() => {
  if (!search.value) return conversations.value
  const q = search.value.toLowerCase()
  return conversations.value.filter(c => {
    const profile = getCachedProfile(c.pubkey)
    const name = profile?.display_name || profile?.name || ''
    const nip05 = profile?.nip05 || ''
    return name.toLowerCase().includes(q) ||
      nip05.toLowerCase().includes(q) ||
      c.pubkey.includes(q)
  })
})

onMounted(() => init())
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
    <div v-else-if="filtered.length > 0" class="divide-y divide-border/30 pb-16">
      <ConversationItem
        v-for="conv in filtered"
        :key="conv.pubkey"
        :pubkey="conv.pubkey"
        :last-message="conv.lastMessage"
        :unread="conv.unread"
        @click="emit('open', conv.pubkey)"
      />
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
      aria-label="New chat"
    >
      <PenSquare class="w-5 h-5" />
    </button>
  </div>
</template>
