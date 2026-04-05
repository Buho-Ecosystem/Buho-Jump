<script setup>
/**
 * Receive flow — unified input for Lightning invoice creation and ecash token redemption.
 *
 * No tabs. Smart detection:
 *   - Default: amount + memo form → create Lightning invoice → QR + copy
 *   - Paste cashuA.../cashuB...: auto-detect → redeem token
 *
 * Amount input supports sats and fiat toggle with live conversion.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat } from '../../composables/useFiat.js'

const { t } = useI18n()
import { formatSats } from '../../lib/utils.js'
import SatButtons from './SatButtons.vue'
import {
  ArrowLeft, Copy, Check, Loader2, AlertTriangle,
  QrCode, RefreshCw, ArrowLeftRight, ArrowDownLeft, Wallet,
  ScanLine, Clipboard,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'done'])
const { makeInvoice, walletType, checkMintQuote, mintTokens, getBalance, wallets, redeemToken, lookupInvoice } = useWallet()
const toast = useToast()
const { toFiat, fiatToSats, currency, loadRate } = useFiat()

// ── State ──
const step = ref('form') // 'form' | 'invoice' | 'success'
const amountSats = ref('')
const amountFiat = ref('')
const inputMode = ref('sats') // 'sats' | 'fiat'
const memo = ref('')
const creating = ref(false)
const error = ref('')
const invoice = ref('')
const copied = ref(false)
const qrDataUrl = ref('')

// Cashu mint quote polling
const quoteId = ref('')
const polling = ref(false)
const mintedAmount = ref(0)
let pollTimer = null

// Ecash token paste (inline — no tabs)
const tokenInput = ref('')
const redeeming = ref(false)
const tokenDetected = computed(() => {
  const v = tokenInput.value.trim().toLowerCase()
  return v.startsWith('cashua') || v.startsWith('cashub')
})

// Load rate for conversions
loadRate()

const isCashu = computed(() => walletType.value === 'cashu')
const isLnbits = computed(() => walletType.value === 'lnbits')

// LNbits payment hash for polling
const paymentHash = ref('')

const effectiveSats = computed(() => parseInt(amountSats.value) || 0)

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

const canCreate = computed(() => {
  return effectiveSats.value > 0 && !creating.value
})

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

async function createInvoice() {
  creating.value = true
  error.value = ''
  try {
    const result = await makeInvoice(effectiveSats.value, memo.value.trim())
    invoice.value = result?.invoice || result?.payment_request || ''
    quoteId.value = result?.quoteId || ''
    paymentHash.value = result?.payment_hash || result?.checking_id || ''
    if (!invoice.value) throw new Error('No invoice returned')
    step.value = 'invoice'
    generateQR()
    // Start polling for Cashu wallets
    if (quoteId.value && isCashu.value) {
      startQuotePoll()
    }
    // Start polling for LNbits wallets
    if (paymentHash.value && isLnbits.value) {
      startLnbitsPoll()
    }
  } catch (err) {
    error.value = err.message || 'Failed to create invoice'
  } finally {
    creating.value = false
  }
}

function startQuotePoll() {
  polling.value = true
  const active = wallets.value.find(w => w.isActive)
  const mintUrl = active?.mints?.[0]
  if (!mintUrl) { polling.value = false; return }

  const QUOTE_POLL_MS = 3000
  pollTimer = setInterval(async () => {
    try {
      const quoteStatus = await checkMintQuote(mintUrl, quoteId.value)
      if (quoteStatus?.paid) {
        clearInterval(pollTimer)
        pollTimer = null
        const result = await mintTokens(mintUrl, effectiveSats.value, quoteId.value)
        mintedAmount.value = result?.amountSats || effectiveSats.value
        polling.value = false
        step.value = 'success'
        await getBalance()
        toast.success(t('wallet.receivedSats', { amount: formatSats(mintedAmount.value) }))
      }
    } catch { /* keep polling */ }
  }, QUOTE_POLL_MS)
}

function startLnbitsPoll() {
  polling.value = true
  const POLL_MS = 3000
  pollTimer = setInterval(async () => {
    try {
      const status = await lookupInvoice({ payment_hash: paymentHash.value })
      if (status?.paid) {
        clearInterval(pollTimer)
        pollTimer = null
        mintedAmount.value = effectiveSats.value
        polling.value = false
        step.value = 'success'
        await getBalance()
        toast.success(t('wallet.receivedSats', { amount: formatSats(mintedAmount.value) }))
      }
    } catch { /* keep polling */ }
  }, POLL_MS)
}

