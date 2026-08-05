<script setup>
/**
 * Single transaction row — compact, scannable, tappable.
 * Shows description/memo when available, fiat below sats.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFiat } from '../../composables/useFiat.js'
import { formatSats, formatTimestamp, msatsToSats } from '../../lib/utils.js'

const { t } = useI18n()
const { toFiat } = useFiat()
import { ArrowUpRight, ArrowDownLeft, Clock, AlertCircle, Smartphone, BadgeCheck, Store } from 'lucide-vue-next'

const props = defineProps({
  tx: { type: Object, required: true },
})

defineEmits(['click'])

const isIncoming = computed(() => props.tx.type === 'incoming')
const metadata = computed(() => props.tx.metadata || {})

const amount = computed(() => {
  const msats = props.tx.amount
  return msats != null ? msatsToSats(msats) : 0
})

const fiatAmount = computed(() => {
  const snapshot = metadata.value.fiatSnapshot
  if (snapshot) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: snapshot.code }).format(snapshot.amount) }
    catch { /* fall through to live rate */ }
  }
  return amount.value > 0 ? toFiat(amount.value) : null
})

const txState = computed(() => {
  // Use NWC state field as primary source of truth
  const state = props.tx.state
  if (state === 'settled') return 'settled'
  if (state === 'failed') return 'failed'
  if (state === 'accepted') return 'pending'
  // Fallback heuristic when state field is missing
  if (props.tx.settled_at) return 'settled'
  if (props.tx.expires_at && props.tx.expires_at < Math.floor(Date.now() / 1000)) return 'expired'
  return state === 'pending' ? 'pending' : (state || 'settled')
})

const statusIcon = computed(() => {
  if (txState.value === 'pending') return Clock
  if (txState.value === 'expired' || txState.value === 'failed') return AlertCircle
  if (metadata.value.payout || metadata.value.source === 'mobile') return Smartphone
  if (metadata.value.source === 'merchant') return Store
  return isIncoming.value ? ArrowDownLeft : ArrowUpRight
})

const statusColor = computed(() => {
  if (txState.value === 'pending') return 'text-warning bg-warning/10'
  if (txState.value === 'expired' || txState.value === 'failed') return 'text-error bg-error/10'
  return isIncoming.value ? 'text-incoming bg-incoming/10' : 'text-outgoing bg-outgoing/10'
})

const timeLabel = computed(() => {
  const ts = props.tx.settled_at || props.tx.created_at
  if (txState.value === 'pending') return t('wallet.statusPending')
  if (txState.value === 'expired') return t('wallet.statusExpired')
  if (txState.value === 'failed') return t('wallet.statusFailed')
  return ts ? formatTimestamp(ts) : (isIncoming.value ? t('wallet.statusReceived') : t('wallet.statusSent'))
})

const title = computed(() => {
  return metadata.value.merchantVerification?.name
    || metadata.value.recipientName
    || props.tx.description
    || props.tx.memo
    || (isIncoming.value ? t('wallet.statusReceived') : t('wallet.statusSent'))
})

const subtitle = computed(() => {
  const description = props.tx.description || props.tx.memo || ''
  if (description && description !== title.value) return `${timeLabel.value} · ${description}`
  return timeLabel.value
})
</script>

<template>
  <button
    @click="$emit('click')"
    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-3xl hover:bg-surface-card transition-all duration-200 text-left group"
    :class="txState === 'pending' ? 'animate-tx-pending' : ''"
  >
    <!-- Counterparty identity or direction icon -->
    <div
      class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 transition-opacity"
      :class="[statusColor, txState === 'pending' ? 'animate-pulse' : '']"
    >
      <img v-if="metadata.merchantVerification?.logoUrl" :src="metadata.merchantVerification.logoUrl" alt="" class="w-full h-full object-contain rounded-[10px] bg-white p-1" />
      <span v-else-if="metadata.payout || metadata.source === 'mobile'" class="text-base">📱</span>
      <component v-else :is="statusIcon" class="w-4 h-4" />
    </div>

    <!-- Counterparty + status/time -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1 min-w-0">
        <div class="text-xs font-semibold truncate">{{ title }}</div>
        <BadgeCheck v-if="metadata.merchantVerification" class="w-3 h-3 text-success shrink-0" />
      </div>
      <div class="text-[10px] text-text-muted truncate">{{ subtitle }}</div>
    </div>

    <!-- Amount + fiat badge pill -->
    <div class="text-right shrink-0 flex flex-col items-end gap-0.5">
      <div
        class="text-xs font-semibold tabular-nums"
        :class="isIncoming ? 'text-incoming' : 'text-outgoing'"
      >
        {{ isIncoming ? '+' : '-' }}{{ formatSats(amount) }}
      </div>
      <span
        v-if="metadata.payout"
        class="text-[8px] font-semibold px-1.5 py-px rounded-full bg-info/10 text-info"
      >
        {{ metadata.payout.amount }} {{ metadata.payout.code }}
      </span>
      <span
        v-else-if="fiatAmount"
        class="text-[8px] font-medium px-1.5 py-px rounded-full"
        :class="isIncoming ? 'bg-incoming/10 text-incoming' : 'bg-outgoing/10 text-outgoing'"
      >
        {{ fiatAmount }}
      </span>
    </div>
  </button>
</template>
