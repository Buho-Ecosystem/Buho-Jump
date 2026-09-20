<script setup>
/** Stable primary destinations, with account access first. */
import { useI18n } from 'vue-i18n'
import { Wallet, MessageSquare, User } from 'lucide-vue-next'
defineProps({ activeTab: { type: String, required: true }, unreadCount: { type: Number, default: 0 } })
const emit = defineEmits(['update:activeTab'])
const { t } = useI18n()
const tabs = [
  { id: 'identity', label: 'tabs.account', icon: User },
  { id: 'wallet', label: 'tabs.wallet', icon: Wallet },
  { id: 'chat', label: 'tabs.chat', icon: MessageSquare },
]
function moveFocus(event, index) {
  let next
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  emit('update:activeTab', tabs[next].id)
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus()
}
</script>

<template>
  <nav class="bottom-tabs" role="tablist" aria-label="Buho Jump">
    <button v-for="(tab, index) in tabs" :key="tab.id" :id="`tab-${tab.id}`"
      class="bottom-tab" :class="{ active: activeTab === tab.id }" role="tab"
      :aria-selected="activeTab === tab.id" aria-controls="primary-tab-panel"
      :tabindex="activeTab === tab.id ? 0 : -1"
      @click="emit('update:activeTab', tab.id)" @keydown="moveFocus($event, index)">
      <component :is="tab.icon" class="w-4 h-4" />{{ t(tab.label) }}
      <span v-if="tab.id === 'chat' && unreadCount > 0" class="chat-unread-badge">{{ unreadCount }}</span>
    </button>
  </nav>
</template>
