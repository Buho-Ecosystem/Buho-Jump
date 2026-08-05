<script setup>
/**
 * Empty wallet state — shown when no NWC wallet is connected.
 * Clean, focused CTA to connect a wallet + feature hints.
 */
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, ArrowDownLeft, Zap, Link } from 'lucide-vue-next'

defineEmits(['connect-wallet'])
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center text-center animate-fade-in-up pt-4">

    <img src="/Onboarding%20wizard/storyset-ewallet-bro.svg" alt="" class="w-40 h-28 object-contain mb-2" />

    <!-- Heading -->
    <h2 class="text-[15px] font-extrabold leading-tight mb-1.5">
      {{ t('wallet.noWallet') }}
    </h2>
    <p class="text-xs text-text-muted leading-relaxed max-w-[220px] mb-6">
      {{ t('wallet.noWalletHomeDesc') }}
    </p>

    <!-- Connect CTA -->
    <button
      @click="$emit('connect-wallet')"
      class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover transition-all duration-200 active:scale-[0.98] btn-primary mb-6"
    >
      <Link class="w-4 h-4" />
      {{ t('wallet.connectWallet') }}
    </button>

    <!-- Feature hints -->
    <div class="w-full space-y-2">
      <div class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-surface-card border border-border">
        <div class="w-8 h-8 rounded-xl bg-brand/8 flex items-center justify-center shrink-0">
          <ArrowUpRight class="w-4 h-4 text-brand" />
        </div>
        <span class="text-xs text-text-secondary font-medium">{{ t('wallet.noWalletFeatureSend') }}</span>
      </div>
      <div class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-surface-card border border-border">
        <div class="w-8 h-8 rounded-xl bg-success/8 flex items-center justify-center shrink-0">
          <ArrowDownLeft class="w-4 h-4 text-success" />
        </div>
        <span class="text-xs text-text-secondary font-medium">{{ t('wallet.noWalletFeatureReceive') }}</span>
      </div>
      <div class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-surface-card border border-border">
        <div class="w-8 h-8 rounded-xl bg-warning/8 flex items-center justify-center shrink-0">
          <Zap class="w-4 h-4 text-warning" />
        </div>
        <span class="text-xs text-text-secondary font-medium">{{ t('wallet.noWalletFeatureZap') }}</span>
      </div>
    </div>
  </div>
</template>