async function redeemEcashToken() {
  if (!tokenInput.value.trim()) return
  redeeming.value = true
  error.value = ''
  try {
    const result = await redeemToken(tokenInput.value.trim())
    mintedAmount.value = result?.amountSats || 0
    step.value = 'success'
    await getBalance()
    toast.success(t('wallet.receivedSats', { amount: formatSats(mintedAmount.value) }))
  } catch (err) {
    error.value = err.message || 'Failed to redeem token'
  } finally {
    redeeming.value = false
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) tokenInput.value = text
  } catch { /* clipboard not available */ }
}

async function generateQR() {
  try {
    const QRCode = (await import('qrcode')).default
    qrDataUrl.value = await QRCode.toDataURL(invoice.value.toUpperCase(), {
      width: 220,
      margin: 2,
      color: {
        dark: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
  } catch {
    toast.error(t('wallet.qrFailed'))
  }
}

function copyInvoice() {
  navigator.clipboard.writeText(invoice.value)
  copied.value = true
  toast.success(t('wallet.invoiceCopied'))
  setTimeout(() => (copied.value = false), 2500)
}

function reset() {
  step.value = 'form'
  amountSats.value = ''
  amountFiat.value = ''
  memo.value = ''
  invoice.value = ''
  qrDataUrl.value = ''
  error.value = ''
  quoteId.value = ''
  paymentHash.value = ''
  polling.value = false
  mintedAmount.value = 0
  tokenInput.value = ''
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onBeforeUnmount(() => {
  clearTimeout(fiatDebounce)
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})
</script>

<template>
  <div class="p-4 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-3 mb-5">
      <button
        @click="step === 'form' ? emit('back') : reset()"
        :aria-label="t('common.back')"
        class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-elevated transition-all duration-200"
      >
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <div>
        <h1 class="text-[15px] font-extrabold leading-tight">
          {{ step === 'invoice' ? t('wallet.shareInvoice')
            : step === 'success' ? t('wallet.statusReceived')
            : t('wallet.receiveTitle') }}
        </h1>
        <p v-if="step === 'form'" class="text-[10px] text-text-muted mt-0.5">
          {{ isCashu ? t('wallet.receiveHintCashu') : t('wallet.receiveHintNwc') }}
        </p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- FORM — unified Lightning + Token               -->
    <!-- ═══════════════════════════════════════════════ -->
    <div v-if="step === 'form'" class="space-y-4 animate-fade-in-up">

      <!-- Hero icon -->
      <div class="flex justify-center">
        <div class="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center">
          <ArrowDownLeft class="w-6 h-6 text-success" />
        </div>
      </div>

      <!-- Amount input area -->
      <div class="bg-surface-card rounded-2xl border border-border p-4 space-y-3">
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

        <!-- Large centered amount display -->
        <div class="text-center">
          <input
            v-if="inputMode === 'sats'"
            v-model="amountSats"
            type="number"
            min="1"
            placeholder="0"
            autofocus
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <input
            v-else
            v-model="amountFiat"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            autofocus
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <p v-if="conversionHint" class="text-[11px] text-text-muted mt-1 font-medium">{{ conversionHint }}</p>
        </div>

        <!-- SatButtons -->
        <SatButtons v-if="inputMode === 'sats'" v-model="amountSats" />
      </div>

      <!-- Memo -->
      <div class="relative">
        <input
          v-model="memo"
          :placeholder="t('wallet.memoPlaceholder')"
          class="w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-muted/60 font-medium pointer-events-none">
          {{ t('common.optional') }}
        </span>
      </div>

      <!-- Create invoice button -->
      <button
        @click="createInvoice"
        :disabled="!canCreate"
        class="w-full py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-2"
      >
        <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
        <Wallet v-else class="w-4 h-4" />
        {{ creating ? t('wallet.creating') : t('wallet.createInvoice') }}
      </button>

      <!-- Token redeem section (Cashu only) — no tabs, just an accordion-style area -->
      <div v-if="isCashu" class="pt-1">
        <div class="relative">
          <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-border" /></div>
          <div class="relative flex justify-center">
            <span class="bg-surface-base px-3 text-[9px] text-text-muted uppercase tracking-widest font-semibold">
              {{ t('wallet.orRedeemToken') }}
            </span>
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <div class="relative">
            <textarea
              v-model="tokenInput"
              :placeholder="t('wallet.pasteTokenPlaceholder')"
              rows="2"
              class="w-full bg-surface-card border border-border rounded-xl pl-3.5 pr-10 py-2.5 text-xs outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted resize-none"
            />
            <button
              type="button"
              @click="pasteFromClipboard"
              :title="t('common.copy')"
              class="absolute top-2.5 right-2.5 p-1 rounded-md text-text-muted hover:text-brand hover:bg-brand/10 transition-all duration-150"
            >
              <Clipboard class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Token detected indicator -->
          <div v-if="tokenDetected" class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium text-success bg-success/10 animate-fade-in">
            <Check class="w-3 h-3" />
            {{ t('wallet.ecashTokenDetected') }}
          </div>

          <button
            v-if="tokenInput.trim()"
            @click="redeemEcashToken"
            :disabled="!tokenInput.trim() || redeeming"
            class="w-full py-2.5 text-xs rounded-xl bg-success/10 text-success hover:bg-success/15 disabled:opacity-40 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5"
          >
            <Loader2 v-if="redeeming" class="w-3.5 h-3.5 animate-spin" />
            {{ redeeming ? t('wallet.redeeming') : t('wallet.redeemToken') }}
          </button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- INVOICE DISPLAY                                -->
    <!-- ═══════════════════════════════════════════════ -->
    <div v-if="step === 'invoice'" class="space-y-4 animate-fade-in-up">

      <!-- QR card -->
      <div class="bg-surface-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <!-- Amount header -->
        <div class="px-4 pt-4 pb-2 text-center">
          <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider">{{ t('wallet.requesting') }}</p>
          <div class="flex items-baseline justify-center gap-1.5 mt-1">
            <span class="text-2xl font-extrabold tracking-tight">{{ formatSats(effectiveSats) }}</span>
            <span class="text-xs font-medium text-text-muted">{{ t('wallet.sats') }}</span>
          </div>
          <p v-if="toFiat(effectiveSats)" class="text-[11px] text-brand mt-0.5 font-medium">≈ {{ toFiat(effectiveSats) }}</p>
        </div>

        <!-- QR Code -->
        <div class="flex justify-center pb-4">
          <div v-if="qrDataUrl" class="bg-white p-2.5 rounded-2xl shadow-sm">
            <img :src="qrDataUrl" alt="Invoice QR" class="w-[176px] h-[176px]" />
          </div>
          <div v-else class="w-[196px] h-[196px] bg-surface-elevated rounded-2xl flex items-center justify-center">
            <QrCode class="w-8 h-8 text-text-muted animate-pulse" />
          </div>
        </div>

        <!-- Memo -->
        <div v-if="memo" class="px-4 pb-3 text-center">
          <p class="text-[11px] text-text-muted italic">{{ memo }}</p>
        </div>

        <!-- Waiting indicator -->
        <div v-if="polling" class="px-4 pb-3">
          <div class="flex items-center justify-center gap-2 py-2 rounded-xl bg-brand/8 text-xs text-brand font-medium animate-pulse">
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            {{ t('wallet.waitingForPayment') }}
          </div>
        </div>
      </div>

      <!-- Invoice text + copy -->
      <div class="relative group">
        <button
          @click="copyInvoice"
          class="w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-left hover:border-brand/40 transition-all duration-200 cursor-pointer"
        >
          <div class="text-[9px] font-mono text-text-muted break-all line-clamp-2 leading-relaxed pr-8">
            {{ invoice }}
          </div>
          <div class="absolute top-1/2 -translate-y-1/2 right-3 p-1 rounded-md transition-colors"
            :class="copied ? 'text-success' : 'text-text-muted group-hover:text-brand'"
          >
            <Check v-if="copied" class="w-3.5 h-3.5" />
            <Copy v-else class="w-3.5 h-3.5" />
          </div>
        </button>
      </div>

      <!-- Actions -->
      <div class="grid grid-cols-2 gap-2.5">
        <button
          @click="reset"
          class="py-2.5 text-sm rounded-2xl bg-surface-card border border-border text-text-secondary hover:bg-surface-elevated transition-all duration-200 font-semibold flex items-center justify-center gap-1.5"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          {{ t('wallet.newInvoice') }}
        </button>
        <button
          @click="copyInvoice"
          class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-1.5"
        >
          <Check v-if="copied" class="w-4 h-4" />
          <Copy v-else class="w-4 h-4" />
          {{ copied ? t('common.copied') : t('common.copy') }}
        </button>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- SUCCESS                                        -->
    <!-- ═══════════════════════════════════════════════ -->
    <div v-if="step === 'success'" class="animate-fade-in-up">
      <div class="text-center pt-8 pb-6">
        <!-- Animated checkmark -->
        <div class="w-16 h-16 rounded-full bg-success/12 flex items-center justify-center mx-auto mb-4 animate-scale-in">
          <Check class="w-8 h-8 text-success" />
        </div>
        <p class="text-2xl font-extrabold tracking-tight">+{{ formatSats(mintedAmount) }}</p>
        <p class="text-xs text-text-muted mt-1.5">{{ t('wallet.receivedSats', { amount: formatSats(mintedAmount) }) }}</p>
        <p v-if="toFiat(mintedAmount)" class="text-[11px] text-brand mt-0.5 font-medium">≈ {{ toFiat(mintedAmount) }}</p>
      </div>
      <button
        @click="emit('done')"
        class="w-full py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-bold btn-primary"
      >
        {{ t('common.done') }}
      </button>
    </div>
  </div>
</template>
