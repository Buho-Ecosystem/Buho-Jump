<script setup>
/**
 * Shared receipt view for the popup and full-page Activity screen.
 * Product context stays prominent; protocol data lives behind one toggle.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFiat } from '../../composables/useFiat.js'
import { useWallet } from '../../composables/useWallet.js'
import { formatSats, formatFullDate, msatsToSats } from '../../lib/utils.js'
import { getTransactionId } from '../../lib/transactionMetadata.js'
import { pollVerify } from '../../lib/lnurlVerify.js'
import {
  ArrowUpRight, ArrowDownLeft, Clock, AlertCircle, X, Copy, Check,
  Code, BadgeCheck, Smartphone, ExternalLink, Share2, Save, Loader2,
  Store,
} from 'lucide-vue-next'

const props = defineProps({
  tx: { type: Object, required: true },
  fullPage: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
const { t } = useI18n()
const { toFiat } = useFiat()
const { saveTransactionMetadata } = useWallet()

const copiedField = ref('')
const showTechnical = ref(false)
const localMetadata = ref({ ...(props.tx.metadata || {}) })
const personalNote = ref(localMetadata.value.personalNote || '')
const savingNote = ref(false)
const checkingDelivery = ref(false)
let verifyController = null

const transactionId = computed(() => getTransactionId(props.tx))
const metadata = computed(() => localMetadata.value)
const isIncoming = computed(() => props.tx.type === 'incoming')
const amount = computed(() => msatsToSats(props.tx.amount || 0))
const fiatAmount = computed(() => {
  const snapshot = metadata.value.fiatSnapshot
  if (snapshot) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: snapshot.code }).format(snapshot.amount) }
    catch { /* fall through to live rate */ }
  }
  return amount.value > 0 ? toFiat(amount.value) : null
})
const feesPaid = computed(() => props.tx.fees_paid ? msatsToSats(props.tx.fees_paid) : 0)
const fiatFees = computed(() => feesPaid.value > 0 ? toFiat(feesPaid.value) : null)
const totalPaid = computed(() => isIncoming.value ? amount.value : amount.value + feesPaid.value)

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
const statusColor = computed(() => {
  if (txState.value === 'pending') return 'text-warning bg-warning/10'
  if (txState.value === 'expired' || txState.value === 'failed') return 'text-error bg-error/10'
  return isIncoming.value ? 'text-incoming bg-incoming/10' : 'text-outgoing bg-outgoing/10'
})
const statusIcon = computed(() => {
  if (txState.value === 'pending') return Clock
  if (txState.value === 'expired' || txState.value === 'failed') return AlertCircle
  if (metadata.value.payout || metadata.value.source === 'mobile') return Smartphone
  if (metadata.value.source === 'merchant') return Store
  return isIncoming.value ? ArrowDownLeft : ArrowUpRight
})
const counterparty = computed(() => metadata.value.merchantVerification?.name
  || metadata.value.recipientName
  || props.tx.description
  || props.tx.memo
  || (isIncoming.value ? t('wallet.typeReceived') : t('wallet.typeSent')))
const createdDate = computed(() => props.tx.created_at ? formatFullDate(props.tx.created_at) : null)
const settledDate = computed(() => props.tx.settled_at ? formatFullDate(props.tx.settled_at) : null)
const hasTechnicalData = computed(() => !!(
  props.tx.payment_hash || props.tx.preimage || props.tx.invoice || metadata.value.verifyUrl
))

async function copy(text, field) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedField.value = field
    setTimeout(() => { copiedField.value = '' }, 2000)
  } catch { /* clipboard can be unavailable in hardened browsers */ }
}

async function shareReceipt() {
  const receipt = `${counterparty.value}\n${isIncoming.value ? '+' : '-'}${formatSats(amount.value)} sats\n${statusLabel.value}`
  try {
    if (navigator.share) await navigator.share({ title: t('wallet.detailTitle'), text: receipt })
    else await copy(receipt, 'receipt')
  } catch { /* share cancellation is not an error */ }
}

