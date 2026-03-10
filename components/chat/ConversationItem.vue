<script setup>
/**
 * Single conversation row — avatar, name, last message preview, time, unread dot.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { nip19 } from 'nostr-core'
import { formatTimestamp } from '../../lib/utils.js'
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

const nip05 = computed(() => profile.value?.nip05 || '')

const avatarLetter = computed(() => (displayName.value || '?')[0].toUpperCase())

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
    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-card transition-colors text-left group"
  >
    <!-- Avatar -->
    <div class="w-9 h-9 rounded-full shrink-0 overflow-hidden"
      :class="profile?.picture ? '' : 'bg-brand/15 flex items-center justify-center'">
      <img v-if="profile?.picture" :src="profile.picture" alt="" class="w-full h-full object-cover" @error="profile.picture = null" />
      <span v-else class="text-xs font-bold text-brand">{{ avatarLetter }}</span>
    </div>

    <!-- Name + preview -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-semibold truncate">{{ displayName }}</span>
        <span v-if="nip05" class="text-[8px] text-brand font-medium truncate hidden group-hover:inline">
          {{ nip05 }}
        </span>
      </div>
      <div class="flex items-center gap-1 text-[10px] text-text-muted truncate">
        <Zap v-if="isZap" class="w-2.5 h-2.5 text-warning shrink-0" />
        <span class="truncate">{{ preview || t('chat.emptyDesc') }}</span>
      </div>
    </div>

    <!-- Time + unread -->
    <div class="flex flex-col items-end gap-1 shrink-0">
      <span class="text-[9px] text-text-muted">{{ time }}</span>
      <span
        v-if="unread > 0"
        class="w-2 h-2 rounded-full bg-brand"
      />
    </div>
  </button>
</template>
