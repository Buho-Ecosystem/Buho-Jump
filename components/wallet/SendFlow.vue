<script setup>
/**
 * Send flow — smart input that detects invoice / Lightning Address / LNURL /
 * SA retail QR codes (Pick n Pay, Checkers, Shoprite, Woolworths via CryptoQR).
 *
 * Steps: input → confirm → result  (normal)
 *        input → merchant-confirm → result  (retail QR)
 *
 * Amount input supports sats and fiat toggle with live conversion.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat } from '../../composables/useFiat.js'

const { t } = useI18n()
import { formatSats, detectPaymentInput } from '../../lib/utils.js'
import { parseZARFromMetadata, getMerchantInitials } from '../../lib/merchantQR.js'
import { fetchInvoice } from 'nostr-core'
import { executeLnurlPay, fetchLnurlPayParams, fetchLnurlPayInvoice } from '../../lib/lnurl.js'
import QrScanner from '../QrScanner.vue'
import {
  ArrowLeft, ScanLine, Zap, ArrowUpRight, ArrowLeftRight,
  Check, AlertTriangle, Loader2, AtSign, Store, Timer,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'done'])
const { payInvoice, status } = useWallet()
const toast = useToast()
const { toFiat, fiatToSats, currency, loadRate } = useFiat()

// ── State ──
const step = ref('input') // 'input' | 'confirm' | 'merchant-confirm' | 'result'
const input = ref('')
const amountSats = ref('')
const amountFiat = ref('')
const inputMode = ref('sats') // 'sats' | 'fiat'
const showScanner = ref(false)
const paying = ref(false)
const resolving = ref(false)
const payResult = ref(null)
const payError = ref('')
const resolvedInvoice = ref('')

// ── Merchant payment state ──
const merchantInfo = ref(null)
const merchantZAR = ref(null)
const merchantStoreName = ref('')
const merchantSats = ref(0)
const merchantRateStale = ref(false)
const merchantLogoFailed = ref(false)
const countdown = ref(90)
let countdownTimer = null

// Load rate for conversions
loadRate()

// ── Detection ──
const detected = computed(() => {
  if (!input.value.trim()) return null
  return detectPaymentInput(input.value)
})

const isMerchant = computed(() => detected.value?.type === 'merchant')
const isMerchantUnsupported = computed(() => detected.value?.type === 'merchant-unsupported')

const detectedLabel = computed(() => {
  if (!detected.value) return ''
  const labels = {
    invoice: t('wallet.lightningInvoice'),
    lnaddress: t('wallet.lightningAddress'),
    lnurl: t('wallet.lnurl'),
    merchant: t('wallet.merchantDetected'),
    'merchant-unsupported': t('wallet.merchantDetected'),
    unknown: t('wallet.unknownFormat'),
  }
  return labels[detected.value.type] || ''
})

const detectedIcon = computed(() => {
  if (detected.value?.type === 'merchant' || detected.value?.type === 'merchant-unsupported') return Store
  if (detected.value?.type === 'lnaddress') return AtSign
  return Zap
})

const detectedColor = computed(() => {
  if (!detected.value) return ''
  if (detected.value.type === 'unknown') return 'text-warning bg-warning/10'
  if (detected.value.type === 'merchant-unsupported') return 'text-warning bg-warning/10'
  if (detected.value.type === 'lnurl') return 'text-info bg-info/10'
  if (detected.value.type === 'merchant') return 'text-brand bg-brand/10'
  return 'text-success bg-success/10'
})

const needsAmount = computed(() => {
  if (!detected.value) return false
  if (detected.value.type === 'merchant') return false // amount from LNURL metadata
  return detected.value.type === 'lnaddress' || detected.value.type === 'lnurl'
})

// Effective sats amount (from whichever input mode is active)
const effectiveSats = computed(() => {
  if (inputMode.value === 'sats') return parseInt(amountSats.value) || 0
  return parseInt(amountSats.value) || 0 // Set by fiat→sats watcher
})

// Conversion display for the inactive denomination
const conversionHint = computed(() => {
  if (inputMode.value === 'sats') {
    const sats = parseInt(amountSats.value)
    if (!sats || sats <= 0) return ''
    const fiat = toFiat(sats)
    return fiat ? `≈ ${fiat}` : ''
  } else {
    const sats = parseInt(amountSats.value)
    if (!sats || sats <= 0) return ''
    return `≈ ${formatSats(sats)} sats`
  }
})

const canProceed = computed(() => {
  if (!detected.value) return false
  if (detected.value.type === 'unknown') return false
  if (detected.value.type === 'merchant-unsupported') return false
  if (detected.value.type === 'invoice') return true
  if (detected.value.type === 'merchant') return true
  if (needsAmount.value) return effectiveSats.value > 0
  return true
})

// Countdown display
const countdownDisplay = computed(() => {
  const mins = Math.floor(countdown.value / 60)
  const secs = countdown.value % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

const countdownExpired = computed(() => countdown.value <= 0)

const countdownUrgent = computed(() => countdown.value <= 20 && countdown.value > 0)

// Watch fiat input → convert to sats
let fiatDebounce = null
watch(amountFiat, (val) => {
  if (inputMode.value !== 'fiat') return
  clearTimeout(fiatDebounce)
  const num = parseFloat(val)
  if (!num || num <= 0) { amountSats.value = ''; return }
  fiatDebounce = setTimeout(async () => {
    try {
      const sats = await fiatToSats(num)
      if (inputMode.value === 'fiat') amountSats.value = String(sats)
    } catch { /* rate unavailable */ }
  }, 300)
})

