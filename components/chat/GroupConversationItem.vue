<script setup>
/**
 * Group conversation row — shows group picture, name, member count,
 * last message preview with sender name, and unread badge.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { useGroups } from '../../composables/useGroups.js'
import { formatTimestamp } from '../../lib/utils.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import { Users, Lock, Globe } from 'lucide-vue-next'

const { t } = useI18n()
const { getCachedProfile } = useContacts()
const { currentAccountPubkey } = useGroups()

const props = defineProps({
  group: { type: Object, required: true },
  lastMessage: { type: Object, default: null },
  unread: { type: Number, default: 0 },
})

defineEmits(['click'])

const avatarColor = computed(() => getAvatarColor(props.group.id))
const avatarLetter = computed(() => (props.group.name || '?')[0].toUpperCase())

const preview = computed(() => {
  if (!props.lastMessage) return t('group.noGroupsDesc')
  const isMe = props.lastMessage.sender === currentAccountPubkey.value
  const senderProfile = getCachedProfile(props.lastMessage.sender)
  const senderName = isMe ? t('chat.you') : (senderProfile?.display_name || senderProfile?.name || props.lastMessage.sender?.slice(0, 8) + '...')
  return `${senderName}: ${props.lastMessage.content}`
})

const time = computed(() => {
  if (!props.lastMessage) return ''
  return formatTimestamp(props.lastMessage.created_at, t)
})
</script>

<template>
  <button
    @click="$emit('click')"
    class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left"
  >
    <!-- Group avatar -->
    <div class="relative">
      <div
        class="w-[48px] h-[48px] rounded-full shrink-0 overflow-hidden flex items-center justify-center"
        :style="!group.picture?.length ? { background: avatarColor } : {}"
      >
        <img v-if="group.picture?.length" :src="group.picture" alt="" class="w-full h-full object-cover" @error="group.picture = null" />
        <span v-else class="text-base font-semibold text-white">{{ avatarLetter }}</span>
      </div>
      <!-- Type badge -->
      <div class="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-card border border-border flex items-center justify-center">
        <Lock v-if="group.type === 'private'" class="w-2.5 h-2.5 text-brand" />
        <Globe v-else-if="group.type === 'channel'" class="w-2.5 h-2.5 text-success" />
        <Users v-else class="w-2.5 h-2.5 text-info" />
      </div>
    </div>

    <!-- Text block -->
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[13px] font-semibold truncate">{{ group.name || group.id }}</span>
        <span class="text-[11px] shrink-0" :class="unread > 0 ? 'text-brand font-medium' : 'text-text-muted'">
          {{ time }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <span class="text-[12px] text-text-secondary truncate">{{ preview }}</span>
        <span v-if="unread > 0" class="chat-unread-badge shrink-0">
          {{ unread > 99 ? '99+' : unread }}
        </span>
      </div>
    </div>
  </button>
</template>