async function saveNote() {
  if (!transactionId.value) return
  savingNote.value = true
  try {
    const saved = await saveTransactionMetadata(transactionId.value, { personalNote: personalNote.value })
    localMetadata.value = { ...localMetadata.value, ...saved }
  } finally {
    savingNote.value = false
  }
}

async function refreshDelivery() {
  if (!metadata.value.verifyUrl || checkingDelivery.value) return
  verifyController?.abort()
  verifyController = new AbortController()
  checkingDelivery.value = true
  try {
    await pollVerify(metadata.value.verifyUrl, (deliveryStatus) => {
      localMetadata.value = { ...localMetadata.value, deliveryStatus }
      if (transactionId.value) {
        saveTransactionMetadata(transactionId.value, { deliveryStatus }).catch(() => {})
      }
    }, { signal: verifyController.signal, expectPayout: metadata.value.source === 'mobile' })
  } finally {
    checkingDelivery.value = false
  }
}

onMounted(() => {
  if (metadata.value.verifyUrl && !metadata.value.deliveryStatus?.delivered) refreshDelivery()
})
onBeforeUnmount(() => verifyController?.abort())
</script>

<template>
  <div class="animate-fade-in-up" :class="fullPage ? 'max-w-2xl mx-auto' : ''">
    <div class="flex items-center justify-between mb-4">
      <span class="text-xs font-extrabold text-text-muted">{{ t('wallet.detailTitle') }}</span>
      <div class="flex items-center gap-1">
        <button @click="shareReceipt" class="p-1.5 rounded-lg hover:bg-surface-elevated text-text-muted" :title="t('wallet.shareReceipt')">
          <Check v-if="copiedField === 'receipt'" class="w-4 h-4 text-success" />
          <Share2 v-else class="w-4 h-4" />
        </button>
        <button v-if="hasTechnicalData" @click="showTechnical = !showTechnical"
          class="p-1.5 rounded-lg hover:bg-surface-elevated" :class="showTechnical ? 'text-brand' : 'text-text-muted'"
          :title="t('wallet.technicalDetails')"><Code class="w-4 h-4" /></button>
        <button @click="emit('close')" class="p-1.5 rounded-lg hover:bg-surface-elevated" :aria-label="t('common.close')">
          <X class="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>

    <!-- Receipt hero -->
    <div class="bg-surface-card rounded-3xl border border-border p-5 mb-4 shadow-md text-center">
      <div class="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center overflow-hidden" :class="statusColor">
        <img v-if="metadata.merchantVerification?.logoUrl" :src="metadata.merchantVerification.logoUrl" alt="" class="w-full h-full object-contain bg-white p-1.5" />
        <component v-else :is="statusIcon" class="w-6 h-6" />
      </div>
      <div class="flex items-center justify-center gap-1.5">
        <h2 class="text-base font-extrabold break-words">{{ counterparty }}</h2>
        <BadgeCheck v-if="metadata.merchantVerification" class="w-4 h-4 text-success shrink-0" />
      </div>
      <span class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" :class="statusColor">
        <component :is="statusIcon" class="w-3 h-3" />{{ statusLabel }}
      </span>
      <div class="flex items-baseline justify-center gap-1.5 mt-4">
        <span class="text-3xl font-extrabold tracking-tight" :class="isIncoming ? 'text-incoming' : 'text-outgoing'">
          {{ isIncoming ? '+' : '-' }}{{ formatSats(amount) }}
        </span>
        <span class="text-xs font-medium text-text-muted">{{ t('wallet.sats') }}</span>
      </div>
      <div v-if="fiatAmount" class="text-xs mt-0.5 text-text-muted">≈ {{ fiatAmount }}</div>
      <div v-if="metadata.payout" class="inline-flex mt-2 px-2.5 py-1 rounded-full bg-info/10 text-info text-xs font-bold">
        {{ metadata.payout.amount }} {{ metadata.payout.code }} {{ t('wallet.recipientAmount') }}
      </div>
    </div>

    <!-- Branta identity -->
    <a v-if="metadata.merchantVerification?.verifyUrl" :href="metadata.merchantVerification.verifyUrl" target="_blank" rel="noopener noreferrer"
      class="flex items-center gap-3 bg-success/8 border border-success/25 rounded-2xl px-4 py-3 mb-3">
      <BadgeCheck class="w-5 h-5 text-success shrink-0" />
      <div class="min-w-0 flex-1"><p class="text-xs font-bold">{{ t('wallet.verifiedByBranta') }}</p><p class="text-[10px] text-text-muted truncate">{{ metadata.merchantVerification.name }}</p></div>
      <ExternalLink class="w-3.5 h-3.5 text-success" />
    </a>

    <!-- LUD-21 mobile delivery -->
    <div v-if="metadata.source === 'mobile' || metadata.payout || metadata.deliveryStatus?.hasPayout" class="rounded-2xl border p-4 mb-3"
      :class="metadata.deliveryStatus?.delivered ? 'bg-success/8 border-success/25' : 'bg-info/8 border-info/25'">
      <div class="flex items-center gap-2">
        <Check v-if="metadata.deliveryStatus?.delivered" class="w-4 h-4 text-success" />
        <Loader2 v-else-if="checkingDelivery" class="w-4 h-4 text-info animate-spin" />
        <Smartphone v-else class="w-4 h-4 text-info" />
        <p class="text-xs font-bold">{{ metadata.deliveryStatus?.delivered ? t('wallet.mobileDelivered') : t('wallet.mobileDeliveryPending') }}</p>
      </div>
      <div class="mt-2 text-[10px] text-text-secondary space-y-1">
        <p v-if="metadata.deliveryStatus?.recipient">{{ t('wallet.deliveredTo') }}: {{ metadata.deliveryStatus.recipient }}</p>
        <p v-if="metadata.deliveryStatus?.receipt" class="font-mono break-all">{{ t('wallet.deliveryReceipt') }}: {{ metadata.deliveryStatus.receipt }}</p>
      </div>
      <button v-if="metadata.verifyUrl && !checkingDelivery && !metadata.deliveryStatus?.delivered" @click="refreshDelivery"
        class="mt-2 text-[10px] font-semibold text-info hover:underline">{{ t('wallet.checkDelivery') }}</button>
    </div>

    <!-- LUD-09 success action -->
    <div v-if="metadata.successAction" class="bg-surface-card rounded-2xl border border-border p-4 mb-3">
      <p class="text-[9px] uppercase tracking-wider font-semibold text-text-muted mb-1.5">{{ t('wallet.messageFromService') }}</p>
      <p v-if="metadata.successAction.tag === 'message'" class="text-xs leading-relaxed">{{ metadata.successAction.message }}</p>
      <template v-else-if="metadata.successAction.tag === 'url'">
        <p class="text-xs leading-relaxed mb-2">{{ metadata.successAction.description }}</p>
        <a :href="metadata.successAction.url" target="_blank" rel="noopener noreferrer" class="text-xs text-brand font-semibold inline-flex items-center gap-1">
          {{ t('common.open') }} <ExternalLink class="w-3 h-3" />
        </a>
      </template>
      <template v-else-if="metadata.successAction.tag === 'aes'">
        <p v-if="metadata.successAction.description" class="text-xs text-text-muted mb-1">{{ metadata.successAction.description }}</p>
        <p v-if="metadata.successAction.secret" class="text-xs font-mono break-all">{{ metadata.successAction.secret }}</p>
        <p v-else class="text-xs text-warning">{{ t('wallet.successActionDecryptFailed') }}</p>
      </template>
    </div>

    <!-- Human-readable receipt fields -->
    <div class="bg-surface-card rounded-3xl border border-border divide-y divide-border overflow-hidden mb-3 shadow-sm">
      <div class="px-4 py-3">
        <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.description') }}</div>
        <p class="text-xs" :class="tx.description ? 'text-text-primary' : 'text-text-muted'">{{ tx.description || t('wallet.noDescription') }}</p>
      </div>
      <div v-if="metadata.recipientAddress" class="px-4 py-3">
        <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.recipient') }}</div>
        <p class="text-xs font-mono break-all">{{ metadata.recipientAddress }}</p>
      </div>
      <div class="grid grid-cols-2 divide-x divide-border">
        <div class="px-4 py-3"><div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.created') }}</div><p class="text-xs">{{ createdDate || '—' }}</p></div>
        <div class="px-4 py-3"><div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.settled') }}</div><p class="text-xs">{{ settledDate || '—' }}</p></div>
      </div>
      <div class="grid grid-cols-2 divide-x divide-border">
        <div class="px-4 py-3"><div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.fees') }}</div><p class="text-xs">{{ feesPaid ? `${formatSats(feesPaid)} ${t('wallet.sats')}` : t('wallet.feesNone') }} <span v-if="fiatFees" class="text-text-muted">({{ fiatFees }})</span></p></div>
        <div class="px-4 py-3"><div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('wallet.total') }}</div><p class="text-xs font-semibold">{{ formatSats(totalPaid) }} {{ t('wallet.sats') }}</p></div>
      </div>
    </div>

    <!-- Personal note -->
    <div class="bg-surface-card rounded-2xl border border-border p-4 mb-3">
      <div class="flex items-center justify-between mb-2"><label class="text-[9px] uppercase tracking-wider font-semibold text-text-muted">{{ t('wallet.personalNote') }}</label><span class="text-[9px] text-text-muted">{{ personalNote.length }}/500</span></div>
      <textarea v-model="personalNote" maxlength="500" rows="2" :placeholder="t('wallet.personalNotePlaceholder')"
        class="w-full bg-surface-base border border-border rounded-xl px-3 py-2 text-xs resize-none outline-none focus:border-brand" />
      <button @click="saveNote" :disabled="savingNote || !transactionId" class="mt-2 ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand/10 text-brand text-[10px] font-semibold disabled:opacity-40">
        <Loader2 v-if="savingNote" class="w-3 h-3 animate-spin" /><Save v-else class="w-3 h-3" />{{ t('common.save') }}
      </button>
    </div>

    <!-- Developer details -->
    <div v-if="hasTechnicalData && showTechnical" class="bg-surface-card rounded-3xl border border-border divide-y divide-border overflow-hidden animate-fade-in-up shadow-sm">
      <div class="px-4 py-2 bg-surface-elevated/50 flex items-center gap-1.5"><Code class="w-3 h-3 text-text-muted" /><span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('wallet.technicalDetails') }}</span></div>
      <div v-for="field in [
        { id: 'hash', label: t('wallet.paymentHash'), value: tx.payment_hash },
        { id: 'preimage', label: t('wallet.preimage'), value: tx.preimage },
        { id: 'invoice', label: t('wallet.lightningInvoice'), value: tx.invoice },
        { id: 'verify', label: 'LUD-21 verify URL', value: metadata.verifyUrl },
      ].filter(item => item.value)" :key="field.id" class="px-4 py-3">
        <div class="flex items-center justify-between mb-1"><span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ field.label }}</span><button @click="copy(field.value, field.id)" class="p-0.5 rounded hover:bg-surface-elevated"><Check v-if="copiedField === field.id" class="w-3 h-3 text-success" /><Copy v-else class="w-3 h-3 text-text-muted" /></button></div>
        <code class="text-[10px] font-mono text-text-secondary break-all leading-relaxed">{{ field.value }}</code>
      </div>
    </div>
  </div>
</template>