function toggleInputMode() {
  inputMode.value = inputMode.value === 'sats' ? 'fiat' : 'sats'
}

// ── Merchant flow ──

function startCountdown() {
  stopCountdown()
  countdown.value = 90
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      stopCountdown()
    }
    // Mark rate as potentially stale after 60 seconds
    if (countdown.value <= 30) {
      merchantRateStale.value = true
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

onBeforeUnmount(() => {
  stopCountdown()
})

async function resolveMerchantPayment() {
  const det = detected.value
  if (!det || det.type !== 'merchant') return

  resolving.value = true
  payError.value = ''
  merchantInfo.value = det.merchant

  try {
    // Lightning address: encodedQR@cryptoqr.net → .well-known/lnurlp endpoint
    const lnAddress = det.value
    const [user, domain] = lnAddress.split('@')
    const lnurlUrl = `https://${domain}/.well-known/lnurlp/${user}`

    const params = await fetchLnurlPayParams(lnurlUrl)

    // Parse ZAR amount from metadata description
    const zarInfo = parseZARFromMetadata(params.metadata)
    if (zarInfo) {
      merchantZAR.value = zarInfo.zarAmount
      if (zarInfo.storeName) merchantStoreName.value = zarInfo.storeName
    }

    // Use maxSendable for the payment amount — this is what CryptoQR expects
    // to cover the full ZAR amount the merchant requires. Our own fiatToSats
    // rate may differ from CryptoQR's rate, causing underpayment.
    // When min === max it's a fixed-amount invoice; when min !== max, max
    // represents the full ZAR amount converted by CryptoQR.
    const amountToSend = params.maxSendable
    merchantSats.value = amountToSend

    // Check balance before proceeding
    if (status.value?.balance != null && amountToSend > status.value.balance) {
      payError.value = t('wallet.merchantInsufficientBalance')
      resolving.value = false
      return
    }

    // Fetch the invoice from CryptoQR callback
    const { invoice } = await fetchLnurlPayInvoice(params.callback, amountToSend)
    resolvedInvoice.value = invoice

    // Start countdown — invoice is time-sensitive
    startCountdown()
    step.value = 'merchant-confirm'
  } catch (err) {
    payError.value = err.message || 'Could not resolve merchant payment'
  } finally {
    resolving.value = false
  }
}

// ── Actions ──
async function proceed() {
  if (!canProceed.value) return
  payError.value = ''

  // Merchant QR → special flow
  if (detected.value.type === 'merchant') {
    await resolveMerchantPayment()
    return
  }

  if (detected.value.type === 'lnaddress') {
    resolving.value = true
    try {
      const result = await fetchInvoice(detected.value.value, effectiveSats.value)
      resolvedInvoice.value = result.invoice
      step.value = 'confirm'
    } catch (err) {
      payError.value = err.message || 'Could not resolve Lightning Address'
    } finally {
      resolving.value = false
    }
    return
  }

  if (detected.value.type === 'lnurl') {
    resolving.value = true
    try {
      const result = await executeLnurlPay(detected.value.value, effectiveSats.value)
      resolvedInvoice.value = result.invoice
      step.value = 'confirm'
    } catch (err) {
      payError.value = err.message || 'LNURL request failed'
    } finally {
      resolving.value = false
    }
    return
  }

  step.value = 'confirm'
}

async function confirmPay() {
  paying.value = true
  payError.value = ''
  try {
    const invoice = resolvedInvoice.value || detected.value.value
    const result = await payInvoice(invoice)
    payResult.value = result
    stopCountdown()
    step.value = 'result'
  } catch (err) {
    payError.value = err.message || 'Payment failed'
  } finally {
    paying.value = false
  }
}

function onScan(val) {
  input.value = val
  showScanner.value = false
}

function reset() {
  step.value = 'input'
  input.value = ''
  amountSats.value = ''
  amountFiat.value = ''
  payResult.value = null
  payError.value = ''
  resolvedInvoice.value = ''
  merchantInfo.value = null
  merchantZAR.value = null
  merchantStoreName.value = ''
  merchantSats.value = 0
  merchantRateStale.value = false
  merchantLogoFailed.value = false
  stopCountdown()
}
</script>

<template>
  <div class="animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2 mb-4">
      <button
        @click="step === 'input' ? emit('back') : (step === 'merchant-confirm' ? reset() : (step = 'input'))"
        class="p-1 rounded-md hover:bg-surface-elevated transition-colors"
      >
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">
        {{ step === 'result' ? t('wallet.sendResult') : (step === 'merchant-confirm' ? t('wallet.merchantPayment') : t('wallet.sendTitle')) }}
      </span>
    </div>

    <!-- ═══ Step: Input ═══ -->
    <div v-if="step === 'input'" class="space-y-3 animate-fade-in-up">

      <!-- Input field -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ t('wallet.invoiceLabel') }}
          </label>
          <button
            @click="showScanner = !showScanner"
            class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-colors font-medium"
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

        <textarea
          v-else
          v-model="input"
          :placeholder="t('wallet.invoicePlaceholder')"
          rows="3"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted resize-none"
        />
      </div>

      <!-- Detection indicator -->
      <div
        v-if="detected"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
        :class="detectedColor"
      >
        <component :is="detectedIcon" class="w-3.5 h-3.5" />
        <span>{{ detectedLabel }}</span>
        <!-- Show merchant name for supported QR -->
        <span v-if="isMerchant && detected.merchant" class="ml-auto font-semibold">
          {{ detected.merchant.name }}
        </span>
        <!-- Phase 2: recognized but not yet supported -->
        <template v-if="isMerchantUnsupported && detected.merchant">
          <span class="ml-auto font-semibold">{{ detected.merchant.name }}</span>
        </template>
      </div>
      <!-- Phase 2 warning -->
      <div v-if="isMerchantUnsupported" class="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 text-warning text-xs">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ t('wallet.merchantNotSupported', { name: detected.merchant?.name || 'This retailer' }) }}</span>
      </div>

      <!-- Amount field with sats/fiat toggle (not for merchant — amount comes from LNURL) -->
      <div v-if="needsAmount" class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ inputMode === 'sats' ? t('wallet.amountSats') : t('wallet.amountFiat', { currency: currency.toUpperCase() }) }}
          </label>
          <button
            @click="toggleInputMode"
            class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-colors font-medium"
          >
            <ArrowLeftRight class="w-3 h-3" />
            {{ inputMode === 'sats' ? t('wallet.enterInFiat', { currency: currency.toUpperCase() }) : t('wallet.enterInSats') }}
          </button>
        </div>
        <input
          v-if="inputMode === 'sats'"
          v-model="amountSats"
          type="number"
          min="1"
          placeholder="21000"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted"
        />
        <input
          v-else
          v-model="amountFiat"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="10.00"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted"
        />
        <!-- Conversion hint -->
        <p v-if="conversionHint" class="text-[10px] text-text-muted px-1">{{ conversionHint }}</p>
      </div>

      <!-- Error -->
      <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ payError }}</span>
      </div>

      <!-- Continue -->
      <button
        @click="proceed"
        :disabled="!canProceed || resolving"
        class="w-full py-2.5 text-sm rounded-xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold btn-primary flex items-center justify-center gap-1.5"
      >
        <Loader2 v-if="resolving" class="w-4 h-4 animate-spin" />
        {{ resolving ? (isMerchant ? t('wallet.merchantResolvingAddress') : t('wallet.resolving')) : t('wallet.reviewPayment') }}
      </button>
    </div>

    <!-- ═══ Step: Merchant Confirm ═══ -->
    <div v-if="step === 'merchant-confirm'" class="space-y-3 animate-fade-in-up">

      <!-- Expired overlay -->
      <div v-if="countdownExpired" class="space-y-4">
        <div class="bg-surface-card rounded-2xl border border-border p-6 text-center">
          <div class="w-12 h-12 rounded-full bg-error/15 flex items-center justify-center mx-auto mb-3">
            <Timer class="w-6 h-6 text-error" />
          </div>
          <h3 class="text-base font-bold mb-1">{{ t('wallet.merchantExpired') }}</h3>
          <p class="text-xs text-text-muted">{{ t('wallet.merchantExpiredDesc') }}</p>
        </div>
        <button
          @click="reset"
          class="w-full py-2.5 text-sm rounded-xl bg-brand text-surface-base hover:bg-brand-hover transition-colors font-semibold btn-primary"
        >
          {{ t('wallet.merchantScanAgain') }}
        </button>
      </div>

      <!-- Active merchant payment -->
      <template v-else>
        <!-- Merchant card -->
        <div class="bg-surface-card rounded-2xl border border-border p-5">
          <!-- Merchant header -->
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
              :style="{ backgroundColor: merchantInfo?.color || '#607D8B' }"
            >
              <img
                v-if="merchantInfo?.logo && !merchantLogoFailed"
                :src="merchantInfo.logo"
                :alt="merchantInfo.name"
                class="w-full h-full object-contain p-1.5"
                @error="merchantLogoFailed = true"
              />
              <span
                v-else
                class="text-white font-bold text-sm flex items-center justify-center w-full h-full"
              >{{ getMerchantInitials(merchantInfo?.name) }}</span>
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold truncate">{{ merchantStoreName || merchantInfo?.name || 'Retailer' }}</p>
              <p class="text-[10px] text-text-muted">{{ t('wallet.merchantPaying') }} {{ merchantInfo?.name }}</p>
            </div>
          </div>

          <!-- ZAR Amount -->
          <div v-if="merchantZAR" class="text-center py-3 border-t border-b border-border">
            <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.merchantAmount') }}</p>
            <div class="text-3xl font-extrabold tracking-tight">
              R{{ merchantZAR.toFixed(2) }}
            </div>
            <div class="text-xs text-text-muted mt-1">
              ≈ {{ formatSats(merchantSats) }} sats
            </div>
            <!-- Show user's local fiat equivalent if currency is not ZAR -->
            <div v-if="currency !== 'zar' && toFiat(merchantSats)" class="text-[10px] text-text-muted mt-0.5">
              ≈ {{ toFiat(merchantSats) }}
            </div>
          </div>

          <!-- Sats amount (no ZAR parsed) -->
          <div v-else class="text-center py-3 border-t border-b border-border">
            <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.sending') }}</p>
            <div class="text-2xl font-extrabold tracking-tight">
              {{ formatSats(merchantSats) }}
              <span class="text-sm font-medium text-text-muted ml-1">{{ t('wallet.sats') }}</span>
            </div>
          </div>

          <!-- Countdown timer -->
          <div class="flex items-center justify-between mt-3">
            <span class="text-[10px] text-text-muted font-medium">{{ t('wallet.merchantTimeLeft') }}</span>
            <div
              class="flex items-center gap-1 text-xs font-mono font-bold tabular-nums"
              :class="countdownUrgent ? 'text-error animate-pulse' : 'text-text-secondary'"
            >
              <Timer class="w-3 h-3" />
              {{ countdownDisplay }}
            </div>
          </div>
        </div>

        <!-- Rate stale warning -->
        <div v-if="merchantRateStale" class="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 text-warning text-xs">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{{ t('wallet.merchantRateStale') }}</span>
        </div>

        <!-- Error -->
        <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{{ payError }}</span>
        </div>

        <!-- Actions -->
        <div class="grid grid-cols-2 gap-2">
          <button
            @click="reset"
            :disabled="paying"
            class="py-2.5 text-sm rounded-xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="confirmPay"
            :disabled="paying"
            class="py-2.5 text-sm rounded-xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-60 transition-colors font-semibold btn-primary flex items-center justify-center gap-1.5"
          >
            <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
            {{ paying ? t('wallet.paying') : t('wallet.merchantConfirm') }}
          </button>
        </div>
      </template>
    </div>

    <!-- ═══ Step: Confirm (normal) ═══ -->
    <div v-if="step === 'confirm'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-2xl border border-border p-5 text-center">
        <div class="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center mx-auto mb-3">
          <ArrowUpRight class="w-5 h-5 text-brand" />
        </div>
        <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.sending') }}</p>
        <div v-if="effectiveSats" class="text-2xl font-extrabold tracking-tight">
          {{ formatSats(effectiveSats) }}
          <span class="text-sm font-medium text-text-muted ml-1">{{ t('wallet.sats') }}</span>
        </div>
        <div v-else class="text-xs text-text-muted">{{ t('wallet.amountInInvoice') }}</div>
        <div v-if="effectiveSats && toFiat(effectiveSats)" class="text-xs text-text-muted mt-0.5">
          ≈ {{ toFiat(effectiveSats) }}
        </div>

        <div class="mt-3 flex items-center gap-1.5 justify-center text-[10px]" :class="detectedColor">
          <component :is="detectedIcon" class="w-3 h-3" />
          <span>{{ detected?.type === 'lnaddress' ? detected.value : detectedLabel }}</span>
        </div>
      </div>

      <!-- Invoice preview -->
      <div class="bg-surface-base rounded-lg px-3 py-2 text-[10px] font-mono text-text-muted break-all max-h-16 overflow-y-auto">
        {{ (resolvedInvoice || input.trim()).slice(0, 200) }}{{ (resolvedInvoice || input.trim()).length > 200 ? '...' : '' }}
      </div>

      <!-- Error -->
      <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ payError }}</span>
      </div>

      <!-- Actions -->
      <div class="grid grid-cols-2 gap-2">
        <button
          @click="step = 'input'"
          :disabled="paying"
          class="py-2.5 text-sm rounded-xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          @click="confirmPay"
          :disabled="paying"
          class="py-2.5 text-sm rounded-xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-60 transition-colors font-semibold btn-primary flex items-center justify-center gap-1.5"
        >
          <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
          {{ paying ? t('wallet.paying') : t('common.confirm') }}
        </button>
      </div>
    </div>

    <!-- ═══ Step: Result ═══ -->
    <div v-if="step === 'result'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-2xl border border-border p-6 text-center">
        <div class="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto mb-3">
          <Check class="w-6 h-6 text-success" />
        </div>
        <h3 class="text-base font-bold mb-1">{{ t('wallet.paymentSent') }}</h3>
        <p class="text-xs text-text-muted">
          {{ merchantInfo ? `${t('wallet.merchantPaying')} ${merchantInfo.name}` : t('wallet.paymentSuccess') }}
        </p>

        <!-- Merchant payment summary -->
        <div v-if="merchantInfo && merchantZAR" class="mt-3 text-sm text-text-secondary">
          R{{ merchantZAR.toFixed(2) }} → {{ formatSats(merchantSats) }} sats
        </div>

        <div v-if="payResult?.preimage" class="mt-4 text-left">
          <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.preimage') }}</p>
          <code class="block text-[10px] bg-surface-base px-2.5 py-1.5 rounded-lg font-mono text-text-secondary break-all">
            {{ payResult.preimage }}
          </code>
        </div>
      </div>

      <button
        @click="emit('done')"
        class="w-full py-2.5 text-sm rounded-xl bg-brand text-surface-base hover:bg-brand-hover transition-colors font-semibold btn-primary"
      >
        {{ t('common.done') }}
      </button>

      <button
        @click="reset"
        class="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        {{ t('wallet.sendAnother') }}
      </button>
    </div>
  </div>
</template>
