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
import { ArrowUpRight, ArrowDownLeft, Clock, AlertCircle } from 'lucide-vue-next'

const props = defineProps({
  tx: { type: Object, required: true },
})

defineEmits(['click'])

const isIncoming = computed(() => props.tx.type === 'incoming')

const amount = computed(() => {
  const msats = props.tx.amount
  return msats != null ? msatsToSats(msats) : 0
})

const fiatAmount = computed(() => amount.value > 0 ? toFiat(amount.value) : null)

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
  return isIncoming.value ? ArrowDownLeft : ArrowUpRight
})

const statusColor = computed(() => {
  if (txState.value === 'pending') return 'text-warning bg-warning/10'
  if (txState.value === 'expired' || txState.value === 'failed') return 'text-error bg-error/10'
  return isIncoming.value ? 'text-incoming bg-incoming/10' : 'text-outgoing bg-outgoing/10'
})

// Primary label: time + status
const label = computed(() => {
  const ts = props.tx.settled_at || props.tx.created_at
  if (txState.value === 'pending') return t('wallet.statusPending')
  if (txState.value === 'expired') return t('wallet.statusExpired')
  if (txState.value === 'failed') return t('wallet.statusFailed')
  return ts ? formatTimestamp(ts) : (isIncoming.value ? t('wallet.statusReceived') : t('wallet.statusSent'))
})

// Secondary: description/memo in italic (like BuhoGO)
const subtitle = computed(() => {
  return props.tx.description || props.tx.memo || ''
})
</script>

<template>
  <button
    @click="$emit('click')"
    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-card transition-colors text-left group"
  >
    <!-- Direction icon -->
    <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="statusColor">
      <component :is="statusIcon" class="w-4 h-4" />
    </div>

    <!-- Label + description -->
    <div class="flex-1 min-w-0">
      <div class="text-xs font-medium truncate">{{ label }}</div>
      <div v-if="subtitle" class="text-[10px] text-text-muted italic truncate">{{ subtitle }}</div>
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
        v-if="fiatAmount"
        class="text-[8px] font-medium px-1.5 py-px rounded-full"
        :class="isIncoming ? 'bg-incoming/10 text-incoming' : 'bg-outgoing/10 text-outgoing'"
      >
        {{ fiatAmount }}
      </span>
    </div>
  </button>
</template>
