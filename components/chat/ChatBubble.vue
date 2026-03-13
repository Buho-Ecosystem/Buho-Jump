<script setup>
/**
 * Telegram-style chat bubble — timestamp always inside bubble,
 * status icons for sent messages (sending/sent/failed), grouped spacing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Zap, Loader2, AlertCircle } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  message: { type: Object, required: true },
  isLastInGroup: { type: Boolean, default: true },
  isFirstInGroup: { type: Boolean, default: true },
})

const emit = defineEmits(['retry'])

const isSent = computed(() => props.message.sender === 'me')
const isZap = computed(() => props.message.type === 'zap')
const isFailed = computed(() => props.message.status === 'failed')
const isSending = computed(() => props.message.status === 'sending')

const timeStr = computed(() => {
  const d = new Date(props.message.created_at * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// Telegram-style border-radius: 12px default, 4px on tail corner (last msg)
const bubbleRadius = computed(() => {
  if (isZap.value) return 'rounded-2xl'
  if (isSent.value) {
    return props.isLastInGroup
      ? 'rounded-[12px] rounded-br-[4px]'
      : 'rounded-[12px]'
  }
  return props.isLastInGroup
    ? 'rounded-[12px] rounded-bl-[4px]'
    : 'rounded-[12px]'
})

// Spacer width: accounts for timestamp + status icon
const spacerWidth = computed(() => {
  if (isSent.value) return isFailed.value ? 'w-[80px]' : 'w-[68px]'
  return 'w-[52px]'
})
</script>

<template>
  <div
    class="flex"
    :class="[
      isSent ? 'justify-end' : 'justify-start',
      isFirstInGroup ? 'mt-1.5' : 'mt-[3px]',
    ]"
  >
    <div
      class="max-w-[80%] px-2.5 py-[6px] text-[13px] leading-[1.35] break-words"
      :class="[
        bubbleRadius,
        isZap
          ? 'chat-bubble-zap'
          : isSent
            ? (isFailed ? 'chat-bubble-sent opacity-60' : 'chat-bubble-sent')
            : 'chat-bubble-received',
        isLastInGroup && !isZap && isSent ? 'chat-tail-sent' : '',
        isLastInGroup && !isZap && !isSent ? 'chat-tail-received' : '',
      ]"
    >
      <!-- Zap message -->
      <span v-if="isZap" class="inline-flex items-center gap-1 font-semibold">
        <Zap class="w-3.5 h-3.5" />
        {{ message.content }}
        <!-- Zap spacer for timestamp -->
        <span class="inline-block w-[48px]" />
      </span>

      <!-- Regular message content + inline timestamp spacer -->
      <span v-else>
        <span class="whitespace-pre-wrap">{{ message.content }}</span>
        <span class="inline-block" :class="spacerWidth" />
      </span>

      <!-- Timestamp + status (floating bottom-right inside bubble, Telegram-style) -->
      <span class="float-right relative top-[4px] ml-2 flex items-center gap-0.5 select-none">
        <span class="text-[10px] opacity-50 tabular-nums">{{ timeStr }}</span>
        <!-- Status indicators for sent messages -->
        <template v-if="isSent">
          <Loader2 v-if="isSending" class="w-[12px] h-[12px] opacity-40 animate-spin" />
          <button
            v-else-if="isFailed"
            @click.stop="emit('retry', message.id)"
            class="inline-flex items-center gap-0.5 text-error opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
            :title="t('chat.tapToRetry')"
          >
            <AlertCircle class="w-[13px] h-[13px]" />
          </button>
          <Check v-else class="w-[14px] h-[14px] opacity-40" />
        </template>
      </span>
    </div>
  </div>

  <!-- Failed message hint (below bubble) -->
  <div v-if="isFailed" class="flex justify-end mt-0.5 mb-1 px-2">
    <button
      @click="emit('retry', message.id)"
      class="text-[10px] text-error/70 hover:text-error transition-colors"
    >
      {{ t('chat.tapToRetry') }}
    </button>
  </div>
</template>
