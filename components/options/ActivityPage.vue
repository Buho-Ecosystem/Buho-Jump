<script setup>
/** Full-browser transaction activity with the exact same rows and receipts as the popup. */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import TransactionHistory from '../wallet/TransactionHistory.vue'
import TransactionDetail from '../wallet/TransactionDetail.vue'
import SendFlow from '../wallet/SendFlow.vue'
import ReceiveFlow from '../wallet/ReceiveFlow.vue'
import EmptyState from '../EmptyState.vue'
import { Wallet, Loader2, ArrowUpRight, ArrowDownLeft } from 'lucide-vue-next'

const { t } = useI18n()
const { status, wallets, loadStatus, loadWallets, switchWallet } = useWallet()
const loading = ref(true)
const selectedTransaction = ref(null)
const historyKey = ref(0)
const mode = ref('activity')

onMounted(async () => {
  try { await Promise.all([loadStatus(), loadWallets()]) }
  finally { loading.value = false }
})

async function selectWallet(event) {
  loading.value = true
  try {
    await switchWallet(event.target.value)
    await loadStatus()
    selectedTransaction.value = null
    mode.value = 'activity'
    historyKey.value++
  } finally {
    loading.value = false
  }
}

function finishPaymentFlow() {
  mode.value = 'activity'
  historyKey.value++
  loadStatus().catch(() => {})
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-extrabold">{{ t('options.activity') }}</h1>
        <p class="text-xs text-text-muted mt-0.5">{{ t('options.activityDesc') }}</p>
      </div>
      <select v-if="wallets.length > 1" :value="status.activeWallet?.id" @change="selectWallet"
        class="bg-surface-card border border-border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-brand">
        <option v-for="wallet in wallets" :key="wallet.id" :value="wallet.id">{{ wallet.name }}</option>
      </select>
    </div>

    <div v-if="!loading && status.activeWallet && mode === 'activity' && !selectedTransaction" class="grid grid-cols-2 gap-3 max-w-2xl mx-auto">
      <button @click="mode = 'send'" class="flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand text-surface-base text-sm font-bold btn-primary">
        <ArrowUpRight class="w-4 h-4" />{{ t('wallet.send') }}
      </button>
      <button @click="mode = 'receive'" class="flex items-center justify-center gap-2 py-3 rounded-2xl bg-success text-white text-sm font-bold">
        <ArrowDownLeft class="w-4 h-4" />{{ t('wallet.receive') }}
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-16"><Loader2 class="w-6 h-6 text-brand animate-spin" /></div>
    <EmptyState v-else-if="!status.activeWallet" :icon="Wallet" illustration="/Onboarding%20wizard/storyset-ewallet-bro.svg" :title="t('wallet.noWallet')" :description="t('wallet.noWalletHomeDesc')" />
    <div v-else-if="mode === 'send'" class="max-w-md mx-auto bg-surface-base rounded-3xl border border-border shadow-sm"><SendFlow @back="mode = 'activity'" @done="finishPaymentFlow" /></div>
    <div v-else-if="mode === 'receive'" class="max-w-md mx-auto bg-surface-base rounded-3xl border border-border shadow-sm"><ReceiveFlow @back="mode = 'activity'" @done="finishPaymentFlow" /></div>
    <TransactionDetail v-else-if="selectedTransaction" :tx="selectedTransaction" full-page @close="selectedTransaction = null" />
    <TransactionHistory v-else :key="historyKey" full-page @detail="selectedTransaction = $event" />
  </div>
</template>
