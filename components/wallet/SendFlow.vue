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
import { useOnline } from '../../composables/useOnline.js'
import { useContacts } from '../../composables/useContacts.js'
import { getAvatarColor } from '../../lib/avatarColor.js'

const { t } = useI18n()
import { formatSats, detectPaymentInput } from '../../lib/utils.js'
import { parseZARFromMetadata, getMerchantInitials } from '../../lib/merchantQR.js'
import { fetchInvoice, lnurl as lnurlCore, parseSuccessAction, decryptAesSuccessAction } from 'nostr-core'
import { fetchLnurlPayParams, fetchLnurlPayInvoice, fetchLnurlPayInvoiceMsat, executeLnurlPay, verifyLnurlPayment } from '../../lib/lnurl.js'
import QrScanner from '../QrScanner.vue'
import ErrorBanner from '../ErrorBanner.vue'
import SatButtons from './SatButtons.vue'
import {
  ArrowLeft, ScanLine, Wallet, ArrowUpRight, ArrowDownLeft, ArrowLeftRight,
  Check, AlertTriangle, Loader2, AtSign, Store, Timer, Code, Zap,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'done'])
const { payInvoice, makeInvoice, status } = useWallet()
const toast = useToast()
const { toFiat, fiatToSats, currency, loadRate } = useFiat()
const { online } = useOnline()
const { resolveInput, fetchProfile, getCachedProfile } = useContacts()

// ── State ──
const step = ref('input') // 'input' | 'confirm' | 'merchant-confirm' | 'withdraw-confirm' | 'result'
const showInvoicePreview = ref(false)
const showPaymentProof = ref(false)
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

const fiatRateUnavailable = ref(false)

// ── LNURL-withdraw state ──
const withdrawInfo = ref(null)
const withdrawAmountSats = ref('')

// ── Success action state (LNURL-pay) ──
const successAction = ref(null) // Parsed SuccessAction from LNURL callback
const pendingSuccessAction = ref(null) // Raw action stored between invoice fetch and payment
const pendingVerifyUrl = ref(null) // LUD-21 verify URL
const paymentVerified = ref(false) // True if LUD-21 verification passed

// ── Nostr identity → Lightning address resolution ──
const nostrProfile = ref(null) // { pubkey, name, picture, lud16 }
const nostrResolving = ref(false)
const nostrResolved = ref(false) // true once profile card is shown

// Load rate for conversions
loadRate()

// ── Detection ──
const detected = computed(() => {
  if (!input.value.trim()) return null
  return detectPaymentInput(input.value)
})

const isMerchant = computed(() => detected.value?.type === 'merchant')
const isMerchantUnsupported = computed(() => detected.value?.type === 'merchant-unsupported')

const isNostrIdentity = computed(() => detected.value?.type === 'nostr-identity')

const detectedLabel = computed(() => {
  if (!detected.value) return ''
  if (nostrResolved.value && nostrProfile.value?.lud16) return t('wallet.lightningAddress')
  const labels = {
    invoice: t('wallet.lightningInvoice'),
    lnaddress: t('wallet.lightningAddress'),
    lnurl: t('wallet.lnurl'),
    merchant: t('wallet.merchantDetected'),
    'merchant-unsupported': t('wallet.merchantDetected'),
    'nostr-identity': nostrResolving.value ? t('wallet.resolvingProfile') : t('wallet.nostrIdentity'),
    unknown: t('wallet.unknownFormat'),
  }
  return labels[detected.value.type] || ''
})

const detectedIcon = computed(() => {
  if (detected.value?.type === 'merchant' || detected.value?.type === 'merchant-unsupported') return Store
  if (detected.value?.type === 'lnaddress') return AtSign
  if (detected.value?.type === 'nostr-identity') return nostrResolving.value ? Loader2 : AtSign
  return Zap
})

