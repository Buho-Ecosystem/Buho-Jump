<script setup>
/**
 * Receive flow — create invoice with amount + memo, display QR + copy.
 * Amount input supports sats and fiat toggle with live conversion.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat } from '../../composables/useFiat.js'

const { t } = useI18n()
import { formatSats } from '../../lib/utils.js'
import {
  ArrowLeft, Copy, Check, Loader2, AlertTriangle,
  QrCode, RefreshCw, ArrowLeftRight,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'done'])
const { makeInvoice, walletType, checkMintQuote, mintTokens, getBalance, wallets, redeemToken } = useWallet()
const toast = useToast()
const { toFiat, fiatToSats, currency, loadRate } = useFiat()

// ── State ──
const step = ref('form') // 'form' | 'invoice' | 'waiting' | 'success'
const receiveMode = ref('lightning') // 'lightning' | 'token'
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
// Ecash token paste
const tokenInput = ref('')
const redeeming = ref(false)

// Load rate for conversions
loadRate()

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
    invoice.value = result?.invoice || ''
    quoteId.value = result?.quoteId || ''
    if (!invoice.value) throw new Error('No invoice returned')
    step.value = 'invoice'
    generateQR()
    // Start polling for Cashu wallets
    if (quoteId.value && walletType.value === 'cashu') {
      startQuotePoll()
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
        // Mint the tokens
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
  <div class="animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2 mb-4">
      <button
        @click="step === 'form' ? emit('back') : reset()"
        :aria-label="t('common.back')"
        class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200"
      >
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-extrabold">
        {{ step === 'invoice' ? t('wallet.shareInvoice') : t('wallet.receiveTitle') }}
      </span>
    </div>

    <!-- Mode tabs (Cashu only) -->
    <div v-if="walletType === 'cashu' && step === 'form'" class="flex gap-2 mb-3">
      <button @click="receiveMode = 'lightning'"
        :class="receiveMode === 'lightning' ? 'bg-brand text-surface-base' : 'bg-surface-elevated text-text-secondary'"
        class="flex-1 py-1.5 text-xs rounded-xl font-semibold transition-all duration-200">
        ⚡ {{ t('wallet.lightning') }}
      </button>
      <button @click="receiveMode = 'token'"
        :class="receiveMode === 'token' ? 'bg-brand text-surface-base' : 'bg-surface-elevated text-text-secondary'"
        class="flex-1 py-1.5 text-xs rounded-xl font-semibold transition-all duration-200">
        {{ t('wallet.token') }}
      </button>
    </div>

    <!-- ═══ Token paste mode (Cashu) ═══ -->
    <div v-if="receiveMode === 'token' && step === 'form'" class="space-y-3 animate-fade-in-up">
      <div class="space-y-1.5">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {{ t('wallet.pasteToken') }}
        </label>
        <textarea
          v-model="tokenInput"
          :placeholder="t('wallet.pasteTokenPlaceholder')"
          rows="3"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted resize-none"
        />
      </div>
      <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>
      <button
        @click="redeemEcashToken"
        :disabled="!tokenInput.trim() || redeeming"
        class="w-full py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-semibold btn-primary flex items-center justify-center gap-1.5"
      >
        <Loader2 v-if="redeeming" class="w-4 h-4 animate-spin" />
        {{ redeeming ? t('wallet.redeeming') : t('wallet.redeemToken') }}
      </button>
    </div>

    <!-- ═══ Step: Form (Lightning) ═══ -->
    <div v-if="receiveMode === 'lightning' && step === 'form'" class="space-y-3 animate-fade-in-up">

      <!-- Amount with sats/fiat toggle -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ inputMode === 'sats' ? t('wallet.amountSats') : t('wallet.amountFiat', { currency: currency.toUpperCase() }) }}
          </label>
          <button
            @click="toggleInputMode"
            class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium"
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
          autofocus
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted"
        />
        <input
          v-else
          v-model="amountFiat"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="10.00"
          autofocus
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted"
        />
        <p v-if="conversionHint" class="text-[10px] text-text-muted px-1">{{ conversionHint }}</p>
      </div>

      <div class="space-y-1.5">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {{ t('wallet.memo') }} ({{ t('common.optional') }})
        </label>
        <input
          v-model="memo"
          :placeholder="t('wallet.memoPlaceholder')"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
        />
      </div>

      <!-- Error -->
      <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <button
        @click="createInvoice"
        :disabled="!canCreate"
        class="w-full py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-semibold btn-primary flex items-center justify-center gap-1.5"
      >
        <Loader2 v-if="creating" class="w-4 h-4 animate-spin" />
        {{ creating ? t('wallet.creating') : t('wallet.createInvoice') }}
      </button>
    </div>

    <!-- ═══ Step: Invoice display ═══ -->
    <div v-if="step === 'invoice'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-3xl border border-border p-5 text-center shadow-sm">
        <!-- Amount -->
        <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-1">{{ t('wallet.requesting') }}</p>
        <div class="text-2xl font-extrabold tracking-tight">
          {{ formatSats(effectiveSats) }}
          <span class="text-sm font-medium text-text-muted ml-1">{{ t('wallet.sats') }}</span>
        </div>
        <div v-if="toFiat(effectiveSats)" class="text-xs text-text-muted mt-0.5">≈ {{ toFiat(effectiveSats) }}</div>

        <!-- QR Code -->
        <div v-if="qrDataUrl" class="inline-block bg-white p-2 rounded-3xl mt-3 mb-3">
          <img :src="qrDataUrl" alt="Invoice QR" class="w-[180px] h-[180px]" />
        </div>
        <div v-else class="w-[196px] h-[196px] bg-surface-elevated rounded-3xl mx-auto mt-3 mb-3 flex items-center justify-center">
          <QrCode class="w-8 h-8 text-text-muted" />
        </div>

        <!-- Memo -->
        <p v-if="memo" class="text-xs text-text-muted mb-2">{{ memo }}</p>
      </div>

      <!-- Invoice text + copy -->
      <div class="relative">
        <div class="bg-surface-base rounded-lg px-3 py-2 text-[10px] font-mono text-text-muted break-all max-h-16 overflow-y-auto pr-10">
          {{ invoice }}
        </div>
        <button
          @click="copyInvoice"
          class="absolute top-2 right-2 p-1.5 rounded-md bg-surface-card hover:bg-surface-elevated transition-all duration-200"
        >
          <Check v-if="copied" class="w-3 h-3 text-success" />
          <Copy v-else class="w-3 h-3 text-text-muted" />
        </button>
      </div>

      <!-- Waiting for payment (Cashu polling) -->
      <div v-if="polling" class="flex items-center justify-center gap-2 py-2 text-xs text-text-muted animate-pulse">
        <Loader2 class="w-3.5 h-3.5 animate-spin" />
        <span>{{ t('wallet.waitingForPayment') }}</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button
          @click="reset"
          class="py-2.5 text-sm rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold flex items-center justify-center gap-1.5"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          {{ t('wallet.newInvoice') }}
        </button>
        <button
          @click="copyInvoice"
          class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold btn-primary flex items-center justify-center gap-1.5"
        >
          <Check v-if="copied" class="w-4 h-4" />
          <Copy v-else class="w-4 h-4" />
          {{ copied ? t('common.copied') : t('common.copy') }}
        </button>
      </div>
    </div>

    <!-- ═══ Step: Success (Cashu mint complete) ═══ -->
    <div v-if="step === 'success'" class="text-center space-y-4 animate-fade-in-up">
      <div class="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center mx-auto">
        <Check class="w-7 h-7 text-success" />
      </div>
      <div>
        <p class="text-lg font-extrabold">{{ formatSats(mintedAmount) }} {{ t('wallet.sats') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('wallet.receivedSats', { amount: formatSats(mintedAmount) }) }}</p>
      </div>
      <button
        @click="emit('done')"
        class="w-full py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold btn-primary"
      >
        {{ t('common.done') }}
      </button>
    </div>
  </div>
</template>
