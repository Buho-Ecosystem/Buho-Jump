<script setup>
/**
 * Options page sidebar navigation.
 * Sidebar on wide windows; a labelled destination picker when space is limited.
 */
import { useI18n } from 'vue-i18n'
import { Globe, User, Wallet, MessageSquare, Radio, Sliders, Info, ReceiptText } from 'lucide-vue-next'

defineProps({ activePage: { type: String, required: true } })
const emit = defineEmits(['navigate'])
const { t } = useI18n()

const navItems = [
  { id: 'sites', icon: Globe, label: () => t('options.sites') },
  { id: 'account', icon: User, label: () => t('options.account') },
  { id: 'wallets', icon: Wallet, label: () => t('options.wallets') },
  { id: 'activity', icon: ReceiptText, label: () => t('options.activity') },
  { id: 'messaging', icon: MessageSquare, label: () => t('options.messaging') },
  { id: 'relays', icon: Radio, label: () => t('options.relays') },
  { id: 'preferences', icon: Sliders, label: () => t('options.preferences') },
  { id: 'about', icon: Info, label: () => t('options.about') },
]
</script>

<template>
  <!-- Desktop sidebar -->
  <nav :aria-label="t('settings.allSettings')" class="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface-card shadow-md p-3 gap-0.5 sticky top-0 h-screen overflow-y-auto">
    <div class="flex items-center gap-2 px-3 py-3 mb-3">
      <img src="/logo/logo.svg" alt="Buho Jump" class="w-10 h-10 rounded-[10px]" />
      <span class="font-bold text-sm tracking-tight">Buho Jump</span>
    </div>

    <button
      v-for="item in navItems"
      :key="item.id"
      @click="emit('navigate', item.id)"
      :aria-current="activePage === item.id ? 'page' : undefined"
      class="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all duration-200 text-sm font-medium"
      :class="activePage === item.id
        ? 'bg-brand/10 text-brand'
        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'"
    >
      <component :is="item.icon" class="w-4 h-4 shrink-0" />
      <span>{{ item.label() }}</span>
    </button>
  </nav>

  <nav :aria-label="t('settings.allSettings')" class="md:hidden flex items-center gap-3 p-4 border-b border-border bg-surface-card">
    <img src="/logo/logo.svg" alt="Buho Jump" class="w-8 h-8 shrink-0" />
    <label class="flex-1 min-w-0 space-y-1 text-sm font-medium">
      <span>{{ t('settings.allSettings') }}</span>
      <select :value="activePage" @change="emit('navigate', $event.target.value)"
        class="block w-full min-h-11 rounded-xl border border-border bg-surface-base px-3 text-text-primary">
        <option v-for="item in navItems" :key="item.id" :value="item.id">{{ item.label() }}</option>
      </select>
    </label>
  </nav>
</template>