const detectedColor = computed(() => {
  if (!detected.value) return ''
  if (detected.value.type === 'unknown') return 'text-warning bg-warning/10'
  if (detected.value.type === 'merchant-unsupported') return 'text-warning bg-warning/10'
  if (detected.value.type === 'lnurl') return 'text-info bg-info/10'
  if (detected.value.type === 'merchant') return 'text-brand bg-brand/10'
  if (detected.value.type === 'nostr-identity') return nostrResolving.value ? 'text-text-muted bg-surface-elevated' : 'text-brand bg-brand/10'
  return 'text-success bg-success/10'
})

const isWithdraw = computed(() => detected.value?.lnurlType === 'withdraw')

const needsAmount = computed(() => {
  if (!detected.value) return false
  if (detected.value.type === 'merchant') return false
  if (isWithdraw.value) return false
  if (detected.value.type === 'nostr-identity') return nostrResolved.value && !!nostrProfile.value?.lud16
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

const amountError = computed(() => {
  if (!needsAmount.value) return ''
  const sats = effectiveSats.value
  if (!sats) return ''
  if (sats <= 0) return t('wallet.amountTooLow')
  if (status.value?.balance != null && sats > status.value.balance) {
    return t('wallet.insufficientBalance', { balance: formatSats(status.value.balance) })
  }
  return ''
})

const canProceed = computed(() => {
  if (!detected.value) return false
  if (detected.value.type === 'unknown') return false
  if (detected.value.type === 'merchant-unsupported') return false
  if (detected.value.type === 'nostr-identity') {
    if (nostrResolving.value) return false
    if (!nostrResolved.value) return false
    if (!nostrProfile.value?.lud16) return false
    return effectiveSats.value > 0
  }
  if (detected.value.type === 'invoice') return true
  if (detected.value.type === 'merchant') return true
  if (isWithdraw.value) return true
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
      fiatRateUnavailable.value = false
    } catch {
      fiatRateUnavailable.value = true
    }
  }, 300)
})

function toggleInputMode() {
  inputMode.value = inputMode.value === 'sats' ? 'fiat' : 'sats'
}

// ── Merchant flow ──

