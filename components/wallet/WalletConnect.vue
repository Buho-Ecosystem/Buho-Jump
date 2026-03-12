<script setup>
/**
 * Wallet connection screen — paste NWC URI or scan QR.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'

const { t } = useI18n()
import QrScanner from '../QrScanner.vue'
import { Link, ScanLine, Loader2 } from 'lucide-vue-next'

const { connect, connecting } = useWallet()
const toast = useToast()

const nwcUri = ref('')
const showScanner = ref(false)
const error = ref('')

async function handleConnect() {
  if (!nwcUri.value.trim()) return
  error.value = ''
  try {
    await connect(nwcUri.value.trim())
    nwcUri.value = ''
    toast.success(t('wallet.walletConnected'))
  } catch (err) {
    error.value = err.message || t('wallet.connectFailed')
    toast.error(error.value)
  }
}

function onScan(val) {
  nwcUri.value = val
  showScanner.value = false
}
</script>

<template>
  <div class="space-y-4 animate-fade-in-up">

    <div class="flex flex-col items-center gap-3 py-2">
      <img src="/nwc/nwc-logo.svg" alt="NWC" class="w-16 h-16" />
      <div class="text-center">
        <p class="text-sm font-extrabold text-text-primary">{{ t('wallet.noWallet') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('wallet.noWalletDesc') }}</p>
      </div>
    </div>

    <div class="flex items-center justify-end">
      <button
        @click="showScanner = !showScanner"
        class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium"
      >
        <ScanLine class="w-3 h-3" />
        {{ showScanner ? t('common.typeInstead') : t('common.scanQr') }}
      </button>
    </div>

    <QrScanner
      v-if="showScanner"
      @scan="onScan"
      @close="showScanner = false"
    />

    <input
      v-else
      v-model="nwcUri"
      placeholder="nostr+walletconnect://..."
      class="w-full bg-surface-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-all duration-200 font-mono placeholder:text-text-muted"
    />

    <button
      @click="handleConnect"
      :disabled="!nwcUri.trim() || connecting"
      class="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-semibold btn-primary"
    >
      <Loader2 v-if="connecting" class="w-4 h-4 animate-spin" />
      <Link v-else class="w-4 h-4" />
      {{ connecting ? t('wallet.connecting') : t('wallet.connectWallet') }}
    </button>
  </div>
</template>
