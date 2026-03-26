<script setup>
/**
 * Group chat thread — message bubbles with multi-sender support,
 * date separators, reply threading, and admin menu.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useToast } from '../../composables/useToast.js'
import { nip19 } from 'nostr-core'
import { truncateKey } from '../../lib/utils.js'
import GroupBubble from './GroupBubble.vue'
import {
  ArrowLeft, Send, Lock, X, Globe,
  MoreHorizontal, Copy, Check, ExternalLink, Info,
  ChevronDown, Users, MessageSquare,
} from 'lucide-vue-next'

const props = defineProps({
  groupKey: { type: String, required: true },
})

const emit = defineEmits(['back', 'info'])
const { t } = useI18n()
const { groups, getMessages, sendGroupMessage, retryMessage, markRead, currentAccountPubkey, gkey } = useGroups()
const { getCachedProfile, fetchProfiles } = useContacts()
const toast = useToast()

const group = computed(() => {
  return groups.value.find(g => gkey(g) === props.groupKey) || { id: props.groupKey, name: props.groupKey, type: 'relay' }
})

const input = ref('')
const scrollRef = ref(null)
const textareaRef = ref(null)
const showMenu = ref(false)
const menuRef = ref(null)
const showScrollBtn = ref(false)
const replyingTo = ref(null) // message being replied to

const messageList = getMessages(props.groupKey)

// ── Message grouping (same as ChatThread) ──
const groupedMessages = computed(() => {
  const msgs = messageList.value
  if (msgs.length === 0) return []

  const result = []
  let lastDate = ''

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const date = new Date(msg.created_at * 1000)
    const dateStr = date.toDateString()

    if (dateStr !== lastDate) {
      lastDate = dateStr
      const today = new Date().toDateString()
      const yesterday = new Date(Date.now() - 86400000).toDateString()
      result.push({
        type: 'date',
        label: dateStr === today ? t('chat.today')
          : dateStr === yesterday ? t('chat.yesterday')
          : formatShortDate(date),
      })
    }

    const prev = msgs[i - 1]
    const next = msgs[i + 1]

    const sameDay = (a, b) => a && b && new Date(a.created_at * 1000).toDateString() === new Date(b.created_at * 1000).toDateString()
    const sameGroup = (a, b) => a && b && a.sender === b.sender && sameDay(a, b) && Math.abs(a.created_at - b.created_at) < 60

    const isFirst = !sameGroup(prev, msg)
    const isLast = !sameGroup(msg, next)
    const isMe = msg.sender === currentAccountPubkey.value

    // Resolve reply content
    let replyContent = ''
    let replySenderName = ''
    if (msg.replyTo) {
      const parent = msgs.find(m => m.id === msg.replyTo)
      if (parent) {
        replyContent = parent.content?.slice(0, 80) || ''
        const p = getCachedProfile(parent.sender)
        replySenderName = p?.display_name || p?.name || truncateKey(nip19.npubEncode(parent.sender), 8, 4)
      }
    }

    result.push({ type: 'message', msg, isFirst, isLast, isMe, replyContent, replySenderName })
  }
  return result
})

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Actions ──

function handleSend() {
  const text = input.value.trim()
  if (!text) return

  const reply = replyingTo.value?.id
  input.value = ''
  replyingTo.value = null
  resetTextareaHeight()
  scrollToBottom()

  sendGroupMessage(group.value, text, reply).catch(() => {
    // Failed status shown on the bubble itself
  })
}

async function handleRetry(msgId) {
  try {
    await retryMessage(props.groupKey, msgId)
    scrollToBottom()
  } catch {
    toast.error(t('group.sendFailed'))
  }
}

function handleReply(msg) {
  replyingTo.value = msg
  textareaRef.value?.focus()
}

function cancelReply() {
  replyingTo.value = null
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  })
}

function isNearBottom() {
  if (!scrollRef.value) return true
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  return scrollHeight - scrollTop - clientHeight <= 80
}

function onScroll() {
  showScrollBtn.value = !isNearBottom()
}

function handleTextareaInput(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function resetTextareaHeight() {
  if (textareaRef.value) textareaRef.value.style.height = 'auto'
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function onClickOutside(e) {
  if (showMenu.value && menuRef.value && !menuRef.value.contains(e.target)) {
    showMenu.value = false
  }
}

onMounted(() => {
  markRead(props.groupKey)
  document.addEventListener('click', onClickOutside, true)
  scrollToBottom()
  // Batch-fetch profiles for all unique senders
  const senders = [...new Set(messageList.value.map(m => m.sender))]
  const uncached = senders.filter(pk => !getCachedProfile(pk))
  if (uncached.length > 0) fetchProfiles(uncached)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside, true)
})

watch(messageList, () => {
  if (isNearBottom()) {
    markRead(props.groupKey)
    scrollToBottom()
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
      <button @click="emit('back')" :aria-label="t('common.back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>

      <button class="flex-1 flex items-center gap-2.5 min-w-0 text-left rounded-lg py-0.5 hover:bg-surface-elevated/30 transition-colors" @click="emit('info')">
        <!-- Type icon -->
        <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
          :class="group.type === 'private' ? 'bg-brand/10' : group.type === 'channel' ? 'bg-success/10' : 'bg-info/10'">
          <Lock v-if="group.type === 'private'" class="w-3.5 h-3.5 text-brand" />
          <Globe v-else-if="group.type === 'channel'" class="w-3.5 h-3.5 text-success" />
          <Users v-else class="w-3.5 h-3.5 text-info" />
        </div>
        <div class="min-w-0">
          <div class="text-[13px] font-semibold truncate leading-tight">{{ group.name || group.id }}</div>
          <div class="text-[10px] text-text-muted leading-tight">
            {{ group.type === 'private' ? t('group.typePrivate') : group.type === 'channel' ? t('group.typeChannel') : t('group.typeCommunity') }}
          </div>
        </div>
      </button>

      <!-- Menu -->
      <div class="relative" ref="menuRef">
        <button @click.stop="showMenu = !showMenu" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200">
          <MoreHorizontal class="w-4 h-4 text-text-muted" />
        </button>
        <div v-if="showMenu"
          class="absolute right-0 top-full mt-1 w-44 bg-surface-card rounded-2xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-right">
          <button @click="emit('info'); showMenu = false"
            class="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-elevated transition-colors text-left text-xs">
            <Info class="w-3.5 h-3.5 text-text-muted" />
            {{ t('group.groupInfo') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Messages -->
    <div ref="scrollRef" @scroll="onScroll" class="flex-1 overflow-y-auto px-3 py-2 space-y-0">
      <template v-if="groupedMessages.length > 0">
        <template v-for="(item, i) in groupedMessages" :key="i">
          <!-- Date separator -->
          <div v-if="item.type === 'date'" class="flex justify-center my-3">
            <span class="text-[10px] text-text-muted bg-surface-elevated/80 px-3 py-0.5 rounded-full font-medium backdrop-blur-sm">
              {{ item.label }}
            </span>
          </div>
          <!-- Message bubble -->
          <GroupBubble
            v-else
            :message="item.msg"
            :is-me="item.isMe"
            :is-first-in-group="item.isFirst"
            :is-last-in-group="item.isLast"
            :reply-content="item.replyContent"
            :reply-sender-name="item.replySenderName"
            @retry="handleRetry"
            @reply="handleReply"
          />
        </template>
      </template>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center h-full text-center py-12 space-y-2">
        <div class="w-10 h-10 rounded-full flex items-center justify-center"
          :class="group.type === 'private' ? 'bg-brand/10' : group.type === 'channel' ? 'bg-success/10' : 'bg-info/10'">
          <Lock v-if="group.type === 'private'" class="w-4 h-4 text-brand" />
          <Globe v-else-if="group.type === 'channel'" class="w-4 h-4 text-success" />
          <MessageSquare v-else class="w-4 h-4 text-info" />
        </div>
        <p class="text-xs font-medium">{{ t('chat.emptyThreadTitle') }}</p>
        <p class="text-[10px] text-text-muted px-8">{{ t('chat.sendMessage') }}</p>
      </div>
    </div>

    <!-- Scroll to bottom -->
    <button v-if="showScrollBtn" @click="scrollToBottom"
      class="absolute bottom-20 right-4 w-8 h-8 rounded-full bg-surface-card border border-border shadow-md flex items-center justify-center hover:bg-surface-elevated transition-all z-10">
      <ChevronDown class="w-4 h-4 text-text-muted" />
    </button>

    <!-- Reply bar -->
    <div v-if="replyingTo" class="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-surface-elevated/50 text-xs">
      <div class="flex-1 min-w-0 truncate text-text-muted">
        <span class="font-semibold text-brand">{{ t('group.replyTo', { name: getCachedProfile(replyingTo.sender)?.display_name || getCachedProfile(replyingTo.sender)?.name || truncateKey(nip19.npubEncode(replyingTo.sender), 8, 4) }) }}</span>
        <span class="ml-1">{{ replyingTo.content?.slice(0, 60) }}</span>
      </div>
      <button @click="cancelReply" class="p-0.5 rounded hover:bg-surface-elevated transition-colors">
        <X class="w-3.5 h-3.5 text-text-muted" />
      </button>
    </div>

    <!-- Input -->
    <div class="flex items-end gap-2 px-3 py-2 border-t border-border shrink-0">
      <textarea
        ref="textareaRef"
        v-model="input"
        @input="handleTextareaInput"
        @keydown="handleKeydown"
        :placeholder="t('chat.inputPlaceholder')"
        rows="1"
        class="flex-1 bg-surface-card border border-border rounded-2xl px-3 py-2 text-[13px] outline-none focus:border-brand transition-all duration-200 resize-none max-h-[120px] placeholder:text-text-muted"
      />
      <button
        @click="handleSend"
        :disabled="!input.trim()"
        class="p-2.5 rounded-full bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 shrink-0 btn-primary"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
