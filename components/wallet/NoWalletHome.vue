<script setup>
/**
 * Home screen for users without a connected wallet.
 * Shows identity card + connect wallet CTA + quick actions.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { truncateKey } from '../../lib/utils.js'
import { MessageCircle, Settings, Copy, Check } from 'lucide-vue-next'
import { ref } from 'vue'

const props = defineProps({
  displayName: { type: String, default: '' },
  npub: { type: String, default: '' },
  profilePicture: { type: String, default: '' },
  avatarColor: { type: String, default: '' },
})

const emit = defineEmits(['connect-wallet', 'open-chat', 'open-settings'])
const { t } = useI18n()

const copied = ref(false)
const initial = computed(() => (props.displayName || '?')[0].toUpperCase())

function copyNpub() {
  if (!props.npub) return
  navigator.clipboard.writeText(props.npub)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div class="space-y-3 animate-fade-in-up">

    <!-- Identity card -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-4">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
          :style="!profilePicture ? { background: avatarColor || 'var(--brand-primary)' } : {}">
          <img v-if="profilePicture" :src="profilePicture" alt="" class="w-full h-full object-cover" />
          <span v-else class="text-white text-lg font-bold">{{ initial }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-extrabold truncate">{{ displayName || 'Anonymous' }}</div>
          <button v-if="npub" @click="copyNpub"
            class="flex items-center gap-1 mt-0.5 text-[10px] text-text-muted hover:text-brand transition-colors group">
            <span class="font-mono truncate">{{ truncateKey(npub, 12, 6) }}</span>
            <Check v-if="copied" class="w-2.5 h-2.5 text-success shrink-0" />
            <Copy v-else class="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        </div>
      </div>
    </div>

    <!-- Connect wallet CTA -->
    <button @click="emit('connect-wallet')"
      class="w-full bg-surface-card rounded-3xl border border-brand/20 shadow-sm p-5 text-left group hover:border-brand/40 transition-all duration-300">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0 group-hover:bg-brand/15 transition-colors">
          <img src="/nwc/nwc-logo.svg" alt="" class="w-7 h-7" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-extrabold group-hover:text-brand transition-colors">
            {{ t('wallet.connectWallet') }}
          </div>
          <p class="text-[11px] text-text-muted mt-0.5 leading-relaxed">
            {{ t('wallet.noWalletHomeDesc') }}
          </p>
        </div>
      </div>
    </button>

    <!-- Quick actions -->
    <div class="grid grid-cols-2 gap-2">
      <button @click="emit('open-chat')"
        class="flex items-center justify-center gap-2 py-3 rounded-3xl bg-surface-card border border-border shadow-sm text-[12px] font-semibold text-text-secondary hover:border-brand/20 hover:text-brand transition-all duration-200">
        <MessageCircle class="w-4 h-4" />
        {{ t('tabs.chat') }}
      </button>
      <button @click="emit('open-settings')"
        class="flex items-center justify-center gap-2 py-3 rounded-3xl bg-surface-card border border-border shadow-sm text-[12px] font-semibold text-text-secondary hover:border-brand/20 hover:text-brand transition-all duration-200">
        <Settings class="w-4 h-4" />
        {{ t('common.settings') }}
      </button>
    </div>
  </div>
</template>
