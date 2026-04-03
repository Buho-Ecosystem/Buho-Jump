<script setup>
/**
 * NWC Deep Link Confirmation Page
 *
 * Background.js intercepts the NUTbits redirect, stores the wallet, then
 * navigates this tab to nwc-callback.html?success=1 or ?error=<code>.
 * This page simply renders the appropriate confirmation state.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle, AlertTriangle } from 'lucide-vue-next'

const { t } = useI18n()

const phase = ref('success') // success | error
const errorMsg = ref('')

onMounted(() => {
  const params = new URLSearchParams(window.location.search)

  if (params.has('success')) {
    phase.value = 'success'
    setTimeout(() => window.close(), 3000)
    return
  }

  phase.value = 'error'
  const err = params.get('error')
  const errorMap = {
    no_value: 'nutbits.callbackNoValue',
    invalid: 'nutbits.callbackInvalid',
    connect_failed: 'nutbits.callbackConnectFailed',
  }
  errorMsg.value = t(errorMap[err] || 'nutbits.callbackConnectFailed')
})

function closeTab() {
  window.close()
}
</script>

<template>
  <div class="min-h-screen bg-surface-base flex items-center justify-center p-6">
    <div class="w-full max-w-sm text-center space-y-6 animate-fade-in">

      <!-- Success -->
      <template v-if="phase === 'success'">
        <div class="flex items-center justify-center gap-5">
          <img src="/logo/logo.svg" alt="Buho Jump" class="w-14 h-14" />
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-success animate-pulse" />
            <div class="w-10 h-px bg-success/40" />
            <div class="w-2 h-2 rounded-full bg-success animate-pulse" style="animation-delay: 0.2s" />
          </div>
          <img src="/NUTbits/pixel-nut-v2b-128.png" alt="NUTbits" class="w-14 h-14 rounded-xl" />
        </div>

        <div class="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
          <CheckCircle class="w-8 h-8 text-success" />
        </div>

        <div class="space-y-2">
          <p class="text-lg font-extrabold">{{ t('nutbits.callbackSuccess') }}</p>
          <p class="text-sm text-text-muted leading-relaxed">{{ t('nutbits.callbackSuccessDesc') }}</p>
        </div>

        <div class="mx-auto w-48 h-1 rounded-full bg-surface-card overflow-hidden">
          <div class="h-full bg-success rounded-full animate-shrink" />
        </div>
        <p class="text-[10px] text-text-muted">{{ t('nutbits.callbackClosing') }}</p>
      </template>

      <!-- Error -->
      <template v-else>
        <div class="flex items-center justify-center gap-5">
          <img src="/logo/logo.svg" alt="Buho Jump" class="w-14 h-14" />
          <div class="flex items-center gap-1.5">
            <div class="w-2 h-2 rounded-full bg-error/60" />
            <div class="w-10 h-px bg-error/20" />
            <div class="w-2 h-2 rounded-full bg-error/60" />
          </div>
          <img src="/NUTbits/pixel-nut-v2b-128.png" alt="NUTbits" class="w-14 h-14 rounded-xl opacity-60" />
        </div>

        <div class="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mx-auto">
          <AlertTriangle class="w-8 h-8 text-error" />
        </div>

        <div class="space-y-2">
          <p class="text-lg font-extrabold text-error">{{ t('nutbits.callbackFailed') }}</p>
          <p class="text-sm text-text-muted leading-relaxed">{{ errorMsg }}</p>
        </div>

        <button
          @click="closeTab"
          class="px-8 py-2.5 text-sm rounded-2xl bg-surface-card border border-border hover:bg-surface-elevated transition-all duration-200 font-semibold"
        >
          {{ t('common.done') }}
        </button>
      </template>
    </div>
  </div>
</template>

<style>
@keyframes shrink {
  from { width: 100%; }
  to { width: 0%; }
}
.animate-shrink {
  animation: shrink 3s linear forwards;
}
</style>
