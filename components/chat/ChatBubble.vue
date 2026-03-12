<script setup>
/**
 * Telegram-style chat bubble — timestamp always inside bubble,
 * check mark for sent, grouped spacing, curved tail on last in group.
 */
import { computed } from 'vue'
import { Check, Zap, Shield } from 'lucide-vue-next'

const props = defineProps({
  message: { type: Object, required: true },
  isLastInGroup: { type: Boolean, default: true },
  isFirstInGroup: { type: Boolean, default: true },
})

const isSent = computed(() => props.message.sender === 'me')
const isZap = computed(() => props.message.type === 'zap')
const isNip17 = computed(() => props.message.protocol === 'nip17')

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

// Spacer width: accounts for timestamp + optional check icon
const spacerWidth = computed(() => isSent.value ? 'w-[68px]' : 'w-[52px]')
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
            ? 'chat-bubble-sent'
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
        <Shield
          v-if="isNip17"
          class="w-[10px] h-[10px] opacity-40"
        />
        <span class="text-[10px] opacity-50 tabular-nums">{{ timeStr }}</span>
        <Check v-if="isSent" class="w-[14px] h-[14px] opacity-40" />
      </span>
    </div>
  </div>
</template>
