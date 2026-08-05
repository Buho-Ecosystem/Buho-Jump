<script setup>
/**
 * Options page sidebar navigation.
 * Vertical nav with icons, collapses to horizontal on small screens.
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
  <nav class="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface-card shadow-md p-3 gap-0.5 sticky top-0 h-screen overflow-y-auto">
    <div class="flex items-center gap-2 px-3 py-3 mb-3">
      <img src="/logo/logo.svg" alt="Buho Jump" class="w-10 h-10 rounded-[10px]" />
      <span class="font-bold text-sm tracking-tight">Buho Jump</span>
    </div>

    <button
      v-for="item in navItems"
      :key="item.id"
      @click="emit('navigate', item.id)"
      class="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all duration-200 text-sm font-medium"
      :class="activePage === item.id
        ? 'bg-brand/10 text-brand'
        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'"
    >
      <component :is="item.icon" class="w-4 h-4 shrink-0" />
      <span>{{ item.label() }}</span>
    </button>
  </nav>

  <!-- Mobile top nav -->
  <nav class="md:hidden flex items-center gap-1 px-3 py-2 border-b border-border bg-surface-card overflow-x-auto">
    <div class="flex items-center gap-1.5 mr-3 shrink-0">
      <img src="/logo/logo.svg" alt="Buho Jump" class="w-6 h-6 rounded-md" />
      <span class="font-bold text-xs tracking-tight">Buho</span>
    </div>

    <button
      v-for="item in navItems"
      :key="item.id"
      @click="emit('navigate', item.id)"
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0"
      :class="activePage === item.id
        ? 'bg-brand/10 text-brand'
        : 'text-text-muted hover:bg-surface-elevated hover:text-text-secondary'"
    >
      <component :is="item.icon" class="w-3.5 h-3.5" />
      <span>{{ item.label() }}</span>
    </button>
  </nav>
</template>
