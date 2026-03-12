<script setup>
/**
 * Telegram-style conversation row — 48px avatar with deterministic color,
 * two-line text (name + timestamp / preview), unread pill badge.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { nip19 } from 'nostr-core'
import { formatTimestamp } from '../../lib/utils.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import { Zap } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  pubkey: { type: String, required: true },
  lastMessage: { type: Object, default: null },
  unread: { type: Number, default: 0 },
})

defineEmits(['click'])

const { fetchProfile, getCachedProfile } = useContacts()
const profile = ref(getCachedProfile(props.pubkey))

onMounted(async () => {
  if (!profile.value) {
    profile.value = await fetchProfile(props.pubkey)
  }
})

const displayName = computed(() =>
  profile.value?.display_name || profile.value?.name || truncateNpub(props.pubkey)
)

const avatarLetter = computed(() => (displayName.value || '?')[0].toUpperCase())

const avatarColor = computed(() => getAvatarColor(props.pubkey))

const preview = computed(() => {
  if (!props.lastMessage) return ''
  const prefix = props.lastMessage.sender === 'me' ? t('chat.you') + ': ' : ''
  const text = props.lastMessage.type === 'zap'
    ? '\u26A1 ' + props.lastMessage.content
    : props.lastMessage.content
  return prefix + text
})

const time = computed(() => {
  if (!props.lastMessage) return ''
  return formatTimestamp(props.lastMessage.created_at, t)
})

const isZap = computed(() => props.lastMessage?.type === 'zap')

function truncateNpub(pubkey) {
  try {
    const npub = nip19.npubEncode(pubkey)
    return npub.slice(0, 8) + '...' + npub.slice(-4)
  } catch {
    return pubkey.slice(0, 8) + '...'
  }
}
</script>

<template>
  <button
    @click="$emit('click')"
    class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left"
  >
    <!-- Avatar (48px, Telegram-style with deterministic color) -->
    <div
      class="w-[48px] h-[48px] rounded-full shrink-0 overflow-hidden flex items-center justify-center"
      :style="!profile?.picture ? { background: avatarColor } : {}"
    >
      <img
        v-if="profile?.picture"
        :src="profile.picture"
        alt=""
        class="w-full h-full object-cover"
        @error="profile.picture = null"
      />
      <span v-else class="text-base font-semibold text-white">{{ avatarLetter }}</span>
    </div>

    <!-- Text block -->
    <div class="flex-1 min-w-0">
      <!-- Top: name + time -->
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[13px] font-semibold truncate">{{ displayName }}</span>
        <span class="text-[11px] shrink-0" :class="unread > 0 ? 'text-brand font-medium' : 'text-text-muted'">
          {{ time }}
        </span>
      </div>
      <!-- Bottom: preview + unread badge -->
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <div class="flex items-center gap-1 text-[12px] text-text-secondary truncate min-w-0">
          <Zap v-if="isZap" class="w-3 h-3 text-warning shrink-0" />
          <span class="truncate">{{ preview || t('chat.emptyDesc') }}</span>
        </div>
        <span v-if="unread > 0" class="chat-unread-badge shrink-0">
          {{ unread > 99 ? '99+' : unread }}
        </span>
      </div>
    </div>
  </button>
</template>
