<script setup>
/**
 * Chat home — conversation list with search and new chat button.
 * Empty state when no conversations exist.
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
  <div class="animate-fade-in-up">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-semibold">{{ t('chat.title') }}</span>
      <button
        @click="emit('new-chat')"
        class="p-1.5 rounded-lg hover:bg-surface-elevated transition-colors"
        :title="t('chat.newChat')"
        aria-label="New chat"
      >
        <PenSquare class="w-4 h-4 text-text-muted" />
      </button>
    </div>

    <!-- Search -->
    <div v-if="conversations.length > 3" class="relative mb-3">
      <Search class="w-3 h-3 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        v-model="search"
        :placeholder="t('chat.searchPlaceholder')"
        class="w-full bg-surface-base border border-border rounded-lg pl-8 pr-3 py-2 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted"
      />
    </div>

    <!-- Loading -->
    <div v-if="!initialized" class="space-y-2">
      <div v-for="i in 4" :key="i" class="skeleton-shimmer h-14 rounded-xl" />
    </div>

    <!-- Conversation list -->
    <div v-else-if="filtered.length > 0" class="space-y-0.5">
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
    <div v-else class="flex flex-col items-center justify-center py-12 text-center space-y-3">
      <div class="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center">
        <MessageSquare class="w-6 h-6 text-brand" />
      </div>
      <div>
        <p class="text-sm font-semibold">{{ t('chat.emptyTitle') }}</p>
        <p class="text-[10px] text-text-muted mt-0.5">{{ t('chat.emptyDesc') }}</p>
      </div>
      <button
        @click="emit('new-chat')"
        class="px-4 py-2 text-xs rounded-xl bg-brand text-surface-base hover:bg-brand-hover transition-colors font-semibold btn-primary"
      >
        {{ t('chat.startChat') }}
      </button>
    </div>
  </div>
</template>
