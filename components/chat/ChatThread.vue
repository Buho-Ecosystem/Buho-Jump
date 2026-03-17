<script setup>
/**
 * Telegram-style chat thread — message bubbles with grouping, date pills,
 * inline timestamps, scroll-to-bottom button, and inline zap support.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useWallet } from '../../composables/useWallet.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { useToast } from '../../composables/useToast.js'
import { nip19 } from 'nostr-core'
import { formatSats } from '../../lib/utils.js'
import ChatBubble from './ChatBubble.vue'
import { getAvatarColor } from '../../lib/avatarColor.js'
import {
  ArrowLeft, Send, Zap, Loader2, Lock, X,
  MoreHorizontal, Copy, Check, ExternalLink,
  ChevronDown, VolumeX, Volume2,
} from 'lucide-vue-next'

const props = defineProps({
  pubkey: { type: String, required: true },
})

const emit = defineEmits(['back'])

const { t } = useI18n()
const { getMessages, sendMessage, retryMessage, markRead, addZapMessage, updateZapStatus, currentAccountPubkey } = useChat()
const { fetchProfile, getCachedProfile } = useContacts()
const { status: walletStatus, sendZap } = useWallet()
const { isMuted, mute, unmute } = useMuteList()
const toast = useToast()

const muted = computed(() => isMuted(props.pubkey))

let mountedAccountPubkey = null

// ── State ──
const profile = ref(getCachedProfile(props.pubkey))
const input = ref('')
const scrollRef = ref(null)
const textareaRef = ref(null)
const copied = ref(false)
const showMenu = ref(false)
const menuRef = ref(null)
const showScrollBtn = ref(false)

// Zap state
const showZapPicker = ref(false)
const zapAmounts = [21, 100, 500, 1000, 5000]
const customZapAmount = ref('')
const zapping = ref(false)

const messageList = getMessages(props.pubkey)

const avatarColor = computed(() => getAvatarColor(props.pubkey))

const displayName = computed(() =>
  profile.value?.display_name || profile.value?.name || truncateNpub(props.pubkey)
)

const nip05Display = computed(() => profile.value?.nip05 || '')
const lightningAddress = computed(() => profile.value?.lud16 || null)
const canZap = computed(() => walletStatus.value?.connected && lightningAddress.value)

// ── Message grouping (Telegram-style) ──
const groupedMessages = computed(() => {
  const msgs = messageList.value
  if (msgs.length === 0) return []

  const groups = []
  let lastDate = ''

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const prev = msgs[i - 1]
    const next = msgs[i + 1]
    const d = new Date(msg.created_at * 1000)
    const dateStr = d.toLocaleDateString()

    // Date separator
    if (dateStr !== lastDate) {
      lastDate = dateStr
      groups.push({ type: 'date', label: formatDateLabel(d) })
    }

    // Grouping: same sender + within 60s + same date = same group
    const prevDateStr = prev ? new Date(prev.created_at * 1000).toLocaleDateString() : ''
    const sameSenderAsPrev = prev && prev.sender === msg.sender
      && (msg.created_at - prev.created_at) < 60
      && prevDateStr === dateStr
    const nextDateStr = next ? new Date(next.created_at * 1000).toLocaleDateString() : ''
    const sameSenderAsNext = next && next.sender === msg.sender
      && (next.created_at - msg.created_at) < 60
      && nextDateStr === dateStr

    const isFirstInGroup = !sameSenderAsPrev
    const isLastInGroup = !sameSenderAsNext

    groups.push({
      type: 'message',
      message: msg,
      isFirstInGroup,
      isLastInGroup,
    })
  }

  return groups
})

function formatDateLabel(date) {
  const now = new Date()
  const diff = now - date
  const days = Math.floor(diff / 86400000)
  if (days === 0) return t('chat.today')
  if (days === 1) return t('chat.yesterday')
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function truncateNpub(pubkey) {
  try {
    const npub = nip19.npubEncode(pubkey)
    return npub.slice(0, 8) + '...' + npub.slice(-4)
  } catch {
    return pubkey.slice(0, 8) + '...'
  }
}

// ── Actions ──

function handleSend() {
  const text = input.value.trim()
  if (!text) return

  if (mountedAccountPubkey && currentAccountPubkey.value !== mountedAccountPubkey) {
    toast.error(t('chat.sendFailed'))
    emit('back')
    return
  }

  // Clear input immediately — message appears instantly with "sending" tick
  input.value = ''
  resetTextareaHeight()
  scrollToBottom()

  // Send in background — status updates via optimistic message ticks
  sendMessage(props.pubkey, text).catch(() => {
    // Failed status shown on the bubble itself (tap to retry)
  })
}

async function handleZap(amount) {
  if (!lightningAddress.value || zapping.value) return
  const sats = amount || parseInt(customZapAmount.value)
  if (!sats || sats <= 0 || !Number.isFinite(sats)) return

  zapping.value = true
  const zapId = addZapMessage(props.pubkey, sats)
  scrollToBottom()
  try {
    await sendZap({
      recipientPubkey: props.pubkey,
      amountSats: sats,
      lightningAddress: lightningAddress.value,
    })
    updateZapStatus(props.pubkey, zapId, 'sent')
    showZapPicker.value = false
    customZapAmount.value = ''
    toast.success(t('chat.zapSent', { amount: formatSats(sats) }))
  } catch (err) {
    updateZapStatus(props.pubkey, zapId, 'failed')
    toast.error(err.message || t('chat.zapFailed'))
  } finally {
    zapping.value = false
  }
}

async function handleRetry(msgId) {
  try {
    await retryMessage(props.pubkey, msgId)
    scrollToBottom()
  } catch (err) {
    toast.error(err.message || t('chat.sendFailed'))
  }
}

function copyNpub() {
  try {
    navigator.clipboard.writeText(nip19.npubEncode(props.pubkey))
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
  } catch {}
}

function viewProfile() {
  showMenu.value = false
  try {
    const npub = nip19.npubEncode(props.pubkey)
    window.open(`https://njump.me/${npub}`, '_blank')
  } catch {}
}

async function toggleMute() {
  showMenu.value = false
  if (muted.value) {
    await unmute(currentAccountPubkey.value, props.pubkey)
    toast.info(t('chat.unmuted'))
  } else {
    await mute(currentAccountPubkey.value, props.pubkey)
    toast.info(t('chat.muted'))
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  })
}

function isNearBottom() {
  if (!scrollRef.value) return true
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  return scrollHeight - scrollTop - clientHeight <= 80
}

function onScroll() {
  const nearBottom = isNearBottom()
  showScrollBtn.value = !nearBottom
  if (nearBottom) markRead(props.pubkey)
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function autoResize(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function resetTextareaHeight() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}

function onClickOutside(e) {
  if (showMenu.value && menuRef.value && !menuRef.value.contains(e.target)) {
    showMenu.value = false
  }
}

// ── Lifecycle ──

onMounted(async () => {
  mountedAccountPubkey = currentAccountPubkey.value
  markRead(props.pubkey)
  document.addEventListener('click', onClickOutside, true)
  if (!profile.value) {
    profile.value = await fetchProfile(props.pubkey)
  }
  scrollToBottom()
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside, true)
})

watch(messageList, () => {
  if (isNearBottom()) {
    markRead(props.pubkey)
    scrollToBottom()
  }
})
</script>

<template>
  <div class="flex flex-col h-full animate-slide-in-right">

    <!-- Header (Telegram-style) -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0 bg-surface-base">
      <button @click="emit('back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.back')">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>

      <!-- Avatar + name -->
      <div class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer" @click="showMenu = !showMenu">
        <div
          class="w-9 h-9 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
          :style="!profile?.picture ? { background: avatarColor } : {}"
        >
          <img v-if="profile?.picture" :src="profile.picture" alt="" class="w-full h-full object-cover" @error="profile.picture = null" />
          <span v-else class="text-sm font-semibold text-white">{{ (displayName || '?')[0].toUpperCase() }}</span>
        </div>
        <div class="min-w-0">
          <div class="text-[14px] font-semibold truncate leading-tight">{{ displayName }}</div>
          <div v-if="nip05Display" class="text-[11px] text-brand truncate leading-tight">{{ nip05Display }}</div>
        </div>
      </div>

      <!-- Menu -->
      <div ref="menuRef" class="relative">
        <button @click.stop="showMenu = !showMenu" class="p-1.5 rounded-full hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.menu')">
          <MoreHorizontal class="w-5 h-5 text-text-muted" />
        </button>
        <div v-if="showMenu" class="absolute right-0 top-full mt-1 w-44 bg-surface-card rounded-3xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-right">
          <button @click="copyNpub(); showMenu = false"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left text-xs">
            <Check v-if="copied" class="w-4 h-4 text-success" />
            <Copy v-else class="w-4 h-4 text-text-muted" />
            {{ copied ? t('common.copied') : t('chat.copyNpub') }}
          </button>
          <button @click="viewProfile"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left text-xs">
            <ExternalLink class="w-4 h-4 text-text-muted" />
            {{ t('chat.viewProfile') }}
          </button>
          <button @click="toggleMute"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 transition-all duration-200 text-left text-xs"
            :class="muted ? 'hover:bg-success/8 text-success' : 'hover:bg-error/8 text-error'">
            <Volume2 v-if="muted" class="w-4 h-4" />
            <VolumeX v-else class="w-4 h-4" />
            {{ muted ? t('chat.unmuteUser') : t('chat.muteUser') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Messages area (wrapper for scroll + floating button) -->
    <div class="flex-1 relative min-h-0">
      <div
        ref="scrollRef"
        @scroll="onScroll"
        class="absolute inset-0 overflow-y-auto px-3 py-2"
        style="background: color-mix(in srgb, var(--surface-base) 95%, var(--brand-primary));"
      >
        <template v-for="(item, idx) in groupedMessages" :key="idx">
          <!-- Date pill (Telegram floating center style) -->
          <div v-if="item.type === 'date'" class="flex justify-center py-2 sticky top-0 z-10">
            <span class="chat-date-pill">{{ item.label }}</span>
          </div>

          <!-- Message bubble -->
          <ChatBubble
            v-else
            :message="item.message"
            :is-first-in-group="item.isFirstInGroup"
            :is-last-in-group="item.isLastInGroup"
            @retry="handleRetry"
          />
        </template>

        <!-- Empty thread -->
        <div v-if="messageList.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
          <div class="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center mb-3">
            <Lock class="w-6 h-6 text-brand" />
          </div>
          <p class="text-xs text-text-muted font-medium mb-1">{{ t('chat.emptyThreadTitle') }}</p>
          <p class="text-[10px] text-text-muted/70">{{ t('chat.encryptedHint') }}</p>
        </div>
      </div>

      <!-- Scroll-to-bottom button (floating above scroll area) -->
      <transition name="fade">
        <button
          v-if="showScrollBtn"
          @click="scrollToBottom"
          class="chat-scroll-fab absolute bottom-3 right-3 z-20"
        >
          <ChevronDown class="w-5 h-5" />
        </button>
      </transition>
    </div>

    <!-- Zap picker -->
    <div v-if="showZapPicker" class="px-2 pb-1 animate-fade-in-up bg-surface-base">
      <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <Zap class="w-3.5 h-3.5 text-warning" />
            <span class="text-[11px] font-semibold">{{ t('chat.zapTitle') }}</span>
          </div>
          <button @click="showZapPicker = false" class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.close')">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
        <div class="flex gap-1.5 mb-2">
          <button
            v-for="amt in zapAmounts"
            :key="amt"
            @click="handleZap(amt)"
            :disabled="zapping"
            class="flex-1 py-1.5 text-[10px] font-semibold rounded-2xl bg-surface-elevated hover:bg-warning/10 hover:text-warning transition-all duration-200 disabled:opacity-40"
          >
            {{ formatSats(amt) }}
          </button>
        </div>
        <div class="flex gap-1.5">
          <input
            v-model="customZapAmount"
            type="number"
            min="1"
            :placeholder="t('chat.customAmount')"
            class="flex-1 bg-surface-base border border-border rounded-lg px-2.5 py-1.5 text-[10px] outline-none focus:border-warning transition-colors tabular-nums placeholder:text-text-muted"
          />
          <button
            @click="handleZap()"
            :disabled="zapping || !customZapAmount"
            class="px-3 py-1.5 text-[10px] rounded-2xl font-semibold transition-all duration-200 disabled:opacity-40 flex items-center gap-1 chat-bubble-zap"
            :aria-label="t('chat.zapTitle')"
          >
            <Loader2 v-if="zapping" class="w-3 h-3 animate-spin" />
            <Zap v-else class="w-3 h-3" />
          </button>
        </div>
        <p v-if="lightningAddress" class="text-[9px] text-text-muted mt-1.5 truncate">
          → {{ lightningAddress }}
        </p>
      </div>
    </div>

    <!-- Input bar (Telegram-style) -->
    <div class="flex items-end gap-2 px-2 py-2 bg-surface-base border-t border-border shrink-0">
      <!-- Zap button -->
      <button
        v-if="canZap"
        @click="showZapPicker = !showZapPicker"
        class="p-2 rounded-full transition-all duration-200 shrink-0"
        :class="showZapPicker ? 'bg-warning/15 text-warning' : 'hover:bg-surface-elevated text-text-muted'"
        :title="t('chat.zapTitle')"
        :aria-label="t('chat.zapTitle')"
      >
        <Zap class="w-5 h-5" />
      </button>

      <!-- Text input (pill shape) -->
      <div class="flex-1 relative">
        <textarea
          ref="textareaRef"
          v-model="input"
          @keydown="onKeydown"
          @input="autoResize"
          :placeholder="t('chat.inputPlaceholder')"
          rows="1"
          class="chat-input-pill w-full resize-none max-h-[120px]"
        />
      </div>

      <!-- Send button (circular, brand-colored when active) -->
      <button
        @click="handleSend"
        :disabled="!input.trim()"
        class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
        :class="input.trim() ? 'bg-brand text-surface-base' : 'bg-surface-elevated text-text-muted'"
        :aria-label="t('chat.sendMessage')"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
