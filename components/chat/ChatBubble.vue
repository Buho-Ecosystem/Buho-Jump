<script setup>
/**
 * Single chat bubble — sent (right, green gradient), received (left, card bg),
 * or zap (special golden style).
 */
import { computed } from 'vue'
import { Shield, ShieldAlert, Zap } from 'lucide-vue-next'

const props = defineProps({
  message: { type: Object, required: true },
  showTime: { type: Boolean, default: false },
})

const isSent = computed(() => props.message.sender === 'me')
const isZap = computed(() => props.message.type === 'zap')
const isNip17 = computed(() => props.message.protocol === 'nip17')

const timeStr = computed(() => {
  const d = new Date(props.message.created_at * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})
</script>

<template>
  <div
    class="flex"
    :class="isSent ? 'justify-end' : 'justify-start'"
  >
    <div class="max-w-[75%] space-y-0.5">
      <!-- Bubble -->
      <div
        class="px-3 py-2 text-xs leading-relaxed break-words"
        :class="[
          isZap
            ? 'chat-bubble-zap rounded-2xl'
            : isSent
              ? 'chat-bubble-sent rounded-2xl rounded-tr-md'
              : 'chat-bubble-received rounded-2xl rounded-tl-md',
        ]"
      >
        <!-- Zap icon for zap messages -->
        <span v-if="isZap" class="inline-flex items-center gap-1">
          <Zap class="w-3.5 h-3.5" />
          <span class="font-semibold">{{ message.content }}</span>
        </span>
        <span v-else class="whitespace-pre-wrap">{{ message.content }}</span>
      </div>

      <!-- Time + protocol indicator -->
      <div
        v-if="showTime"
        class="flex items-center gap-1 px-1"
        :class="isSent ? 'justify-end' : 'justify-start'"
      >
        <span class="text-[8px] text-text-muted">{{ timeStr }}</span>
        <Shield v-if="isNip17" class="w-2 h-2 text-success" title="NIP-17 encrypted" />
        <ShieldAlert v-else-if="message.protocol === 'nip04'" class="w-2 h-2 text-text-muted" title="NIP-04 legacy" />
      </div>
    </div>
  </div>
</template>
