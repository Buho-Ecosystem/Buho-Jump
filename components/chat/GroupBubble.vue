<script setup>
/**
 * Group message bubble — sender name/avatar for first-in-group,
 * reply context, reactions, deletion, and long-press action menu.
 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import MessageActions from './MessageActions.vue'
import { Loader2, AlertCircle, Check, CornerDownRight, AlertTriangle } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  message: { type: Object, required: true },
  isMe: { type: Boolean, default: false },
  isFirstInGroup: { type: Boolean, default: true },
  isLastInGroup: { type: Boolean, default: true },
  replyContent: { type: String, default: '' },
  replySenderName: { type: String, default: '' },
  reactions: { type: Array, default: () => [] },
  deleted: { type: Boolean, default: false },
})

const emit = defineEmits(['retry', 'reply', 'react', 'delete', 'forward'])

const { getCachedProfile } = useContacts()

const senderProfile = computed(() => getCachedProfile(props.message.sender))
const senderName = computed(() =>
  senderProfile.value?.display_name || senderProfile.value?.name || props.message.sender?.slice(0, 8) + '...'
)
const senderColor = computed(() => getAvatarColor(props.message.sender))

const isFailed = computed(() => props.message.status === 'failed')
const isSending = computed(() => props.message.status === 'sending')

const timeStr = computed(() => {
  const d = new Date(props.message.created_at * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// Long-press action menu
const showActions = ref(false)
let pressTimer = null

function onPointerDown() {
  pressTimer = setTimeout(() => { showActions.value = true }, 500)
}
function onPointerUp() { clearTimeout(pressTimer) }
function onPointerLeave() { clearTimeout(pressTimer) }

onBeforeUnmount(() => clearTimeout(pressTimer))

// Grouped reactions for display
const groupedReactions = computed(() => {
  if (!props.reactions.length) return []
  const map = new Map()
  for (const r of props.reactions) {
    if (!map.has(r.emoji)) map.set(r.emoji, { emoji: r.emoji, count: 0, hasMine: false })
    const g = map.get(r.emoji)
    g.count++
    if (r.sender === 'me') g.hasMine = true
  }
  return [...map.values()]
})
</script>

<template>
  <div
    class="flex gap-1.5"
    :class="[
      isMe ? 'justify-end' : 'justify-start',
      isFirstInGroup ? 'mt-1.5' : 'mt-[3px]',
    ]"
  >
    <!-- Sender avatar (received, first in group only) -->
    <div v-if="!isMe && isFirstInGroup"
      class="w-6 h-6 rounded-full shrink-0 overflow-hidden flex items-center justify-center mt-auto"
      :style="{ background: senderProfile?.picture ? '' : senderColor }">
      <img v-if="senderProfile?.picture" :src="senderProfile.picture" alt="" class="w-full h-full object-cover" />
      <span v-else class="text-[8px] font-bold text-white">{{ (senderName || '?')[0].toUpperCase() }}</span>
    </div>
    <div v-else-if="!isMe" class="w-6 shrink-0" />

    <!-- Bubble -->
    <div
      class="max-w-[80%] relative"
      :class="isFailed ? 'opacity-60' : ''"
    >
      <!-- Action menu (long-press) -->
      <MessageActions
        v-if="showActions && !deleted"
        :message="message"
        :is-sent="isMe"
        @react="(emoji) => emit('react', { messageId: message.id, emoji })"
        @reply="emit('reply', message)"
        @delete="emit('delete', message)"
        @forward="emit('forward', message)"
        @close="showActions = false"
      />

      <!-- Sender name (received, first in group) -->
      <div v-if="!isMe && isFirstInGroup" class="text-[10px] font-semibold mb-0.5 px-1" :style="{ color: senderColor }">
        {{ senderName }}
      </div>

      <!-- Reply context -->
      <div v-if="replyContent && !deleted"
        class="flex items-center gap-1 text-[10px] text-text-muted px-3 py-1 mb-0.5 rounded-t-xl border-l-2 border-brand/40 bg-surface-elevated/50">
        <CornerDownRight class="w-2.5 h-2.5 shrink-0" />
        <span class="font-semibold">{{ replySenderName }}</span>
        <span class="truncate">{{ replyContent }}</span>
      </div>

      <div
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @contextmenu.prevent="showActions = true"
        class="px-3 py-1.5 text-[13px] leading-relaxed break-words select-none"
        :class="[
          isMe
            ? 'bg-brand text-surface-base rounded-2xl'
            : 'bg-surface-card border border-border text-text-primary rounded-2xl',
          isMe && isLastInGroup ? 'rounded-br-[4px]' : '',
          !isMe && isLastInGroup ? 'rounded-bl-[4px]' : '',
        ]"
      >
        <!-- Deleted message -->
        <template v-if="deleted">
          <span class="inline-flex items-center gap-1 opacity-60 italic text-xs">
            <AlertTriangle class="w-3 h-3" />
            {{ t('chat.messageDeletedLabel') }}
          </span>
        </template>

        <!-- Normal content -->
        <template v-else>
          {{ message.content }}
        </template>

        <!-- Timestamp + status -->
        <span class="inline-flex items-center gap-0.5 ml-2 align-bottom text-[10px] opacity-60 select-none">
          {{ timeStr }}
          <Loader2 v-if="isSending && isMe" class="w-2.5 h-2.5 animate-spin" />
          <Check v-else-if="isMe && !isFailed" class="w-2.5 h-2.5" />
          <AlertCircle v-else-if="isFailed" class="w-2.5 h-2.5 text-error" />
        </span>
      </div>

      <!-- Retry hint -->
      <button v-if="isFailed" @click="emit('retry', message.id)"
        class="text-[10px] text-error font-medium mt-0.5 px-1">
        {{ t('chat.tapToRetry') }}
      </button>
    </div>
  </div>

  <!-- Reaction chips -->
  <div v-if="groupedReactions.length > 0 && !deleted"
    class="flex gap-1 mt-0.5 px-1"
    :class="isMe ? 'justify-end' : 'justify-start pl-8'"
  >
    <span
      v-for="r in groupedReactions" :key="r.emoji"
      class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors cursor-default"
      :class="r.hasMine
        ? 'bg-brand/10 border-brand/20 text-brand'
        : 'bg-surface-elevated border-border text-text-secondary'"
    >
      <span>{{ r.emoji }}</span>
      <span v-if="r.count > 1" class="font-semibold tabular-nums">{{ r.count }}</span>
    </span>
  </div>
</template>
