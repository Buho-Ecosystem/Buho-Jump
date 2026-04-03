<script setup>
/**
 * Telegram-style chat bubble — timestamp always inside bubble,
 * status icons for sent messages (sending/sent/failed), grouped spacing.
 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseNostrLinks, hasNostrLinks } from '../../lib/nostrLinks.js'
import { getWarning, getCustomEmojis, renderCustomEmojis } from '../../lib/messageEnrich.js'
import MessageActions from './MessageActions.vue'
import { Check, Zap, Loader2, AlertCircle, AlertTriangle } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  message: { type: Object, required: true },
  isLastInGroup: { type: Boolean, default: true },
  isFirstInGroup: { type: Boolean, default: true },
  reactions: { type: Array, default: () => [] },
  deleted: { type: Boolean, default: false },
})

const emit = defineEmits(['retry', 'react', 'reply', 'delete', 'report', 'forward'])

const showRelayList = ref(false)
const relayCount = computed(() => props.message.publishedRelays?.length || 0)

// Long-press to show action menu
const showActions = ref(false)
let pressTimer = null

function onPointerDown() {
  pressTimer = setTimeout(() => { showActions.value = true }, 500)
}
function onPointerUp() {
  clearTimeout(pressTimer)
}
function onPointerLeave() {
  clearTimeout(pressTimer)
}

onBeforeUnmount(() => clearTimeout(pressTimer))

const isSent = computed(() => props.message.sender === 'me')
const isZap = computed(() => props.message.type === 'zap')
const isFailed = computed(() => props.message.status === 'failed')
const isSending = computed(() => props.message.status === 'sending')

const timeStr = computed(() => {
  const d = new Date(props.message.created_at * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// NIP-36 content warning — show warning instead of content until user clicks to reveal
const contentWarning = computed(() => getWarning(props.message))
const cwRevealed = ref(false)

// NIP-30 custom emoji — render :shortcode: as images if emoji tags present
const emojiMap = computed(() => getCustomEmojis(props.message))
const enrichedContent = computed(() => {
  if (!props.message.content || emojiMap.value.size === 0) return null
  return renderCustomEmojis(props.message.content, emojiMap.value)
})

const contentParts = computed(() => {
  if (isZap.value || !props.message.content) return null
  if (!hasNostrLinks(props.message.content)) return null
  return parseNostrLinks(props.message.content)
})

// Group reactions by emoji for display chips
const groupedReactions = computed(() => {
  if (!props.reactions.length) return []
  const map = new Map()
  for (const r of props.reactions) {
    const key = r.emoji
    if (!map.has(key)) map.set(key, { emoji: key, count: 0, hasMine: false })
    const group = map.get(key)
    group.count++
    if (r.sender === 'me') group.hasMine = true
  }
  return [...map.values()]
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
    class="flex relative"
    :class="[
      isSent ? 'justify-end' : 'justify-start',
      isFirstInGroup ? 'mt-1.5' : 'mt-[3px]',
    ]"
  >
    <!-- Action menu (long-press) -->
    <MessageActions
      v-if="showActions && !isZap"
      :message="message"
      :is-sent="isSent"
      @react="(emoji) => emit('react', { messageId: message.id, emoji })"
      @reply="emit('reply', message)"
      @delete="emit('delete', message)"
      @report="emit('report', message)"
      @forward="emit('forward', message)"
      @close="showActions = false"
    />

    <div
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent="showActions = true"
      class="max-w-[80%] px-2.5 py-[6px] text-[13px] leading-[1.35] break-words select-none"
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
      <!-- Deleted message -->
      <template v-if="deleted">
        <span class="inline-flex items-center gap-1 text-text-muted/60 italic text-xs">
          <AlertTriangle class="w-3 h-3" />
          {{ t('chat.messageDeletedLabel') }}
          <span class="inline-block w-[52px]" />
        </span>
      </template>

      <template v-else>

      <!-- Reply preview (if this message is a reply) -->
      <div v-if="message.replyTo" class="text-[10px] text-text-muted/70 border-l-2 border-brand/40 pl-1.5 mb-1 truncate italic">
        {{ message.replyTo.content?.slice(0, 60) || t('chat.reply') }}
      </div>

      <!-- Zap message -->
      <span v-if="isZap" class="inline-flex items-center gap-1 font-semibold">
        <Zap class="w-3.5 h-3.5" />
        {{ message.content }}
        <!-- Zap spacer for timestamp -->
        <span class="inline-block w-[48px]" />
      </span>

      <!-- Content warning gate (NIP-36) -->
      <span v-else-if="contentWarning && !cwRevealed" class="inline-flex items-center gap-1.5 cursor-pointer" @click="cwRevealed = true">
        <AlertTriangle class="w-3 h-3 text-warning shrink-0" />
        <span class="text-warning text-xs italic">{{ contentWarning || t('chat.contentWarning') }}</span>
        <span class="inline-block" :class="spacerWidth" />
      </span>

      <!-- Regular message content + inline timestamp spacer -->
      <span v-else-if="enrichedContent">
        <!-- Custom emoji rendered as HTML (NIP-30) -->
        <span class="whitespace-pre-wrap" v-html="enrichedContent" />
        <span class="inline-block" :class="spacerWidth" />
      </span>
      <span v-else>
        <span v-if="contentParts" class="whitespace-pre-wrap"><template
          v-for="(part, pi) in contentParts" :key="pi"><a
            v-if="part.type === 'mention'"
            :href="part.href"
            target="_blank"
            rel="noopener noreferrer"
            class="text-brand hover:underline font-medium"
          >@{{ part.display }}</a><template v-else>{{ part.value }}</template></template></span>
        <span v-else class="whitespace-pre-wrap">{{ message.content }}</span>
        <span class="inline-block" :class="spacerWidth" />
      </span>

      </template>

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
          <!-- Relay count pill (replaces single check) -->
          <button
            v-else-if="relayCount > 0"
            @click.stop="showRelayList = !showRelayList"
            class="inline-flex items-center gap-[2px] px-[5px] py-[1px] rounded-full bg-white/10 text-[8px] font-bold opacity-50 hover:opacity-80 transition-opacity cursor-pointer tabular-nums"
            :title="t('chat.publishedTo', { count: relayCount })"
          >
            <Check class="w-[10px] h-[10px]" />
            {{ relayCount }}
          </button>
          <Check v-else class="w-[14px] h-[14px] opacity-40" />
        </template>
      </span>
    </div>
  </div>

  <!-- Reaction chips -->
  <div v-if="groupedReactions.length > 0 && !deleted"
    class="flex gap-1 mt-0.5 px-1"
    :class="isSent ? 'justify-end' : 'justify-start'"
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

  <!-- Relay list popup -->
  <div v-if="showRelayList && relayCount > 0" class="flex justify-end mt-0.5 px-2 animate-fade-in">
    <div class="bg-surface-card rounded-xl border border-border shadow-md p-2 max-w-[240px]">
      <p class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-1">
        {{ t('chat.publishedTo', { count: relayCount }) }}
      </p>
      <div v-for="url in message.publishedRelays" :key="url"
        class="text-[10px] text-text-secondary font-mono truncate py-0.5">
        {{ url.replace('wss://', '') }}
      </div>
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
