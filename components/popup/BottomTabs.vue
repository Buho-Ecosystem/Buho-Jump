<script setup>
/**
 * Bottom tab bar — Wallet and Chat tabs.
 */
import { useI18n } from 'vue-i18n'
import { Wallet, MessageSquare } from 'lucide-vue-next'

defineProps({
  activeTab: { type: String, required: true },
  unreadCount: { type: Number, default: 0 },
})

defineEmits(['update:activeTab'])
const { t } = useI18n()
</script>

<template>
  <nav class="bottom-tabs" role="tablist">
    <button
      @click="$emit('update:activeTab', 'wallet')"
      class="bottom-tab"
      :class="{ active: activeTab === 'wallet' }"
      role="tab"
      :aria-selected="activeTab === 'wallet'"
    >
      <Wallet class="w-4 h-4" />
      {{ t('tabs.wallet') }}
    </button>
    <button
      @click="$emit('update:activeTab', 'chat')"
      class="bottom-tab"
      :class="{ active: activeTab === 'chat' }"
      role="tab"
      :aria-selected="activeTab === 'chat'"
    >
      <MessageSquare class="w-4 h-4" />
      {{ t('tabs.chat') }}
      <span
        v-if="unreadCount > 0 && activeTab !== 'chat'"
        class="tab-badge"
      />
    </button>
  </nav>
</template>
