<script setup>
/**
 * Wallet home — balance card, quick actions, recent transactions.
 * Tap the balance to toggle between sats and fiat primary display.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat } from '../../composables/useFiat.js'

const { t } = useI18n()
import { formatSats } from '../../lib/utils.js'
import TransactionItem from './TransactionItem.vue'
import BottomSheet from '../BottomSheet.vue'
import {
  ArrowUpRight, ArrowDownLeft, RefreshCw, ArrowLeftRight,
  Unlink, ChevronRight, Zap, Loader2, AlertTriangle,
} from 'lucide-vue-next'

const emit = defineEmits(['send', 'receive', 'history', 'detail', 'disconnect'])

const { status, walletType, getBalance, getBudget, getInfo, listTransactions } = useWallet()
const toast = useToast()
const { toFiat, denomination, toggleDenomination, loadRate, currency } = useFiat()

const fiatBalance = computed(() => {
  if (status.value.balance == null) return null
  return toFiat(status.value.balance)
})

const recentTxs = ref([])
const loadingTxs = ref(false)
const refreshing = ref(false)
const walletBudget = ref(null)
const nwcConnected = ref(true)
const confirmDisconnect = ref(false)
const disconnecting = ref(false)

async function loadTransactions() {
  loadingTxs.value = true
  try {
    const result = await listTransactions({ limit: 5 })
    recentTxs.value = result?.transactions || []
  } catch {
    recentTxs.value = []
  } finally {
    loadingTxs.value = false
  }
}

async function refresh() {
  refreshing.value = true
  const prevBalance = status.value.balance
  try {
    await Promise.all([getBalance(), loadTransactions()])
    const newBalance = status.value.balance
    if (prevBalance != null && newBalance != null && newBalance !== prevBalance) {
      const diff = newBalance - prevBalance
      const sign = diff > 0 ? '+' : ''
      toast.success(`${t('wallet.balanceUpdated')} (${sign}${formatSats(diff)})`)
    } else {
      toast.success(t('wallet.balanceUpdated'))
    }
  } catch {
    toast.error(t('wallet.failedRefresh'))
  } finally {
    refreshing.value = false
  }
}

async function handleDisconnect() {
  disconnecting.value = true
  try {
    emit('disconnect')
  } finally {
    disconnecting.value = false
    confirmDisconnect.value = false
  }
}

let nwcPollTimer = null

onMounted(() => {
  loadTransactions()
  loadRate()
  // Load wallet-side budget (NWC only — Cashu/LNbits have no budget concept)
  if (walletType.value === 'nwc') {
    getBudget().then(b => { walletBudget.value = b }).catch(() => {})
  }
  // Poll NWC connection status (only for NWC — Cashu/LNbits are always "connected")
  if (walletType.value === 'nwc') {
    const checkNwc = () => {
      chrome.runtime.sendMessage({ type: 'GET_NWC_STATUS' })
        .then(res => { nwcConnected.value = res?.result?.connected !== false })
        .catch(() => {})
    }
    checkNwc()
    nwcPollTimer = setInterval(checkNwc, 10000)
  } else {
    nwcConnected.value = true
  }
})

onBeforeUnmount(() => {
  if (nwcPollTimer) clearInterval(nwcPollTimer)
})
</script>

<template>
  <div class="space-y-4 animate-fade-in-up">

    <!-- Balance card -->
    <div class="relative overflow-hidden bg-surface-card rounded-3xl border border-border p-5 shadow-md">
      <div class="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-brand/5 blur-2xl" />

      <div class="relative">
        <!-- Header row: status dot + refresh -->
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-1.5">
            <div class="w-1.5 h-1.5 rounded-full transition-colors"
              :class="nwcConnected ? 'bg-success' : 'bg-warning animate-pulse'" />
            <span class="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
              {{ nwcConnected ? t('wallet.balance') : t('wallet.reconnecting') }}
            </span>
          </div>
          <button
            @click="refresh"
            :disabled="refreshing"
            :aria-label="t('wallet.refresh')"
            class="p-1 rounded-lg hover:bg-surface-elevated transition-all duration-200"
          >
            <RefreshCw
              class="w-3 h-3 text-text-muted"
              :class="refreshing ? 'animate-spin' : ''"
            />
          </button>
        </div>

        <!-- Tappable balance — tap to toggle denomination -->
        <button
          @click="toggleDenomination"
          class="w-full text-center mb-4 group cursor-pointer select-none"
        >
          <template v-if="denomination === 'sats'">
            <!-- Primary: sats with unit inline -->
            <div class="flex items-baseline justify-center gap-1.5">
              <span class="text-3xl font-extrabold tracking-tight leading-none">
                {{ status.balance != null ? formatSats(status.balance) : '—' }}
              </span>
              <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
            </div>
            <!-- Secondary: fiat — in brand green -->
            <div v-if="fiatBalance" class="text-[11px] text-brand mt-1 font-medium">≈ {{ fiatBalance }}</div>
          </template>

          <template v-else>
            <!-- Primary: fiat -->
            <div class="text-3xl font-extrabold tracking-tight leading-none">
              {{ fiatBalance || '—' }}
            </div>
            <!-- Secondary: sats — in brand green -->
            <div v-if="status.balance != null" class="text-[11px] text-brand mt-1 font-medium">
              ≈ {{ formatSats(status.balance) }} {{ t('wallet.sats') }}
            </div>
          </template>

          <!-- Toggle hint on hover -->
          <div class="flex items-center justify-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowLeftRight class="w-2.5 h-2.5 text-text-muted" />
            <span class="text-[8px] text-text-muted">{{ denomination === 'sats' ? currency.toUpperCase() : t('wallet.sats') }}</span>
          </div>
        </button>

        <!-- Wallet-side budget (NWC only) -->
        <div v-if="walletType === 'nwc' && walletBudget?.used_budget != null" class="text-center mb-1">
          <span class="text-[9px] text-text-muted">
            {{ t('wallet.nwcBudget', {
              used: formatSats(Math.floor((walletBudget.used_budget || 0) / 1000)),
              total: formatSats(Math.floor((walletBudget.total_budget || 0) / 1000)),
            }) }}
          </span>
        </div>

        <!-- Quick actions — flat solid colors, no gradient/glow -->
        <div class="grid grid-cols-2 gap-3">
          <button
            @click="emit('send')"
            class="flex flex-col items-center justify-center gap-1 py-4 rounded-2xl text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] btn-action-send"
          >
            <ArrowUpRight class="w-5 h-5" />
            <span>{{ t('wallet.send') }}</span>
          </button>
          <button
            @click="emit('receive')"
            class="flex flex-col items-center justify-center gap-1 py-4 rounded-2xl text-white text-sm font-semibold transition-all duration-200 active:scale-[0.98] btn-action-receive"
          >
            <ArrowDownLeft class="w-5 h-5" />
            <span>{{ t('wallet.receive') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Recent transactions -->
    <div class="space-y-2">
      <div class="flex items-center justify-between px-1">
        <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{{ t('wallet.recent') }}</span>
        <button
          v-if="recentTxs.length > 0"
          @click="emit('history')"
          class="flex items-center gap-0.5 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium"
        >
          {{ t('wallet.viewAll') }} <ChevronRight class="w-3 h-3" />
        </button>
      </div>

      <div v-if="loadingTxs" class="space-y-2">
        <div v-for="i in 3" :key="i" class="skeleton-shimmer h-12 rounded-3xl" />
      </div>

      <div v-else-if="recentTxs.length > 0" class="space-y-1">
        <TransactionItem
          v-for="tx in recentTxs"
          :key="tx.payment_hash"
          :tx="tx"
          @click="emit('detail', tx)"
        />
      </div>

      <div v-else class="bg-surface-card rounded-3xl border border-border p-6 text-center shadow-sm">
        <Zap class="w-5 h-5 text-text-muted mx-auto mb-2" />
        <p class="text-xs text-text-muted">{{ t('wallet.noTransactions') }}</p>
        <p class="text-[10px] text-text-muted mt-0.5">{{ t('wallet.noTransactionsHint') }}</p>
      </div>
    </div>

    <!-- Disconnect -->
    <button
      @click="confirmDisconnect = true"
      class="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-text-muted hover:text-error transition-all duration-200"
    >
      <Unlink class="w-3 h-3" />
      {{ t('wallet.disconnectWallet') }}
    </button>

    <BottomSheet :open="confirmDisconnect" variant="danger" @close="confirmDisconnect = false">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #title>{{ t('wallet.disconnectTitle') }}</template>
      <template #description>{{ t('wallet.disconnectDesc') }}</template>
      <template #actions>
        <button @click="confirmDisconnect = false"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleDisconnect"
          :disabled="disconnecting"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="disconnecting" class="w-3 h-3 animate-spin" />
          {{ disconnecting ? t('wallet.disconnecting') : t('wallet.disconnect') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
