<script setup>
/**
 * Group message bubble — shows sender name/avatar for first-in-group,
 * reply context, and message content. Similar to ChatBubble but with
 * multi-sender support.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import { Loader2, AlertCircle, Check, CornerDownRight } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  message: { type: Object, required: true },
  isMe: { type: Boolean, default: false },
  isFirstInGroup: { type: Boolean, default: true },
  isLastInGroup: { type: Boolean, default: true },
  replyContent: { type: String, default: '' },
  replySenderName: { type: String, default: '' },
})

defineEmits(['retry', 'reply'])

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
      class="max-w-[80%] relative group"
      :class="isFailed ? 'opacity-60' : ''"
    >
      <!-- Sender name (received, first in group) -->
      <div v-if="!isMe && isFirstInGroup" class="text-[10px] font-semibold mb-0.5 px-1" :style="{ color: senderColor }">
        {{ senderName }}
      </div>

      <!-- Reply context -->
      <div v-if="replyContent"
        class="flex items-center gap-1 text-[10px] text-text-muted px-3 py-1 mb-0.5 rounded-t-xl border-l-2 border-brand/40 bg-surface-elevated/50">
        <CornerDownRight class="w-2.5 h-2.5 shrink-0" />
        <span class="font-semibold">{{ replySenderName }}</span>
        <span class="truncate">{{ replyContent }}</span>
      </div>

      <div
        @click="isFailed ? $emit('retry', message.id) : $emit('reply', message)"
        class="px-3 py-1.5 text-[13px] leading-relaxed break-words"
        :class="[
          isMe
            ? 'bg-brand text-surface-base rounded-2xl'
            : 'bg-surface-card border border-border text-text-primary rounded-2xl',
          isMe && isLastInGroup ? 'rounded-br-[4px]' : '',
          !isMe && isLastInGroup ? 'rounded-bl-[4px]' : '',
          isFailed ? 'cursor-pointer' : '',
        ]"
      >
        {{ message.content }}

        <!-- Timestamp + status -->
        <span class="inline-flex items-center gap-0.5 ml-2 align-bottom text-[10px] opacity-60 select-none">
          {{ timeStr }}
          <Loader2 v-if="isSending && isMe" class="w-2.5 h-2.5 animate-spin" />
          <Check v-else-if="isMe && !isFailed" class="w-2.5 h-2.5" />
          <AlertCircle v-else-if="isFailed" class="w-2.5 h-2.5 text-error" />
        </span>
      </div>

      <!-- Retry hint -->
      <button v-if="isFailed" @click="$emit('retry', message.id)"
        class="text-[10px] text-error font-medium mt-0.5 px-1">
        {{ t('chat.tapToRetry') }}
      </button>
    </div>
  </div>
</template>
