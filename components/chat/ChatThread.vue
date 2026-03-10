<script setup>
/**
 * Chat thread — message bubbles, input bar, and inline zap support.
 *
 * Surprise feature: ⚡ button next to send opens a quick zap picker.
 * Send sats directly to the contact's lightning address from within the chat.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { nip19 } from 'nostr-core'
import { fetchInvoice } from 'nostr-core'
import { formatSats } from '../../lib/utils.js'
import ChatBubble from './ChatBubble.vue'
import {
  ArrowLeft, Send, Zap, Loader2, Shield, X,
  MoreHorizontal, Copy, Check, User, ExternalLink,
} from 'lucide-vue-next'

const props = defineProps({
  pubkey: { type: String, required: true },
})

const emit = defineEmits(['back'])

const { t } = useI18n()
const { getMessages, sendMessage, markRead, addZapMessage, currentAccountPubkey } = useChat()
const { fetchProfile, getCachedProfile } = useContacts()
const { status: walletStatus, payInvoice } = useWallet()
const toast = useToast()

// Capture the account pubkey at mount time to prevent sending from wrong account
let mountedAccountPubkey = null

// ── State ──
const profile = ref(getCachedProfile(props.pubkey))
const input = ref('')
const sending = ref(false)
const scrollRef = ref(null)
const textareaRef = ref(null)
const copied = ref(false)
const showMenu = ref(false)
const menuRef = ref(null)

// Zap state
const showZapPicker = ref(false)
const zapAmounts = [21, 100, 500, 1000, 5000]
const customZapAmount = ref('')
const zapping = ref(false)

const messageList = getMessages(props.pubkey)

const displayName = computed(() =>
  profile.value?.display_name || profile.value?.name || truncateNpub(props.pubkey)
)

const nip05Display = computed(() => profile.value?.nip05 || '')

const lightningAddress = computed(() => profile.value?.lud16 || null)

const canZap = computed(() =>
  walletStatus.value?.connected && lightningAddress.value
)

// Group messages with time separators
const groupedMessages = computed(() => {
  const msgs = messageList.value
  if (msgs.length === 0) return []

  const groups = []
  let lastDate = ''
  let lastTime = 0

  for (const msg of msgs) {
    const d = new Date(msg.created_at * 1000)
    const dateStr = d.toLocaleDateString()

    // Date separator
    if (dateStr !== lastDate) {
      lastDate = dateStr
      groups.push({ type: 'date', label: formatDateLabel(d) })
    }

    // Show time if gap > 5 minutes
    const showTime = msg.created_at - lastTime > 300
    lastTime = msg.created_at

    groups.push({ type: 'message', message: msg, showTime })
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

async function handleSend() {
  const text = input.value.trim()
  if (!text || sending.value) return

  // Guard: prevent sending from wrong account after switch
  if (mountedAccountPubkey && currentAccountPubkey.value !== mountedAccountPubkey) {
    toast.error(t('chat.sendFailed'))
    emit('back')
    return
  }

  sending.value = true
  try {
    await sendMessage(props.pubkey, text)
    input.value = ''
    resetTextareaHeight()
    scrollToBottom()
  } catch (err) {
    toast.error(err.message || t('chat.sendFailed'))
  } finally {
    sending.value = false
  }
}

async function handleZap(amount) {
  if (!lightningAddress.value || zapping.value) return

  const sats = amount || parseInt(customZapAmount.value)
  if (!sats || sats <= 0 || !Number.isFinite(sats)) return

  zapping.value = true
  try {
    // Resolve lightning address → invoice
    const result = await fetchInvoice(lightningAddress.value, sats)
    if (!result?.invoice) throw new Error('No invoice returned')

    // Pay via NWC
    await payInvoice(result.invoice)

    // Record zap in thread
    addZapMessage(props.pubkey, sats)
    showZapPicker.value = false
    customZapAmount.value = ''
    scrollToBottom()
    toast.success(t('chat.zapSent', { amount: formatSats(sats) }))
  } catch (err) {
    toast.error(err.message || t('chat.zapFailed'))
  } finally {
    zapping.value = false
  }
}

function copyNpub() {
  try {
    navigator.clipboard.writeText(nip19.npubEncode(props.pubkey))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {}
}

function viewProfile() {
  showMenu.value = false
  try {
    const npub = nip19.npubEncode(props.pubkey)
    window.open(`https://njump.me/${npub}`, '_blank')
  } catch {}
}

function scrollToBottom() {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  })
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// Textarea auto-grow
function autoResize(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 80) + 'px'
}

function resetTextareaHeight() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}

// Click-outside to close menu
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
  markRead(props.pubkey)
  scrollToBottom()
})
</script>

<template>
  <div class="flex flex-col h-full animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2 px-1 pb-3 border-b border-border shrink-0">
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-colors" aria-label="Back">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>

      <!-- Avatar + name -->
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <div class="w-7 h-7 rounded-full shrink-0 overflow-hidden"
          :class="profile?.picture ? '' : 'bg-brand/15 flex items-center justify-center'">
          <img v-if="profile?.picture" :src="profile.picture" alt="" class="w-full h-full object-cover" @error="profile.picture = null" />
          <span v-else class="text-[9px] font-bold text-brand">{{ (displayName || '?')[0].toUpperCase() }}</span>
        </div>
        <div class="min-w-0">
          <div class="text-xs font-semibold truncate flex items-center gap-1">
            {{ displayName }}
            <Shield v-if="nip05Display" class="w-2.5 h-2.5 text-brand shrink-0" />
          </div>
          <div v-if="nip05Display" class="text-[8px] text-brand truncate">{{ nip05Display }}</div>
        </div>
      </div>

      <!-- Menu -->
      <div ref="menuRef" class="relative">
        <button @click.stop="showMenu = !showMenu" class="p-1 rounded-md hover:bg-surface-elevated transition-colors" aria-label="Menu">
          <MoreHorizontal class="w-4 h-4 text-text-muted" />
        </button>
        <div v-if="showMenu" class="absolute right-0 top-full mt-1 w-44 bg-surface-card rounded-xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-right">
          <button @click="copyNpub(); showMenu = false"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-elevated transition-colors text-left text-xs">
            <Check v-if="copied" class="w-3.5 h-3.5 text-success" />
            <Copy v-else class="w-3.5 h-3.5 text-text-muted" />
            {{ copied ? t('common.copied') : t('chat.copyNpub') }}
          </button>
          <button @click="viewProfile"
            class="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-elevated transition-colors text-left text-xs">
            <ExternalLink class="w-3.5 h-3.5 text-text-muted" />
            {{ t('chat.viewProfile') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Messages area -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto px-1 py-3 space-y-2">
      <template v-for="(item, idx) in groupedMessages" :key="idx">
        <!-- Date separator -->
        <div v-if="item.type === 'date'" class="flex items-center gap-2 py-2">
          <div class="flex-1 h-px bg-border" />
          <span class="text-[8px] text-text-muted font-medium px-2">{{ item.label }}</span>
          <div class="flex-1 h-px bg-border" />
        </div>

        <!-- Message bubble -->
        <ChatBubble
          v-else
          :message="item.message"
          :show-time="item.showTime"
        />
      </template>

      <!-- Empty thread -->
      <div v-if="messageList.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
        <div class="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center mb-2">
          <Shield class="w-5 h-5 text-brand" />
        </div>
        <p class="text-[10px] text-text-muted">{{ t('chat.encryptedHint') }}</p>
      </div>
    </div>

    <!-- Zap picker (inline, above input) -->
    <div v-if="showZapPicker" class="px-1 pb-2 animate-fade-in-up">
      <div class="bg-surface-card rounded-xl border border-border p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <Zap class="w-3.5 h-3.5 text-warning" />
            <span class="text-[10px] font-semibold">{{ t('chat.zapTitle') }}</span>
          </div>
          <button @click="showZapPicker = false" class="p-0.5 rounded hover:bg-surface-elevated transition-colors" aria-label="Close">
            <X class="w-3 h-3 text-text-muted" />
          </button>
        </div>

        <!-- Quick amounts -->
        <div class="flex gap-1.5 mb-2">
          <button
            v-for="amt in zapAmounts"
            :key="amt"
            @click="handleZap(amt)"
            :disabled="zapping"
            class="flex-1 py-1.5 text-[10px] font-semibold rounded-lg bg-surface-elevated hover:bg-warning/10 hover:text-warning transition-colors disabled:opacity-40"
          >
            {{ formatSats(amt) }}
          </button>
        </div>

        <!-- Custom amount -->
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
            class="px-3 py-1.5 text-[10px] rounded-lg font-semibold transition-colors disabled:opacity-40 flex items-center gap-1 chat-bubble-zap"
            aria-label="Send zap"
          >
            <Loader2 v-if="zapping" class="w-3 h-3 animate-spin" />
            <Zap v-else class="w-3 h-3" />
          </button>
        </div>

        <p v-if="lightningAddress" class="text-[8px] text-text-muted mt-1.5 truncate">
          → {{ lightningAddress }}
        </p>
      </div>
    </div>

    <!-- Input bar -->
    <div class="flex items-end gap-2 px-1 pt-2 pb-1 border-t border-border shrink-0">
      <!-- Zap button -->
      <button
        v-if="canZap"
        @click="showZapPicker = !showZapPicker"
        class="p-2 rounded-xl transition-colors shrink-0"
        :class="showZapPicker ? 'bg-warning/15 text-warning' : 'hover:bg-surface-elevated text-text-muted'"
        :title="t('chat.zapTitle')"
        aria-label="Send zap"
      >
        <Zap class="w-4 h-4" />
      </button>

      <!-- Text input -->
      <div class="flex-1 relative">
        <textarea
          ref="textareaRef"
          v-model="input"
          @keydown="onKeydown"
          @input="autoResize"
          :placeholder="t('chat.inputPlaceholder')"
          rows="1"
          class="w-full bg-surface-elevated border-none rounded-2xl px-3.5 py-2 text-xs outline-none focus:ring-1 focus:ring-brand transition-all placeholder:text-text-muted resize-none max-h-20"
        />
      </div>

      <!-- Send button -->
      <button
        @click="handleSend"
        :disabled="!input.trim() || sending"
        class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
        :class="input.trim() ? 'btn-action-receive text-white' : 'bg-surface-elevated text-text-muted'"
        aria-label="Send message"
      >
        <Loader2 v-if="sending" class="w-4 h-4 animate-spin" />
        <Send v-else class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
</template>
