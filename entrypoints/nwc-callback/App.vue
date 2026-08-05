<script setup>
/**
 * NWC Deep Link Confirmation Page
 *
 * This web-accessible extension page receives the one-time NUTbits redirect,
 * immediately scrubs the wallet secret from the address bar, and hands it to
 * the trusted background worker. No localhost process or third-party callback
 * server sees the NWC connection string.
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle, AlertTriangle, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()

const phase = ref('connecting') // connecting | success | error
const errorMsg = ref('')

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const value = params.get('value')
  const token = params.get('token')
  history.replaceState(null, '', window.location.pathname)
  if (!value || !token) {
    phase.value = 'error'
    errorMsg.value = t(!value ? 'nutbits.callbackNoValue' : 'nutbits.callbackConnectFailed')
    return
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'NUTBITS_CALLBACK',
      params: [{ value, token }],
    })
    if (response?.error) throw new Error(response.error)
    phase.value = 'success'
    setTimeout(() => window.close(), 3000)
  } catch {
    phase.value = 'error'
    errorMsg.value = t('nutbits.callbackConnectFailed')
  }
})

function closeTab() {
  window.close()
}
</script>

<template>
  <div class="min-h-screen bg-surface-base flex items-center justify-center p-6">
    <div class="w-full max-w-sm text-center space-y-6 animate-fade-in">

      <template v-if="phase === 'connecting'">
        <img src="/logo/logo.svg" alt="Buho Jump" class="w-14 h-14 mx-auto" />
        <Loader2 class="w-8 h-8 text-brand animate-spin mx-auto" />
        <p class="text-sm text-text-muted">{{ t('common.working') }}</p>
      </template>

      <!-- Success -->
      <template v-else-if="phase === 'success'">
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
