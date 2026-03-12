<script setup>
/**
 * Transaction detail — clean layout with user-friendly info up front
 * and technical details (hashes, preimage) hidden behind a toggle.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFiat } from '../../composables/useFiat.js'
import { formatSats, formatFullDate, msatsToSats, truncateKey } from '../../lib/utils.js'

const { t } = useI18n()
const { toFiat } = useFiat()
import {
  ArrowUpRight, ArrowDownLeft, Clock, AlertCircle,
  X, Copy, Check, ChevronDown, Zap, Code,
} from 'lucide-vue-next'

const props = defineProps({
  tx: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const copiedField = ref('')
const showTechnical = ref(false)

const isIncoming = computed(() => props.tx.type === 'incoming')
const amount = computed(() => msatsToSats(props.tx.amount || 0))
const fiatAmount = computed(() => amount.value > 0 ? toFiat(amount.value) : null)

const feesPaid = computed(() => {
  if (!props.tx.fees_paid) return null
  return msatsToSats(props.tx.fees_paid)
})
const fiatFees = computed(() => feesPaid.value > 0 ? toFiat(feesPaid.value) : null)

const txState = computed(() => {
  const state = props.tx.state
  if (state === 'settled') return 'settled'
  if (state === 'failed') return 'failed'
  if (state === 'accepted') return 'pending'
  if (props.tx.settled_at) return 'settled'
  if (props.tx.expires_at && props.tx.expires_at < Math.floor(Date.now() / 1000)) return 'expired'
  return state === 'pending' ? 'pending' : (state || 'settled')
})

const statusLabel = computed(() => {
  if (txState.value === 'pending') return t('wallet.statusPending')
  if (txState.value === 'expired') return t('wallet.statusExpired')
  if (txState.value === 'failed') return t('wallet.statusFailed')
  return isIncoming.value ? t('wallet.statusReceived') : t('wallet.statusSent')
})

const typeLabel = computed(() => {
  return isIncoming.value ? t('wallet.typeReceived') : t('wallet.typeSent')
})

const statusColor = computed(() => {
  if (txState.value === 'pending') return 'text-warning bg-warning/10'
  if (txState.value === 'expired' || txState.value === 'failed') return 'text-error bg-error/10'
  return isIncoming.value ? 'text-incoming bg-incoming/10' : 'text-outgoing bg-outgoing/10'
})

const statusIcon = computed(() => {
  if (txState.value === 'pending') return Clock
  if (txState.value === 'expired' || txState.value === 'failed') return AlertCircle
  return isIncoming.value ? ArrowDownLeft : ArrowUpRight
})

const dateStr = computed(() => {
  const ts = props.tx.settled_at || props.tx.created_at
  return ts ? formatFullDate(ts) : null
})

const hasTechnicalData = computed(() => !!props.tx.payment_hash || !!props.tx.preimage)

function copy(text, field) {
  navigator.clipboard.writeText(text)
  copiedField.value = field
  setTimeout(() => (copiedField.value = ''), 1500)
}
</script>

<template>
  <div class="animate-fade-in-up">
    <!-- Header with dev toggle -->
    <div class="flex items-center justify-between mb-4">
      <span class="text-xs font-extrabold text-text-muted">{{ t('wallet.detailTitle') }}</span>
      <div class="flex items-center gap-1">
        <button
          v-if="hasTechnicalData"
          @click="showTechnical = !showTechnical"
          class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200"
          :class="showTechnical ? 'text-brand' : 'text-text-muted'"
        >
          <Code class="w-4 h-4" />
        </button>
        <button @click="emit('close')" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200">
          <X class="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>

    <!-- Hero card — BuhoGO style with type + status header, then amounts -->
    <div class="bg-surface-card rounded-3xl border border-border p-4 mb-4 shadow-md">
      <!-- Top: icon + type + status -->
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" :class="statusColor">
          <component :is="statusIcon" class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-extrabold">{{ typeLabel }}</div>
          <div class="flex items-center gap-1 text-[10px] font-medium" :class="statusColor.split(' ')[0]">
            <component :is="statusIcon" class="w-3 h-3" />
            {{ statusLabel }}
          </div>
        </div>
      </div>

      <!-- Bottom: amount + fiat -->
      <div class="text-center pt-3 border-t border-border">
        <div class="flex items-baseline justify-center gap-1.5">
          <span
            class="text-2xl font-extrabold tracking-tight"
            :class="isIncoming ? 'text-incoming' : 'text-outgoing'"
          >
            {{ isIncoming ? '+' : '-' }}{{ formatSats(amount) }}
          </span>
          <span class="text-xs font-medium text-text-muted">{{ t('wallet.sats') }}</span>
        </div>
        <div v-if="fiatAmount" class="text-xs mt-0.5 font-medium" :class="isIncoming ? 'text-incoming' : 'text-outgoing'">≈ {{ fiatAmount }}</div>
      </div>
    </div>

    <!-- User-friendly details -->
    <div class="bg-surface-card rounded-3xl border border-border divide-y divide-border overflow-hidden mb-3 shadow-sm">
      <!-- Description -->
      <div class="px-4 py-3">
        <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.description') }}</div>
        <p class="text-xs" :class="tx.description ? 'text-text-primary' : 'text-text-muted'">
          {{ tx.description || t('wallet.noDescription') }}
        </p>
      </div>

      <!-- Date + Fees in a row -->
      <div class="grid grid-cols-2 divide-x divide-border">
        <div class="px-4 py-3">
          <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.date') }}</div>
          <p class="text-xs text-text-primary">{{ dateStr || '—' }}</p>
        </div>
        <div class="px-4 py-3">
          <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.fees') }}</div>
          <p class="text-xs text-text-primary">
            <template v-if="feesPaid != null && feesPaid > 0">
              {{ formatSats(feesPaid) }} {{ t('wallet.sats') }}
              <span v-if="fiatFees" class="text-text-muted">({{ fiatFees }})</span>
            </template>
            <span v-else class="text-text-muted">{{ t('wallet.feesNone') }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Technical details — toggled from header code icon -->
    <div v-if="hasTechnicalData && showTechnical">
      <div class="bg-surface-card rounded-3xl border border-border divide-y divide-border overflow-hidden mt-3 animate-fade-in-up shadow-sm">
        <div class="px-4 py-2 bg-surface-elevated/50 flex items-center gap-1.5">
          <Code class="w-3 h-3 text-text-muted" />
          <span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('wallet.technicalDetails') }}</span>
        </div>
        <!-- Payment hash -->
        <div v-if="tx.payment_hash" class="px-4 py-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('wallet.paymentHash') }}</span>
            <button
              @click="copy(tx.payment_hash, 'hash')"
              class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200"
            >
              <Check v-if="copiedField === 'hash'" class="w-3 h-3 text-success" />
              <Copy v-else class="w-3 h-3 text-text-muted" />
            </button>
          </div>
          <code class="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
            {{ tx.payment_hash }}
          </code>
        </div>

        <!-- Preimage -->
        <div v-if="tx.preimage" class="px-4 py-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('wallet.preimage') }}</span>
            <button
              @click="copy(tx.preimage, 'preimage')"
              class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200"
            >
              <Check v-if="copiedField === 'preimage'" class="w-3 h-3 text-success" />
              <Copy v-else class="w-3 h-3 text-text-muted" />
            </button>
          </div>
          <code class="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
            {{ tx.preimage }}
          </code>
        </div>
      </div>
    </div>
  </div>
</template>