function startCountdown() {
  stopCountdown()
  countdown.value = 90
  merchantRateStale.value = false
  countdownTimer = setInterval(async () => {
    countdown.value--
    if (countdown.value <= 0) {
      stopCountdown()
    }
    // After 60 seconds, refresh the exchange rate and recalculate sats
    if (countdown.value === 30 && merchantZAR.value) {
      merchantRateStale.value = true
      try {
        await loadRate()
        const refreshedSats = await fiatToSats(merchantZAR.value)
        if (refreshedSats > 0) {
          merchantSats.value = refreshedSats
          merchantRateStale.value = false
        }
      } catch { /* rate refresh failed — keep stale warning visible */ }
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
  clearTimeout(fiatDebounce)
})

// ── Nostr identity resolution ──
// When user pastes npub/nprofile, resolve to profile → Lightning address
watch(() => detected.value?.type, async (type) => {
  if (type !== 'nostr-identity') {
    nostrProfile.value = null
    nostrResolving.value = false
    nostrResolved.value = false
    return
  }
  nostrResolving.value = true
  nostrResolved.value = false
  nostrProfile.value = null
  payError.value = ''
  try {
    const pubkey = await resolveInput(detected.value.value)
    if (!pubkey) throw new Error('Could not resolve')
    const profile = await fetchProfile(pubkey)
    nostrProfile.value = {
      pubkey,
      name: profile?.display_name || profile?.name || null,
      picture: profile?.picture || null,
      nip05: profile?.nip05 || null,
      lud16: profile?.lud16 || null,
    }
    nostrResolved.value = true
    if (!profile?.lud16) {
      payError.value = t('wallet.nostrNoLightning')
    }
  } catch {
    nostrResolved.value = true
    payError.value = t('wallet.nostrResolveFailed')
  } finally {
    nostrResolving.value = false
  }
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

    // Pay the exact millisatoshi amount CryptoQR requires. Fixed-amount LNURL is
    // rarely a whole number of sats, so rounding to sats and re-multiplying would
    // fall outside the service's allowed range and the callback would reject the
    // request (underpayment / "amount outside range"). Use the raw msat instead.
    const amountMsat = params.maxSendableMsat
    merchantSats.value = Math.ceil(amountMsat / 1000) // display + balance check (round up)

    // Check balance before proceeding
    if (status.value?.balance != null && merchantSats.value > status.value.balance) {
      payError.value = t('wallet.merchantInsufficientBalance')
      resolving.value = false
      return
    }

    // Fetch the invoice from CryptoQR callback (exact msat, no rounding)
    const lnResult = await fetchLnurlPayInvoiceMsat(params, amountMsat)
    resolvedInvoice.value = lnResult.invoice
    pendingSuccessAction.value = lnResult.successAction || null
    pendingVerifyUrl.value = lnResult.verify || null

    // Start countdown — invoice is time-sensitive
    startCountdown()
    step.value = 'merchant-confirm'
  } catch (err) {
    payError.value = err.message || t('wallet.lnurlFailed')
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

  // Early balance check for amount-specified payments
  if (effectiveSats.value > 0 && status.value?.balance != null && effectiveSats.value > status.value.balance) {
    payError.value = t('wallet.insufficientBalance', { balance: formatSats(status.value.balance) })
    return
  }

  // LNURL-withdraw → claim flow
  if (isWithdraw.value) {
    resolving.value = true
    try {
      const wr = await lnurlCore.fetchWithdrawRequest(detected.value.value)
      withdrawInfo.value = {
        ...wr,
        minSats: Math.ceil(wr.minWithdrawable / 1000),
        maxSats: Math.floor(wr.maxWithdrawable / 1000),
      }
      withdrawAmountSats.value = String(withdrawInfo.value.maxSats)
      step.value = 'withdraw-confirm'
    } catch (err) {
      payError.value = err.message || t('wallet.withdrawFailed')
    } finally {
      resolving.value = false
    }
    return
  }

  // Nostr identity → use resolved Lightning address
  if (detected.value.type === 'nostr-identity' && nostrProfile.value?.lud16) {
    resolving.value = true
    try {
      const result = await fetchInvoice(nostrProfile.value.lud16, effectiveSats.value)
      resolvedInvoice.value = result.invoice
      step.value = 'confirm'
    } catch (err) {
      payError.value = err.message || t('wallet.addressResolveFailed')
    } finally {
      resolving.value = false
    }
    return
  }

  if (detected.value.type === 'lnaddress') {
    resolving.value = true
    try {
      const result = await fetchInvoice(detected.value.value, effectiveSats.value)
      resolvedInvoice.value = result.invoice
      step.value = 'confirm'
    } catch (err) {
      payError.value = err.message || t('wallet.addressResolveFailed')
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
      pendingSuccessAction.value = result.successAction || null
      pendingVerifyUrl.value = result.verify || null
      step.value = 'confirm'
    } catch (err) {
      payError.value = err.message || t('wallet.lnurlFailed')
    } finally {
      resolving.value = false
    }
    return
  }

  step.value = 'confirm'
}

async function confirmWithdraw() {
  paying.value = true
  payError.value = ''
  try {
    const sats = parseInt(withdrawAmountSats.value) || 0
    if (!sats || sats <= 0) throw new Error('Invalid amount')
    // Create an invoice via NWC, then submit it to the withdraw service
    const invoiceResult = await makeInvoice(sats, withdrawInfo.value.defaultDescription || 'LNURL withdraw')
    if (!invoiceResult?.invoice) throw new Error('Failed to create invoice')
    await lnurlCore.submitWithdrawRequest(withdrawInfo.value, invoiceResult.invoice)
    payResult.value = { withdrawn: true, amount: sats }
    step.value = 'result'
  } catch (err) {
    payError.value = err.message || t('wallet.withdrawFailed')
  } finally {
    paying.value = false
  }
}

async function confirmPay() {
  paying.value = true
  payError.value = ''
  try {
    const invoice = resolvedInvoice.value || detected.value.value
    const result = await payInvoice(invoice)
    payResult.value = result
    stopCountdown()

    // Process LNURL success action if present
    if (pendingSuccessAction.value) {
      try {
        const parsed = parseSuccessAction(pendingSuccessAction.value)
        const action = { ...parsed }
        if (parsed.tag === 'aes' && result?.preimage) {
          action.decrypted = await decryptAesSuccessAction(parsed, result.preimage)
        }
        successAction.value = action
      } catch { /* success action parsing is non-critical */ }
      pendingSuccessAction.value = null
    }

    // LUD-21 payment verification (non-blocking)
    if (pendingVerifyUrl.value) {
      verifyLnurlPayment(pendingVerifyUrl.value).then(v => {
        if (v?.settled) paymentVerified.value = true
      })
      pendingVerifyUrl.value = null
    }

    step.value = 'result'
  } catch (err) {
    payError.value = err.message || t('wallet.paymentFailed')
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
  withdrawInfo.value = null
  withdrawAmountSats.value = ''
  successAction.value = null
  pendingSuccessAction.value = null
  pendingVerifyUrl.value = null
  paymentVerified.value = false
  fiatRateUnavailable.value = false
  nostrProfile.value = null
  nostrResolving.value = false
  nostrResolved.value = false
  stopCountdown()
}
</script>

<template>
  <div class="p-4 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-3 mb-5">
      <button
        @click="step === 'input' ? emit('back') : (step === 'merchant-confirm' || step === 'withdraw-confirm' ? reset() : (step = 'input'))"
        :aria-label="t('common.back')"
        class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-elevated transition-all duration-200"
      >
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <div>
        <h1 class="text-[15px] font-extrabold leading-tight">
          {{ step === 'result' ? (payResult?.withdrawn ? t('wallet.withdrawSuccess') : t('wallet.sendResult'))
            : step === 'merchant-confirm' ? t('wallet.merchantPayment')
            : step === 'withdraw-confirm' ? t('wallet.withdrawTitle')
            : t('wallet.sendTitle') }}
        </h1>
      </div>
    </div>

    <!-- ═══ Step: Input ═══ -->
    <div v-if="step === 'input'" class="space-y-4 animate-fade-in-up">

      <!-- Hero icon -->
      <div class="flex justify-center">
        <div class="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center">
          <ArrowUpRight class="w-6 h-6 text-brand" />
        </div>
      </div>

      <!-- Destination input card -->
      <div class="bg-surface-card rounded-2xl border border-border overflow-hidden">
        <div class="px-3.5 pt-3 pb-1.5">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ t('wallet.invoiceLabel') }}
          </label>
        </div>

        <!-- Scanner overlay -->
        <QrScanner
          v-if="showScanner"
          @scan="onScan"
          @close="showScanner = false"
        />

        <!-- Input with inline QR button -->
        <div v-else class="relative px-3.5 pb-3">
          <textarea
            v-model="input"
            :placeholder="t('wallet.invoicePlaceholder')"
            rows="2"
            class="w-full bg-transparent outline-none text-sm font-mono placeholder:text-text-muted/40 resize-none pr-8"
          />
          <button
            type="button"
            @click="showScanner = true"
            :title="t('common.scanQr')"
            class="absolute bottom-3.5 right-3.5 p-1.5 rounded-lg text-text-muted hover:text-brand hover:bg-brand/10 transition-all duration-150"
          >
            <ScanLine class="w-4 h-4" />
          </button>
        </div>

        <!-- Detection indicator — inside the card -->
        <div
          v-if="detected"
          class="flex items-center gap-2 px-3.5 py-2 border-t border-border text-[11px] font-medium"
          :class="detectedColor"
        >
          <component :is="detectedIcon" class="w-3.5 h-3.5" />
          <span>{{ detectedLabel }}</span>
          <span v-if="(isMerchant || isMerchantUnsupported) && detected.merchant" class="ml-auto font-semibold">
            {{ detected.merchant.name }}
          </span>
        </div>
      </div>

      <!-- Unknown format — guidance + report -->
      <div v-if="detected?.type === 'unknown'" class="px-1 space-y-2 animate-fade-in-up">
        <p class="text-[11px] text-text-muted">
          <span class="font-semibold text-text-secondary">{{ t('wallet.unknownFormatTitle') }}</span>
          — {{ t('wallet.unknownFormatHint') }}
        </p>
        <p class="text-[10px] text-text-muted">
          {{ t('wallet.unknownFormatReport') }}
          <a href="https://t.me/rotation77" target="_blank" rel="noopener noreferrer" class="font-semibold text-text-secondary hover:text-brand transition-colors">{{ t('wallet.reportTelegram') }}</a>
          <span class="opacity-30 mx-1">·</span>
          <a href="https://github.com/Buho-Ecosystem/Buho-Jump/issues" target="_blank" rel="noopener noreferrer" class="font-semibold text-text-secondary hover:text-brand transition-colors">{{ t('wallet.reportGithub') }}</a>
        </p>
      </div>

      <!-- Phase 2 warning -->
      <div v-if="isMerchantUnsupported" class="flex items-start gap-2 p-2.5 rounded-xl bg-warning/10 text-warning text-xs">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ t('wallet.merchantNotSupported', { name: detected.merchant?.name || 'This retailer' }) }}</span>
      </div>

      <!-- Nostr identity — resolving shimmer -->
      <div v-if="isNostrIdentity && nostrResolving" class="bg-surface-card rounded-2xl border border-border p-4 animate-fade-in-up">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full skeleton-shimmer shrink-0" />
          <div class="flex-1 space-y-2">
            <div class="skeleton-shimmer h-3.5 rounded w-28" />
            <div class="skeleton-shimmer h-3 rounded w-40" />
          </div>
        </div>
        <div class="flex justify-center mt-3">
          <div class="flex items-center gap-2 text-[10px] text-text-muted">
            <Loader2 class="w-3 h-3 animate-spin" />
            <span>{{ t('wallet.resolvingProfile') }}</span>
          </div>
        </div>
      </div>

      <!-- Nostr identity — resolved profile card -->
      <div v-else-if="isNostrIdentity && nostrResolved && nostrProfile" class="bg-surface-card rounded-2xl border border-brand/20 p-4 animate-fade-in-up">
        <div class="flex items-center gap-3">
          <div
            class="w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :style="!nostrProfile.picture ? { background: getAvatarColor(nostrProfile.pubkey) } : {}"
          >
            <img v-if="nostrProfile.picture" :src="nostrProfile.picture" alt="" class="w-full h-full object-cover" @error="nostrProfile.picture = null" />
            <span v-else class="text-lg font-bold text-white">{{ (nostrProfile.name || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-extrabold truncate">{{ nostrProfile.name || 'Unknown' }}</p>
            <p v-if="nostrProfile.nip05" class="text-[11px] text-brand truncate">{{ nostrProfile.nip05 }}</p>
            <p v-if="nostrProfile.lud16" class="text-[10px] text-success truncate flex items-center gap-1 mt-0.5">
              <Wallet class="w-3 h-3" />
              {{ nostrProfile.lud16 }}
            </p>
          </div>
        </div>
      </div>

      <!-- Amount input card (only when needed) -->
      <div v-if="needsAmount" class="bg-surface-card rounded-2xl border border-border p-4 space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ inputMode === 'sats' ? t('wallet.amountSats') : t('wallet.amountFiat', { currency: currency.toUpperCase() }) }}
          </label>
          <button
            @click="toggleInputMode"
            class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium"
          >
            <ArrowLeftRight class="w-3 h-3" />
            {{ inputMode === 'sats' ? currency.toUpperCase() : 'SATS' }}
          </button>
        </div>

        <!-- Large centered amount -->
        <div class="text-center">
          <input
            v-if="inputMode === 'sats'"
            v-model="amountSats"
            type="number"
            min="1"
            placeholder="0"
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <input
            v-else
            v-model="amountFiat"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <p v-if="conversionHint" class="text-[11px] text-text-muted mt-1 font-medium">{{ conversionHint }}</p>
        </div>

        <SatButtons
          v-if="inputMode === 'sats'"
          v-model="amountSats"
          :max="status?.balance || Infinity"
        />

        <p v-if="fiatRateUnavailable && inputMode === 'fiat'" class="text-[10px] text-warning text-center">
          {{ t('wallet.rateUnavailable') }}
        </p>
        <p v-else-if="amountError" class="text-[10px] text-error text-center">
          {{ amountError }}
        </p>
      </div>

      <!-- Offline -->
      <ErrorBanner v-if="!online" type="warning" :message="t('common.offline')" />

      <!-- Error -->
      <div v-else-if="payError" class="flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ payError }}</span>
      </div>

      <!-- Continue -->
      <button
        @click="proceed"
        :disabled="!canProceed || resolving"
        class="w-full py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-2"
      >
        <Loader2 v-if="resolving" class="w-4 h-4 animate-spin" />
        {{ resolving ? (isMerchant ? t('wallet.merchantResolvingAddress') : t('wallet.resolving')) : t('wallet.reviewPayment') }}
      </button>
    </div>

    <!-- ═══ Step: Merchant Confirm ═══ -->
    <div v-if="step === 'merchant-confirm'" class="space-y-3 animate-fade-in-up">

      <!-- Expired overlay -->
      <div v-if="countdownExpired" class="space-y-4">
        <div class="bg-surface-card rounded-3xl border border-border p-6 text-center shadow-sm">
          <div class="w-12 h-12 rounded-full bg-error/15 flex items-center justify-center mx-auto mb-3">
            <Timer class="w-6 h-6 text-error" />
          </div>
          <h3 class="text-base font-extrabold mb-1">{{ t('wallet.merchantExpired') }}</h3>
          <p class="text-xs text-text-muted">{{ t('wallet.merchantExpiredDesc') }}</p>
        </div>
        <button
          @click="reset"
          class="w-full py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold btn-primary"
        >
          {{ t('wallet.merchantScanAgain') }}
        </button>
      </div>

      <!-- Active merchant payment -->
      <template v-else>
        <!-- Merchant card -->
        <div class="bg-surface-card rounded-3xl border border-border p-5 shadow-sm">
          <!-- Merchant header -->
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 overflow-hidden"
              :style="{ backgroundColor: merchantInfo?.color || 'var(--text-muted)' }"
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
              <p class="text-sm font-extrabold truncate">{{ merchantStoreName || merchantInfo?.name || 'Retailer' }}</p>
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
            class="py-2.5 text-sm rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="confirmPay"
            :disabled="paying"
            class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-60 transition-all duration-200 font-semibold btn-primary flex items-center justify-center gap-1.5"
          >
            <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
            {{ paying ? t('wallet.paying') : t('wallet.merchantConfirm') }}
          </button>
        </div>
      </template>
    </div>

    <!-- ═══ Step: Withdraw Confirm ═══ -->
    <div v-if="step === 'withdraw-confirm'" class="space-y-4 animate-fade-in-up">
      <div class="bg-surface-card rounded-3xl border border-border p-5 text-center shadow-sm">
        <div class="w-10 h-10 rounded-[10px] bg-success/10 flex items-center justify-center mx-auto mb-3">
          <ArrowDownLeft class="w-5 h-5 text-success" />
        </div>
        <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.withdrawDesc') }}</p>

        <!-- Amount input if range -->
        <div v-if="withdrawInfo && withdrawInfo.minSats !== withdrawInfo.maxSats" class="mt-3 space-y-2">
          <input v-model="withdrawAmountSats" type="number"
            :min="withdrawInfo.minSats" :max="withdrawInfo.maxSats"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm text-center outline-none focus:border-brand transition-colors tabular-nums" />
          <p class="text-[10px] text-text-muted">
            {{ t('wallet.withdrawMin', { min: formatSats(withdrawInfo.minSats) }) }} ·
            {{ t('wallet.withdrawMax', { max: formatSats(withdrawInfo.maxSats) }) }}
          </p>
        </div>

        <!-- Fixed amount -->
        <div v-else class="text-2xl font-extrabold tracking-tight mt-2">
          {{ formatSats(parseInt(withdrawAmountSats) || 0) }}
          <span class="text-sm font-medium text-text-muted ml-1">{{ t('wallet.sats') }}</span>
        </div>

        <div v-if="toFiat(parseInt(withdrawAmountSats) || 0)" class="text-xs text-text-muted mt-1">
          ≈ {{ toFiat(parseInt(withdrawAmountSats) || 0) }}
        </div>

        <p v-if="withdrawInfo?.defaultDescription" class="text-[10px] text-text-muted mt-3 truncate">
          {{ withdrawInfo.defaultDescription }}
        </p>
      </div>

      <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ payError }}</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button @click="reset" :disabled="paying"
          class="py-2.5 text-sm rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="confirmWithdraw" :disabled="paying"
          class="py-2.5 text-sm rounded-2xl bg-success text-white hover:bg-success/90 disabled:opacity-60 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5">
          <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
          {{ paying ? t('wallet.withdrawClaiming') : t('wallet.withdrawClaim') }}
        </button>
      </div>
    </div>

    <!-- ═══ Step: Confirm (normal) ═══ -->
    <div v-if="step === 'confirm'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div class="p-5 text-center">
          <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-2">{{ t('wallet.sending') }}</p>
          <div v-if="effectiveSats" class="flex items-baseline justify-center gap-1.5">
            <span class="text-3xl font-extrabold tracking-tight">{{ formatSats(effectiveSats) }}</span>
            <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
          </div>
          <div v-else class="text-xs text-text-muted">{{ t('wallet.amountInInvoice') }}</div>
          <p v-if="effectiveSats && toFiat(effectiveSats)" class="text-[11px] text-brand mt-1 font-medium">
            ≈ {{ toFiat(effectiveSats) }}
          </p>
        </div>

        <!-- Destination -->
        <div class="flex items-center gap-2 px-4 py-2.5 border-t border-border" :class="nostrProfile?.lud16 ? 'text-success bg-success/10' : detectedColor">
          <component :is="detectedIcon" class="w-3.5 h-3.5" />
          <span v-if="nostrProfile" class="text-[11px] font-medium truncate flex items-center gap-1.5">
            <img v-if="nostrProfile.picture" :src="nostrProfile.picture" class="w-4 h-4 rounded-full" />
            {{ nostrProfile.name || nostrProfile.lud16 }}
          </span>
          <span v-else class="text-[11px] font-medium truncate">{{ detected?.type === 'lnaddress' ? detected.value : detectedLabel }}</span>
        </div>
      </div>

      <!-- Invoice preview (collapsible) -->
      <div class="space-y-1">
        <button @click="showInvoicePreview = !showInvoicePreview"
          class="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
          <Code class="w-3 h-3" />
          {{ showInvoicePreview ? t('wallet.hideInvoiceDetails') : t('wallet.showInvoiceDetails') }}
        </button>
        <div v-if="showInvoicePreview" class="bg-surface-card rounded-xl px-3 py-2 text-[9px] font-mono text-text-muted break-all max-h-16 overflow-y-auto border border-border animate-fade-in">
          {{ (resolvedInvoice || input.trim()).slice(0, 200) }}{{ (resolvedInvoice || input.trim()).length > 200 ? '...' : '' }}
        </div>
      </div>

      <!-- Error -->
      <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ payError }}</span>
      </div>

      <!-- Actions -->
      <div class="grid grid-cols-2 gap-2.5">
        <button
          @click="step = 'input'"
          :disabled="paying"
          class="py-2.5 text-sm rounded-2xl bg-surface-card border border-border text-text-secondary hover:bg-surface-elevated transition-all duration-200 font-semibold"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          @click="confirmPay"
          :disabled="paying"
          class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-50 transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-1.5"
        >
          <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
          <Wallet v-else class="w-4 h-4" />
          {{ paying ? t('wallet.paying') : t('common.confirm') }}
        </button>
      </div>
    </div>

    <!-- ═══ Step: Result ═══ -->
    <div v-if="step === 'result'" class="animate-fade-in-up">

      <div class="text-center pt-6 pb-4">
        <!-- Animated checkmark -->
        <div class="w-16 h-16 rounded-full bg-success/12 flex items-center justify-center mx-auto mb-4 animate-scale-in">
          <Check class="w-8 h-8 text-success" />
        </div>

        <!-- Withdraw success -->
        <template v-if="payResult?.withdrawn">
          <p class="text-2xl font-extrabold tracking-tight">+{{ formatSats(payResult.amount) }}</p>
          <p class="text-xs text-text-muted mt-1.5">{{ t('wallet.withdrawSuccessDesc') }}</p>
        </template>

        <!-- Payment success -->
        <template v-else>
          <h3 class="text-[15px] font-extrabold mb-1">{{ t('wallet.paymentSent') }}</h3>
          <p class="text-xs text-text-muted">
            {{ merchantInfo ? `${t('wallet.merchantPaying')} ${merchantInfo.name}` : t('wallet.paymentSuccess') }}
          </p>
          <p v-if="paymentVerified" class="text-[10px] text-success mt-1 font-medium">
            {{ t('wallet.paymentVerified') }}
          </p>

          <div v-if="merchantInfo && merchantZAR" class="mt-3 text-sm text-text-secondary">
            R{{ merchantZAR.toFixed(2) }} → {{ formatSats(merchantSats) }} sats
          </div>

          <!-- LNURL Success Action -->
          <div v-if="successAction" class="mt-4 bg-surface-card rounded-2xl border border-border overflow-hidden text-left animate-fade-in-up">
            <!-- Message type -->
            <div v-if="successAction.tag === 'message'" class="px-4 py-3 flex items-start gap-2.5">
              <div class="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                <Check class="w-3.5 h-3.5 text-success" />
              </div>
              <p class="text-xs text-text-secondary leading-relaxed pt-1">{{ successAction.message }}</p>
            </div>

            <!-- URL type -->
            <template v-else-if="successAction.tag === 'url'">
              <div class="px-4 py-3 space-y-2.5">
                <p v-if="successAction.description" class="text-xs text-text-secondary leading-relaxed">
                  {{ successAction.description }}
                </p>
                <a v-if="successAction.url?.startsWith('https://')"
                  :href="successAction.url" target="_blank" rel="noopener noreferrer"
                  class="flex items-center justify-center gap-2 w-full py-2 text-xs rounded-xl bg-brand/10 text-brand font-semibold hover:bg-brand/15 transition-all duration-150"
                >
                  <ArrowUpRight class="w-3.5 h-3.5" />
                  {{ t('common.open') }}
                </a>
                <p v-else class="text-[10px] text-text-muted font-mono break-all px-1">{{ successAction.url }}</p>
              </div>
            </template>

            <!-- AES-decrypted content -->
            <template v-else-if="successAction.tag === 'aes'">
              <div class="px-4 py-3 space-y-2">
                <p v-if="successAction.description" class="text-xs text-text-secondary">
                  {{ successAction.description }}
                </p>
                <div v-if="successAction.decrypted" class="bg-surface-base rounded-lg px-3 py-2 border border-border">
                  <p class="text-xs text-text-primary break-all leading-relaxed">{{ successAction.decrypted }}</p>
                </div>
              </div>
            </template>
          </div>

          <div v-if="payResult?.preimage" class="mt-4 text-left">
            <button @click="showPaymentProof = !showPaymentProof"
              class="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
              <Code class="w-3 h-3" />
              {{ t('wallet.preimage') }}
            </button>
            <code v-if="showPaymentProof" class="block mt-1 text-[10px] bg-surface-base px-2.5 py-1.5 rounded-lg font-mono text-text-secondary break-all animate-fade-in">
              {{ payResult.preimage }}
            </code>
          </div>
        </template>
      </div>

      <div class="space-y-2.5 mt-4">
        <button
          @click="emit('done')"
          class="w-full py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-bold btn-primary"
        >
          {{ t('common.done') }}
        </button>

        <button
          @click="reset"
          class="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-all duration-200 font-medium"
        >
          {{ t('wallet.sendAnother') }}
        </button>
      </div>
    </div>
  </div>
</template>
