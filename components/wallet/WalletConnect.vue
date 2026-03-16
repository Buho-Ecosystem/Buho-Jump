<script setup>
/**
 * Wallet connection screen — paste NWC URI or scan QR.
 * Supports naming the wallet for multi-wallet management.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'

const { t } = useI18n()
import QrScanner from '../QrScanner.vue'
import { Link, ScanLine, Loader2, ArrowLeft } from 'lucide-vue-next'

const emit = defineEmits(['back'])

const { connect, connecting, wallets } = useWallet()
const toast = useToast()

const nwcUri = ref('')
const walletName = ref('')
const showScanner = ref(false)
const error = ref('')

// Show back button if user already has wallets (adding another)
const hasExistingWallets = wallets.value.length > 0

async function handleConnect() {
  if (!nwcUri.value.trim()) return
  error.value = ''
  try {
    await connect(nwcUri.value.trim(), walletName.value.trim() || undefined)
    nwcUri.value = ''
    walletName.value = ''
    toast.success(t('wallet.walletConnected'))
    emit('back')
  } catch (err) {
    error.value = err.message || t('wallet.connectFailedDetail')
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

    <!-- Back button when adding another wallet -->
    <button
      v-if="hasExistingWallets"
      @click="emit('back')"
      class="flex items-center gap-1 text-xs text-text-muted hover:text-brand transition-colors"
    >
      <ArrowLeft class="w-3.5 h-3.5" />
      {{ t('common.back') }}
    </button>

    <div class="flex flex-col items-center gap-3 py-2">
      <img src="/nwc/nwc-logo.svg" alt="NWC" class="w-16 h-16" />
      <div class="text-center">
        <p class="text-sm font-extrabold text-text-primary">
          {{ hasExistingWallets ? t('wallet.addWallet') : t('wallet.noWallet') }}
        </p>
        <p class="text-xs text-text-muted mt-1">{{ t('wallet.noWalletDesc') }}</p>
      </div>
    </div>

    <!-- Wallet name -->
    <input
      v-model="walletName"
      :placeholder="t('wallet.walletName')"
      class="w-full bg-surface-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-all duration-200 placeholder:text-text-muted"
    />

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

    <div v-else class="space-y-1.5">
      <input
        v-model="nwcUri"
        placeholder="nostr+walletconnect://..."
        class="w-full bg-surface-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand transition-all duration-200 font-mono placeholder:text-text-muted"
      />
      <p class="text-[10px] text-text-muted px-1 leading-relaxed">{{ t('wallet.nwcHelp') }}</p>
    </div>

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
