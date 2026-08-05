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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat } from '../../composables/useFiat.js'
import { useOnline } from '../../composables/useOnline.js'
import { useContacts } from '../../composables/useContacts.js'
import { getAvatarColor } from '../../lib/avatarColor.js'

const { t } = useI18n()
import { formatSats, detectPaymentInput } from '../../lib/utils.js'
import { decodePaymentRequestInfo } from '../../lib/cashu-payment-request.js'
import { parseZARFromMetadata, getMerchantInitials } from '../../lib/merchantQR.js'
import { decodeBolt11 } from 'nostr-core'
import {
  fetchLnurlPayParams, fetchLnurlPayInvoice, fetchLnurlPayInvoiceMsat,
  resolveLnurlServiceUrl,
} from '../../lib/lnurl.js'
import { resolveSuccessAction } from '../../lib/lnurlSuccess.js'
import { pollVerify } from '../../lib/lnurlVerify.js'
import { lookupBrantaVerification } from '../../lib/branta.js'
import { hasOriginAccess, requestOriginAccess } from '../../lib/browser/hostPermissions.js'
import QrScanner from '../QrScanner.vue'
import QrDisplay from '../QrDisplay.vue'
import ErrorBanner from '../ErrorBanner.vue'
import SatButtons from './SatButtons.vue'
import {
  ArrowLeft, ScanLine, Wallet, ArrowUpRight, ArrowDownLeft, ArrowLeftRight,
  Check, AlertTriangle, Loader2, AtSign, Store, Timer, Code, Zap,
  Smartphone, BadgeCheck, Coins, Copy,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'done'])
const {
  payInvoice, saveTransactionMetadata, status, walletType, wallets,
  fetchLnurlWithdraw, executeLnurlWithdraw,
  payPaymentRequest, redeemToken, getCashuMintBalances, createToken,
} = useWallet()
const toast = useToast()
const { toFiat, toFiatRaw, fiatToSats, currency, rate, loadRate } = useFiat()
const { online } = useOnline()
const { resolveInput, fetchProfile, getCachedProfile } = useContacts()

// ── State ──
const step = ref('input') // 'input' | 'confirm' | 'merchant-confirm' | 'withdraw-confirm' | 'request-confirm' | 'ecash-share' | 'result'
const showInvoicePreview = ref(false)
const showPaymentProof = ref(false)
const input = ref('')
const amountSats = ref('')
const amountFiat = ref('')
const amountPayout = ref('')
const inputMode = ref('sats') // 'sats' | 'fiat' | 'payout'
const showScanner = ref(false)
const paying = ref(false)
const resolving = ref(false)
const payResult = ref(null)
const payError = ref('')
const resolvedInvoice = ref('')
const resolvedInvoiceAmountMsat = ref(0)

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
const deliveryStatus = ref(null)
const selectedMobileCountry = ref('')
const merchantVerification = ref(null)
const brantaEnabled = ref(true)
const paidTransactionId = ref('')
const lnurlPayParams = ref(null)
let verifyController = null
let brantaController = null

// ── Ecash payment request state (NUT-18 / NUT-26) ──
const requestPayMint = ref('') // mint the payment will be taken from
const requestFallback = ref(null) // { token, amountSats, deliveryError, reclaimed }

// ── Ecash share state (token shown as QR; animated when large, NUT-16) ──
const shareAmountSats = ref('')
const shareMemo = ref('')
const shareToken = ref('')
const shareProofCount = ref(0)
const shareCopied = ref(false)
const shareReclaimed = ref(false)
const creatingShare = ref(false)

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
const mobileCandidates = computed(() => detected.value?.mobile?.candidates || [])
const mobilePayment = computed(() => {
  const mobile = detected.value?.mobile
  if (!mobile) return null
  if (!mobile.ambiguous) return mobile
  return mobile.candidates?.find(candidate => candidate.country.code === selectedMobileCountry.value) || null
})
const payoutCurrency = computed(() => lnurlPayParams.value?.currency || null)
const nextInputModeLabel = computed(() => {
  if (inputMode.value === 'payout') return 'SATS'
  if (inputMode.value === 'sats') return currency.value.toUpperCase()
  return payoutCurrency.value?.code || 'SATS'
})

// ── Pasted invoice decoding ──
// Decode BOLT11 invoices on paste so the embedded amount is shown before
// the user confirms — never ask them to approve a payment blind.
const invoiceDetails = computed(() => {
  if (detected.value?.type !== 'invoice') return null
  try {
    return decodeBolt11(detected.value.value)
  } catch {
    return null // Undecodable invoice — the wallet will reject it on pay
  }
})

const invoiceAmountSats = computed(() => {
  const sats = invoiceDetails.value?.amountSat
  return sats ? Math.round(sats) : 0 // 0 = amountless invoice
})

const isNostrIdentity = computed(() => detected.value?.type === 'nostr-identity')

// ── Ecash payment request (NUT-18 / NUT-26) ──
const isPaymentRequest = computed(() => detected.value?.type === 'payment-request')

const requestInfo = computed(() => {
  if (!isPaymentRequest.value) return null
  return decodePaymentRequestInfo(detected.value.value)
})

// Why this request cannot be paid, in plain language ('' when payable)
const requestBlocker = computed(() => {
  if (!isPaymentRequest.value) return ''
  const info = requestInfo.value
  if (!info?.valid) {
    if (info?.reason === 'unit') return t('wallet.requestUnitUnsupported')
    if (info?.reason === 'mints') return t('wallet.requestInvalidMints')
    return t('wallet.requestInvalid')
  }
  if (info.locked) return t('wallet.requestLockedUnsupported')
  if (!info.transports.length) return t('errors.REQUEST_NO_TRANSPORT')
  if (walletType.value !== 'cashu') return t('wallet.requestNeedsEcash')
  return ''
})

const requestPayMintHost = computed(() => {
  try { return new URL(requestPayMint.value).host } catch { return requestPayMint.value }
})

const requestDeliveryLabel = computed(() => {
  const transport = requestInfo.value?.transports?.[0]
  if (transport?.type === 'nostr') return t('wallet.requestDeliveryNostr')
  if (transport?.type === 'post') return t('wallet.requestDeliveryPost')
  return ''
})

const detectedLabel = computed(() => {
  if (!detected.value) return ''
  if (nostrResolved.value && nostrProfile.value?.lud16) return t('wallet.lightningAddress')
  const labels = {
    invoice: t('wallet.lightningInvoice'),
    lnaddress: t('wallet.lightningAddress'),
    'mobile-payment': t('wallet.mobilePayment'),
    lnurl: t('wallet.lnurl'),
    merchant: t('wallet.merchantDetected'),
    'merchant-unsupported': t('wallet.merchantDetected'),
    'nostr-identity': nostrResolving.value ? t('wallet.resolvingProfile') : t('wallet.nostrIdentity'),
    'payment-request': t('wallet.ecashRequestDetected'),
    'ecash-token': t('wallet.ecashTokenDetected'),
    unknown: t('wallet.unknownFormat'),
  }
  return labels[detected.value.type] || ''
})

const detectedIcon = computed(() => {
  if (detected.value?.type === 'mobile-payment' || detected.value?.mobile) return Smartphone
  if (detected.value?.type === 'merchant' || detected.value?.type === 'merchant-unsupported') return Store
  if (detected.value?.type === 'lnaddress') return AtSign
  if (detected.value?.type === 'nostr-identity') return nostrResolving.value ? Loader2 : AtSign
  if (detected.value?.type === 'payment-request' || detected.value?.type === 'ecash-token') return Coins
  return Zap
})

const detectedColor = computed(() => {
  if (!detected.value) return ''
  if (detected.value.type === 'unknown') return 'text-warning bg-warning/10'
  if (detected.value.type === 'merchant-unsupported') return 'text-warning bg-warning/10'
  if (detected.value.type === 'payment-request') {
    return requestBlocker.value ? 'text-warning bg-warning/10' : 'text-brand bg-brand/10'
  }
  if (detected.value.type === 'ecash-token') return 'text-warning bg-warning/10'
  if (detected.value.type === 'lnurl') return 'text-info bg-info/10'
  if (detected.value.type === 'merchant') return 'text-brand bg-brand/10'
  if (detected.value.type === 'mobile-payment' || detected.value.mobile) return 'text-info bg-info/10'
  if (detected.value.type === 'nostr-identity') return nostrResolving.value ? 'text-text-muted bg-surface-elevated' : 'text-brand bg-brand/10'
  return 'text-success bg-success/10'
})

const isWithdraw = computed(() => detected.value?.lnurlType === 'withdraw')

const needsAmount = computed(() => {
  if (!detected.value) return false
  if (detected.value.type === 'invoice') return !!invoiceDetails.value && invoiceDetails.value.amountMsat == null
  if (detected.value.type === 'merchant') return false
  if (isWithdraw.value) return false
  if (detected.value.type === 'nostr-identity') return nostrResolved.value && !!nostrProfile.value?.lud16
  if (detected.value.type === 'payment-request') {
    return !requestBlocker.value && requestInfo.value?.amountSats == null
  }
  return detected.value.type === 'lnaddress' || detected.value.type === 'lnurl' || detected.value.type === 'mobile-payment'
})

// Effective sats amount: pasted invoices carry their own amount; everything
// else comes from the amount input (fiat mode writes sats via its watcher).
const effectiveSats = computed(() => {
  if (resolvedInvoiceAmountMsat.value > 0) return Math.ceil(resolvedInvoiceAmountMsat.value / 1000)
  if (detected.value?.type === 'invoice') return invoiceAmountSats.value || parseInt(amountSats.value) || 0
  if (detected.value?.type === 'payment-request') {
    return requestInfo.value?.amountSats || parseInt(amountSats.value) || 0
  }
  if (inputMode.value === 'payout' && payoutCurrency.value) {
    const local = Number(amountPayout.value)
    return local > 0 ? Math.floor((local * payoutCurrency.value.multiplier) / 1000) : 0
  }
  return parseInt(amountSats.value) || 0
})

// Conversion display for the inactive denomination
const conversionHint = computed(() => {
  if (inputMode.value === 'payout') {
    return effectiveSats.value > 0 ? `≈ ${formatSats(effectiveSats.value)} sats` : ''
  }
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
  if (detected.value?.type === 'invoice' && !invoiceDetails.value) return t('wallet.invoiceInvalid')
  if (invoiceDetails.value?.isExpired) return t('wallet.invoiceExpired')
  if (!needsAmount.value) return ''
  const sats = effectiveSats.value
  if (!sats) return ''
  if (sats <= 0) return t('wallet.amountTooLow')
  if (status.value?.balance != null && sats > status.value.balance) {
    return t('wallet.insufficientBalance', { balance: formatSats(status.value.balance) })
  }
  const p = lnurlPayParams.value
  if (p && (sats < p.minSendable || sats > p.maxSendable)) {
    return t('wallet.amountRange', { min: formatSats(p.minSendable), max: formatSats(p.maxSendable) })
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
  if (detected.value.type === 'mobile-payment' && detected.value.mobile?.ambiguous && !mobilePayment.value) return false
  if (detected.value.type === 'invoice') {
    return !!invoiceDetails.value && !invoiceDetails.value.isExpired && effectiveSats.value > 0
  }
  if (detected.value.type === 'merchant') return true
  if (isWithdraw.value) return true
  if (detected.value.type === 'payment-request') {
    return !requestBlocker.value && effectiveSats.value > 0
  }
  // Tokens are received, not sent — the input hint points to Receive.
  if (detected.value.type === 'ecash-token') return false
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
  const modes = payoutCurrency.value ? ['payout', 'sats', 'fiat'] : ['sats', 'fiat']
  const index = modes.indexOf(inputMode.value)
  inputMode.value = modes[(index + 1) % modes.length]
}

function chooseMobileCountry(code) {
  selectedMobileCountry.value = code
}

onMounted(async () => {
  try {
    const stored = await chrome.storage.local.get('brantaEnabled')
    brantaEnabled.value = stored.brantaEnabled !== false
  } catch { /* default on */ }
})

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
  clearTimeout(lnurlFetchTimer)
  verifyController?.abort()
  brantaController?.abort()
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

// ── LNURL-pay parameter prefetch ──
// Fetch pay parameters as soon as an LNURL is pasted so fixed amounts
// (minSendable === maxSendable, e.g. point-of-sale invoices) are prefilled
// and shown instead of asking the user to guess. Best-effort: on failure we
// fall back to manual entry and proceed() revalidates against the service.
let lnurlFetchTimer = null
let lnurlFetchSeq = 0

const lnurlFixedAmount = computed(() =>
  !!lnurlPayParams.value
  && !lnurlPayParams.value.currency
  && lnurlPayParams.value.minSendable === lnurlPayParams.value.maxSendable
)

const lnurlRangeHint = computed(() => {
  const p = lnurlPayParams.value
  if (!p || p.minSendable === p.maxSendable) return ''
  return t('wallet.amountRange', { min: formatSats(p.minSendable), max: formatSats(p.maxSendable) })
})

const lnurlPaymentInput = computed(() => {
  const det = detected.value
  if (!det) return null
  if (det.type === 'lnurl') {
    if (det.lnurlType && det.lnurlType !== 'pay') return null
    return det.value
  }
  if (det.type === 'nostr-identity') return nostrResolved.value ? nostrProfile.value?.lud16 || null : null
  if (det.type === 'mobile-payment') return mobilePayment.value?.lightningAddress || null
  if (det.type === 'lnaddress') return det.value
  return null
})

watch(lnurlPaymentInput, (value) => {
  clearTimeout(lnurlFetchTimer)
  lnurlPayParams.value = null
  const seq = ++lnurlFetchSeq
  if (!value) return
  lnurlFetchTimer = setTimeout(async () => {
    try {
      const params = await fetchLnurlPayParams(value)
      if (seq !== lnurlFetchSeq) return // Input changed while fetching
      if (params.tag && params.tag !== 'payRequest') return
      lnurlPayParams.value = params
      if (params.currency) {
        inputMode.value = 'payout'
      } else if (inputMode.value === 'payout') {
        inputMode.value = 'sats'
      }
      if (!params.currency && params.minSendable === params.maxSendable && !amountSats.value) {
        inputMode.value = 'sats'
        amountSats.value = String(params.minSendable)
      }
    } catch { /* fall back to manual amount entry */ }
  }, 400)
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

    let params = lnurlPayParams.value
    if (!params) {
      if (!(await requestOriginAccess(lnurlUrl))) throw new Error(t('wallet.serverAccessDenied'))
      params = await fetchLnurlPayParams(lnurlUrl)
      lnurlPayParams.value = params
      if (!(await hasOriginAccess(params.callback))) {
        payError.value = t('wallet.lnurlCallbackReady')
        return
      }
    }
    if (!(await requestOriginAccess(params.callback))) throw new Error(t('wallet.serverAccessDenied'))

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
    resolvedInvoiceAmountMsat.value = lnResult.amountMsat
    pendingSuccessAction.value = lnResult.successAction || null
    pendingVerifyUrl.value = lnResult.verify || null
    runBrantaVerification(lnResult.invoice)

    // Start countdown — invoice is time-sensitive
    startCountdown()
    step.value = 'merchant-confirm'
  } catch (err) {
    payError.value = err.message || t('wallet.lnurlFailed')
  } finally {
    resolving.value = false
  }
}

function currentPayout() {
  if (inputMode.value !== 'payout' || !payoutCurrency.value) return null
  const amount = Number(amountPayout.value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const decimals = payoutCurrency.value.decimals || 0
  return { code: payoutCurrency.value.code, amount: Number(amount.toFixed(decimals)) }
}

function recipientContext() {
  if (mobilePayment.value) {
    return {
      recipientAddress: mobilePayment.value.lightningAddress,
      recipientName: `${mobilePayment.value.country.provider} · ${mobilePayment.value.display}`,
      source: 'mobile',
    }
  }
  if (nostrProfile.value?.lud16) {
    const mobileAddress = detectPaymentInput(nostrProfile.value.lud16)?.mobile
    return {
      recipientAddress: nostrProfile.value.lud16,
      recipientName: nostrProfile.value.name || nostrProfile.value.lud16,
      source: mobileAddress ? 'mobile' : 'nostr',
    }
  }
  if (detected.value?.type === 'lnaddress') {
    return {
      recipientAddress: detected.value.value,
      recipientName: null,
      source: detected.value.mobile ? 'mobile' : null,
    }
  }
  if (merchantInfo.value) {
    return {
      recipientAddress: detected.value?.value || null,
      recipientName: merchantStoreName.value || merchantInfo.value.name,
      source: 'merchant',
    }
  }
  return { recipientAddress: null, recipientName: null, source: null }
}

async function runBrantaVerification(invoice) {
  merchantVerification.value = null
  brantaController?.abort()
  if (!brantaEnabled.value || !invoice) return
  const controller = new AbortController()
  brantaController = controller
  const verification = await lookupBrantaVerification({ qrText: invoice, signal: controller.signal })
  if (controller.signal.aborted || brantaController !== controller) return
  merchantVerification.value = verification
  if (verification && paidTransactionId.value) {
    saveTransactionMetadata(paidTransactionId.value, { merchantVerification: verification }).catch(() => {})
  }
}

async function resolveLnurlDestination(address, fallbackMessage) {
  resolving.value = true
  try {
    let params = lnurlPaymentInput.value === address ? lnurlPayParams.value : null
    if (!params) {
      const serviceUrl = resolveLnurlServiceUrl(address)
      if (!(await requestOriginAccess(serviceUrl))) throw new Error(t('wallet.serverAccessDenied'))
      params = await fetchLnurlPayParams(address)
      lnurlPayParams.value = params
      // A callback may live on another origin. Finish discovery now, then use
      // the user's next Continue click for that exact permission request.
      if (!(await hasOriginAccess(params.callback))) {
        payError.value = t('wallet.lnurlCallbackReady')
        return
      }
    }
    lnurlPayParams.value = params
    if (!(await requestOriginAccess(params.callback))) throw new Error(t('wallet.serverAccessDenied'))
    const payout = currentPayout()
    const result = await fetchLnurlPayInvoice(params, effectiveSats.value, null, payout)
    resolvedInvoice.value = result.invoice
    resolvedInvoiceAmountMsat.value = result.amountMsat
    pendingSuccessAction.value = result.successAction || null
    pendingVerifyUrl.value = result.verify || null
    runBrantaVerification(result.invoice)
    step.value = 'confirm'
  } catch (err) {
    payError.value = err.message || fallbackMessage
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

  // Ecash payment request → dedicated confirm screen
  if (detected.value.type === 'payment-request') {
    resolving.value = true
    try {
      // Work out which mint the payment would come from, so the confirm
      // screen can say it and the browser can be granted access up front.
      const balances = await getCashuMintBalances() || []
      const info = requestInfo.value
      const accepted = info.mints.length
        ? info.mints
        : balances.map(entry => entry.mint)
      const funded = balances.find(entry =>
        accepted.includes(entry.mint) && entry.balance >= effectiveSats.value)
      if (!funded) {
        payError.value = info.mints.length && !balances.some(entry => accepted.includes(entry.mint) && entry.balance > 0)
          ? t('errors.REQUEST_MINT_MISMATCH')
          : t('wallet.insufficientBalance', { balance: formatSats(status.value?.balance || 0) })
        return
      }
      requestPayMint.value = funded.mint
      step.value = 'request-confirm'
    } finally {
      resolving.value = false
    }
    return
  }

  // LNURL-withdraw → claim flow
  if (isWithdraw.value) {
    resolving.value = true
    try {
      const serviceUrl = resolveLnurlServiceUrl(detected.value.value)
      if (!(await requestOriginAccess(serviceUrl))) throw new Error(t('wallet.serverAccessDenied'))
      const wr = await fetchLnurlWithdraw(detected.value.value)
      withdrawInfo.value = {
        ...wr,
        minSats: wr.minWithdrawable,
        maxSats: wr.maxWithdrawable,
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
    await resolveLnurlDestination(nostrProfile.value.lud16, t('wallet.addressResolveFailed'))
    return
  }

  if (detected.value.type === 'lnaddress' || detected.value.type === 'mobile-payment') {
    const address = mobilePayment.value?.lightningAddress || detected.value.value
    await resolveLnurlDestination(address, t('wallet.addressResolveFailed'))
    return
  }

  if (detected.value.type === 'lnurl') {
    await resolveLnurlDestination(detected.value.value, t('wallet.lnurlFailed'))
    return
  }

  if (detected.value.type === 'invoice') runBrantaVerification(detected.value.value)
  step.value = 'confirm'
}

async function confirmWithdraw() {
  paying.value = true
  payError.value = ''
  try {
    const sats = parseInt(withdrawAmountSats.value) || 0
    if (!sats || sats <= 0) throw new Error('Invalid amount')
    if (!(await requestOriginAccess(withdrawInfo.value?.callback))) {
      throw new Error(t('wallet.serverAccessDenied'))
    }
    await executeLnurlWithdraw(withdrawInfo.value, sats)
    payResult.value = { withdrawn: true, amount: sats }
    step.value = 'result'
  } catch (err) {
    payError.value = err.message || t('wallet.withdrawFailed')
  } finally {
    paying.value = false
  }
}

// ── Ecash share (token as QR / copyable string) ──

async function createShareToken() {
  const amount = parseInt(shareAmountSats.value) || 0
  if (amount <= 0 || creatingShare.value) return
  creatingShare.value = true
  payError.value = ''
  try {
    const mint = wallets.value.find(wallet => wallet.isActive && wallet.type === 'cashu')?.mints?.[0]
    if (!mint || !(await requestOriginAccess(mint))) throw new Error(t('cashu.mintAccessDenied'))
    const result = await createToken(amount, shareMemo.value.trim())
    shareToken.value = result?.token || ''
    if (!shareToken.value) throw new Error(t('wallet.paymentFailed'))
    // NUT-16: tokens with more than 2 proofs get an animated QR.
    try {
      const { getDecodedToken } = await import('@cashu/cashu-ts')
      shareProofCount.value = getDecodedToken(shareToken.value).proofs.length
    } catch {
      shareProofCount.value = 0
    }
  } catch (err) {
    payError.value = err.message?.startsWith('errors.') ? t(err.message) : (err.message || t('wallet.paymentFailed'))
  } finally {
    creatingShare.value = false
  }
}

function copyShareToken() {
  if (!shareToken.value) return
  navigator.clipboard.writeText(shareToken.value)
  shareCopied.value = true
  toast.success(t('common.copied'))
  setTimeout(() => (shareCopied.value = false), 2500)
}

async function takeBackShareToken() {
  if (!shareToken.value || shareReclaimed.value || paying.value) return
  paying.value = true
  payError.value = ''
  try {
    await redeemToken(shareToken.value)
    shareReclaimed.value = true
    toast.success(t('wallet.tokenTakenBack'))
  } catch (err) {
    payError.value = err.message?.startsWith('errors.') ? t(err.message) : (err.message || t('wallet.paymentFailed'))
  } finally {
    paying.value = false
  }
}

function resetShare() {
  shareAmountSats.value = ''
  shareMemo.value = ''
  shareToken.value = ''
  shareProofCount.value = 0
  shareCopied.value = false
  shareReclaimed.value = false
  creatingShare.value = false
}

async function confirmPayRequest() {
  paying.value = true
  payError.value = ''
  try {
    if (!requestPayMint.value || !(await requestOriginAccess(requestPayMint.value))) {
      throw new Error(t('cashu.mintAccessDenied'))
    }
    const result = await payPaymentRequest(detected.value.value, effectiveSats.value)
    if (result?.delivered) {
      payResult.value = { requestSent: true, amount: result.amountSats }
    } else {
      // The sats already moved into this token; keep it visible so the user
      // can share it by hand or pull it back into the wallet.
      requestFallback.value = {
        token: result?.token || '',
        amountSats: result?.amountSats || effectiveSats.value,
        reclaimed: false,
        copied: false,
      }
    }
    step.value = 'result'
  } catch (err) {
    payError.value = err.message?.startsWith('errors.') ? t(err.message) : (err.message || t('wallet.paymentFailed'))
  } finally {
    paying.value = false
  }
}

function copyFallbackToken() {
  if (!requestFallback.value?.token) return
  navigator.clipboard.writeText(requestFallback.value.token)
  requestFallback.value.copied = true
  toast.success(t('common.copied'))
  setTimeout(() => { if (requestFallback.value) requestFallback.value.copied = false }, 2500)
}

async function takeBackRequestToken() {
  if (!requestFallback.value?.token || requestFallback.value.reclaimed) return
  paying.value = true
  payError.value = ''
  try {
    await redeemToken(requestFallback.value.token)
    requestFallback.value.reclaimed = true
    toast.success(t('wallet.tokenTakenBack'))
  } catch (err) {
    payError.value = err.message?.startsWith('errors.') ? t(err.message) : (err.message || t('wallet.paymentFailed'))
  } finally {
    paying.value = false
  }
}

async function confirmPay() {
  paying.value = true
  payError.value = ''
  try {
    if (walletType.value === 'cashu') {
      const mint = wallets.value.find(wallet => wallet.isActive && wallet.type === 'cashu')?.mints?.[0]
      if (!mint || !(await requestOriginAccess(mint))) throw new Error(t('cashu.mintAccessDenied'))
    }
    const invoice = resolvedInvoice.value || detected.value.value
    const amountlessSats = detected.value?.type === 'invoice' && invoiceDetails.value?.amountMsat == null
      ? effectiveSats.value
      : undefined
    const result = await payInvoice(invoice, amountlessSats)
    payResult.value = result
    stopCountdown()

    successAction.value = await resolveSuccessAction(pendingSuccessAction.value, result?.preimage)
    const verifyUrl = pendingVerifyUrl.value
    const payout = currentPayout()
    const recipient = recipientContext()
    const paidSats = (() => {
      try { return Math.round(decodeBolt11(invoice)?.amountSat || effectiveSats.value || 0) }
      catch { return effectiveSats.value || 0 }
    })()
    const fiatAtPayment = toFiatRaw(paidSats)
    const fiatSnapshot = fiatAtPayment != null ? {
      code: currency.value.toUpperCase(), amount: fiatAtPayment,
      rate: rate.value, capturedAt: Date.now(),
    } : null
    let transactionId = result?.payment_hash || result?.paymentHash || ''
    if (!transactionId) {
      try { transactionId = decodeBolt11(invoice)?.paymentHash || '' } catch { /* already paid */ }
    }
    paidTransactionId.value = transactionId

    if (transactionId) {
      try {
        await saveTransactionMetadata(transactionId, {
          ...recipient,
          successAction: successAction.value,
          verifyUrl,
          payout,
          fiatSnapshot,
          merchantVerification: merchantVerification.value,
        })
      } catch { /* metadata never changes payment success */ }
    }

    pendingSuccessAction.value = null
    pendingVerifyUrl.value = null
    step.value = 'result'

    // LUD-21 status is progressive: update this receipt and the durable
    // transaction record without holding the success screen open.
    if (verifyUrl) {
      verifyController?.abort()
      verifyController = new AbortController()
      pollVerify(verifyUrl, (next) => {
        deliveryStatus.value = next
        paymentVerified.value = next.settled
        if (transactionId) {
          saveTransactionMetadata(transactionId, { deliveryStatus: next }).catch(() => {})
        }
      }, { signal: verifyController.signal, expectPayout: recipient.source === 'mobile' }).catch(() => {})
    }
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

function goBack() {
  if (step.value === 'input') { emit('back'); return }
  if (step.value === 'ecash-share') {
    // A created token holds real sats: never discard it on a stray tap.
    // The user leaves through "Take it back" or "Done" instead.
    if (shareToken.value && !shareReclaimed.value) return
    reset()
    return
  }
  if (step.value === 'merchant-confirm' || step.value === 'withdraw-confirm') { reset(); return }
  step.value = 'input'
}

function reset() {
  step.value = 'input'
  input.value = ''
  amountSats.value = ''
  amountFiat.value = ''
  amountPayout.value = ''
  inputMode.value = 'sats'
  payResult.value = null
  payError.value = ''
  resolvedInvoice.value = ''
  resolvedInvoiceAmountMsat.value = 0
  merchantInfo.value = null
  merchantZAR.value = null
  merchantStoreName.value = ''
  merchantSats.value = 0
  merchantRateStale.value = false
  merchantLogoFailed.value = false
  withdrawInfo.value = null
  withdrawAmountSats.value = ''
  requestPayMint.value = ''
  requestFallback.value = null
  resetShare()
  successAction.value = null
  pendingSuccessAction.value = null
  pendingVerifyUrl.value = null
  paymentVerified.value = false
  deliveryStatus.value = null
  selectedMobileCountry.value = ''
  merchantVerification.value = null
  paidTransactionId.value = ''
  fiatRateUnavailable.value = false
  nostrProfile.value = null
  nostrResolving.value = false
  nostrResolved.value = false
  verifyController?.abort()
  verifyController = null
  brantaController?.abort()
  brantaController = null
  stopCountdown()
}
</script>

<template>
  <div class="p-4 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-3 mb-5">
      <button
        @click="goBack"
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
            : step === 'request-confirm' ? t('wallet.reviewRequestTitle')
            : step === 'ecash-share' ? t('wallet.shareEcashTitle')
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

      <!-- Mobile-money destination and explicit country choice for local numbers -->
      <div v-if="detected?.mobile" class="bg-surface-card rounded-2xl border border-info/25 p-3.5 space-y-3 animate-fade-in-up">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-border">
            <img :src="(mobilePayment || detected.mobile).country.logoUrl" :alt="(mobilePayment || detected.mobile).country.provider" class="w-full h-full object-contain p-1" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold truncate">{{ (mobilePayment || detected.mobile).display }}</p>
            <p class="text-[10px] text-text-muted truncate">
              {{ (mobilePayment || detected.mobile).country.provider }} · {{ (mobilePayment || detected.mobile).operator }} · {{ (mobilePayment || detected.mobile).country.currency }}
            </p>
          </div>
        </div>
        <div v-if="detected.mobile.ambiguous && !mobilePayment" class="space-y-2">
          <p class="text-[10px] text-warning">{{ t('wallet.chooseMobileCountry') }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="candidate in mobileCandidates" :key="candidate.country.code"
              @click="chooseMobileCountry(candidate.country.code)"
              class="px-3 py-2 rounded-xl border border-border bg-surface-elevated hover:border-brand/40 text-left transition-colors">
              <span class="text-xs font-semibold">{{ candidate.country.flag }} {{ candidate.country.name }}</span>
              <span class="block text-[9px] text-text-muted">{{ candidate.country.provider }}</span>
            </button>
          </div>
        </div>
        <p v-else class="text-[10px] text-info">{{ mobilePayment?.country.hint || detected.mobile.country.hint }}</p>
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

      <!-- Decoded invoice amount (pasted BOLT11 carries its own amount) -->
      <div v-if="detected?.type === 'invoice' && invoiceAmountSats" class="bg-surface-card rounded-2xl border border-border p-4 text-center animate-fade-in-up">
        <div class="flex items-baseline justify-center gap-1.5">
          <span class="text-3xl font-extrabold tracking-tight tabular-nums">{{ formatSats(invoiceAmountSats) }}</span>
          <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
        </div>
        <p v-if="toFiat(invoiceAmountSats)" class="text-[11px] text-brand mt-1 font-medium">≈ {{ toFiat(invoiceAmountSats) }}</p>
        <p v-if="invoiceDetails?.description" class="text-[11px] text-text-muted mt-1 truncate">{{ invoiceDetails.description }}</p>
      </div>

      <ErrorBanner
        v-if="detected?.type === 'invoice' && amountError && !needsAmount"
        type="error"
        :message="amountError"
      />

      <!-- Ecash request that cannot be paid — say why in plain words -->
      <ErrorBanner
        v-if="isPaymentRequest && requestBlocker"
        type="warning"
        :message="requestBlocker"
      />

      <!-- Ecash token pasted into Send — it belongs in Receive -->
      <ErrorBanner
        v-if="detected?.type === 'ecash-token'"
        type="warning"
        :message="t('wallet.tokenBelongsInReceive')"
      />

      <!-- Ecash request summary (also shown for blocked requests so the
           user still sees what was asked of them) -->
      <div v-if="isPaymentRequest && requestInfo?.valid" class="bg-surface-card rounded-2xl border border-border p-4 text-center animate-fade-in-up">
        <template v-if="requestInfo.amountSats">
          <div class="flex items-baseline justify-center gap-1.5">
            <span class="text-3xl font-extrabold tracking-tight tabular-nums">{{ formatSats(requestInfo.amountSats) }}</span>
            <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
          </div>
          <p v-if="toFiat(requestInfo.amountSats)" class="text-[11px] text-brand mt-1 font-medium">≈ {{ toFiat(requestInfo.amountSats) }}</p>
        </template>
        <p v-else class="text-sm font-bold">{{ t('wallet.requestChooseAmount') }}</p>
        <p v-if="requestInfo.description" class="text-[11px] text-text-muted mt-1 truncate">{{ requestInfo.description }}</p>
        <p v-if="requestInfo.mintHosts.length" class="text-[10px] text-text-muted mt-1.5 truncate">
          {{ t('wallet.requestAcceptsMint', { host: requestInfo.mintHosts.join(', ') }) }}
        </p>
      </div>

      <!-- Amount input card (only when needed) -->
      <div v-if="needsAmount" class="bg-surface-card rounded-2xl border border-border p-4 space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ inputMode === 'sats' ? t('wallet.amountSats')
              : inputMode === 'payout' ? t('wallet.recipientGets', { currency: payoutCurrency?.code })
              : t('wallet.amountFiat', { currency: currency.toUpperCase() }) }}
          </label>
          <button
            v-if="!lnurlFixedAmount"
            @click="toggleInputMode"
            class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium"
          >
            <ArrowLeftRight class="w-3 h-3" />
            {{ nextInputModeLabel }}
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
            :readonly="lnurlFixedAmount"
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <input
            v-else-if="inputMode === 'fiat'"
            v-model="amountFiat"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div v-else class="flex items-baseline justify-center gap-2">
            <input
              v-model="amountPayout"
              type="number"
              min="0"
              :step="payoutCurrency?.decimals > 0 ? 0.01 : 1"
              :placeholder="payoutCurrency?.decimals > 0 ? '0.00' : '0'"
              class="min-w-0 text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span class="text-sm font-bold text-info">{{ payoutCurrency?.code }}</span>
          </div>
          <p v-if="conversionHint" class="text-[11px] text-text-muted mt-1 font-medium">{{ conversionHint }}</p>
        </div>

        <SatButtons
          v-if="inputMode === 'sats' && !lnurlFixedAmount"
          v-model="amountSats"
          :max="status?.balance || Infinity"
        />

        <p v-if="fiatRateUnavailable && inputMode === 'fiat'" class="text-[10px] text-warning text-center">
          {{ t('wallet.rateUnavailable') }}
        </p>
        <p v-else-if="amountError" class="text-[10px] text-error text-center">
          {{ amountError }}
        </p>
        <p v-else-if="lnurlRangeHint" class="text-[10px] text-text-muted text-center">
          {{ lnurlRangeHint }}
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

      <!-- Ecash share entry (Cashu wallets, before anything is typed) -->
      <button
        v-if="walletType === 'cashu' && !input.trim()"
        @click="step = 'ecash-share'"
        class="w-full py-2 text-xs text-text-muted hover:text-brand transition-all duration-200 font-medium flex items-center justify-center gap-1.5"
      >
        <Coins class="w-3.5 h-3.5" />
        {{ t('wallet.shareEcashInstead') }}
      </button>
    </div>

    <!-- ═══ Step: Ecash Share (token as QR, animated when large) ═══ -->
    <div v-if="step === 'ecash-share'" class="space-y-4 animate-fade-in-up">

      <!-- Amount + memo form -->
      <template v-if="!shareToken">
        <div class="bg-surface-card rounded-2xl border border-border p-4 space-y-3">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ t('wallet.amountSats') }}
          </label>
          <div class="text-center">
            <input
              v-model="shareAmountSats"
              type="number"
              min="1"
              placeholder="0"
              autofocus
              class="w-full text-center text-3xl font-extrabold tracking-tight bg-transparent outline-none tabular-nums placeholder:text-text-muted/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p v-if="toFiat(parseInt(shareAmountSats) || 0)" class="text-[11px] text-text-muted mt-1 font-medium">
              ≈ {{ toFiat(parseInt(shareAmountSats) || 0) }}
            </p>
          </div>
          <SatButtons v-model="shareAmountSats" :max="status?.balance || Infinity" />
        </div>

        <div class="relative">
          <input
            v-model="shareMemo"
            :placeholder="t('wallet.memoPlaceholder')"
            class="w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
          />
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-muted/60 font-medium pointer-events-none">
            {{ t('common.optional') }}
          </span>
        </div>

        <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs animate-scale-in">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{{ payError }}</span>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            @click="step = 'input'; resetShare(); payError = ''"
            class="py-2.5 text-sm rounded-2xl bg-surface-card border border-border text-text-secondary hover:bg-surface-elevated transition-all duration-200 font-semibold"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            @click="createShareToken"
            :disabled="!(parseInt(shareAmountSats) > 0) || creatingShare"
            class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-1.5"
          >
            <Loader2 v-if="creatingShare" class="w-4 h-4 animate-spin" />
            <Coins v-else class="w-4 h-4" />
            {{ creatingShare ? t('wallet.creating') : t('wallet.createShareToken') }}
          </button>
        </div>
      </template>

      <!-- Token display -->
      <template v-else>
        <div class="bg-surface-card rounded-2xl border border-border overflow-hidden shadow-sm">
          <div class="px-4 pt-4 pb-2 text-center">
            <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider">{{ t('wallet.shareEcashScanHint') }}</p>
            <div class="flex items-baseline justify-center gap-1.5 mt-1">
              <span class="text-2xl font-extrabold tracking-tight">{{ formatSats(parseInt(shareAmountSats) || 0) }}</span>
              <span class="text-xs font-medium text-text-muted">{{ t('wallet.sats') }}</span>
            </div>
          </div>
          <div class="flex justify-center pb-4">
            <QrDisplay :value="shareToken" :mode="shareProofCount > 2 ? 'animated' : 'auto'" />
          </div>
          <div v-if="shareMemo" class="px-4 pb-3 text-center">
            <p class="text-[11px] text-text-muted italic">{{ shareMemo }}</p>
          </div>
        </div>

        <!-- Token text + copy -->
        <button
          @click="copyShareToken"
          class="relative w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-left hover:border-brand/40 transition-all duration-200 cursor-pointer"
        >
          <div class="text-[9px] font-mono text-text-muted break-all line-clamp-2 leading-relaxed pr-8">
            {{ shareToken }}
          </div>
          <div class="absolute top-1/2 -translate-y-1/2 right-3 p-1 rounded-md transition-colors"
            :class="shareCopied ? 'text-success' : 'text-text-muted'"
          >
            <Check v-if="shareCopied" class="w-3.5 h-3.5" />
            <Copy v-else class="w-3.5 h-3.5" />
          </div>
        </button>

        <div v-if="payError" class="flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs animate-scale-in">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{{ payError }}</span>
        </div>

        <p v-if="shareReclaimed" class="text-[11px] text-success text-center font-medium">
          {{ t('wallet.tokenTakenBackDesc') }}
        </p>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            @click="takeBackShareToken"
            :disabled="paying || shareReclaimed"
            class="py-2.5 text-sm rounded-2xl bg-surface-card border border-border text-text-secondary hover:bg-surface-elevated disabled:opacity-40 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5"
          >
            <Loader2 v-if="paying" class="w-3.5 h-3.5 animate-spin" />
            {{ t('wallet.takeItBack') }}
          </button>
          <button
            @click="emit('done')"
            class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-bold btn-primary"
          >
            {{ t('common.done') }}
          </button>
        </div>
      </template>
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

    <!-- ═══ Step: Request Confirm (ecash payment request) ═══ -->
    <div v-if="step === 'request-confirm'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div class="p-5 text-center">
          <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-2">{{ t('wallet.sending') }}</p>
          <div class="flex items-baseline justify-center gap-1.5">
            <span class="text-3xl font-extrabold tracking-tight">{{ formatSats(effectiveSats) }}</span>
            <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
          </div>
          <p v-if="toFiat(effectiveSats)" class="text-[11px] text-brand mt-1 font-medium">≈ {{ toFiat(effectiveSats) }}</p>
          <p v-if="requestInfo?.description" class="text-[11px] text-text-muted mt-1 truncate">{{ requestInfo.description }}</p>
        </div>

        <!-- How the payment travels -->
        <div class="flex items-center gap-2 px-4 py-2.5 border-t border-border text-brand bg-brand/10">
          <Coins class="w-3.5 h-3.5" />
          <span class="text-[11px] font-medium truncate">{{ requestDeliveryLabel }}</span>
        </div>

        <!-- Which mint pays -->
        <div v-if="requestPayMint" class="flex items-center gap-2 px-4 py-2.5 border-t border-border text-[11px] text-text-muted">
          <Wallet class="w-3.5 h-3.5" />
          <span class="truncate">{{ t('wallet.requestPaysFrom', { host: requestPayMintHost }) }}</span>
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
          @click="confirmPayRequest"
          :disabled="paying"
          class="py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-50 transition-all duration-200 font-bold btn-primary flex items-center justify-center gap-1.5"
        >
          <Loader2 v-if="paying" class="w-4 h-4 animate-spin" />
          <Wallet v-else class="w-4 h-4" />
          {{ paying ? t('wallet.paying') : t('common.confirm') }}
        </button>
      </div>
    </div>

    <!-- ═══ Step: Confirm (normal) ═══ -->
    <div v-if="step === 'confirm'" class="space-y-4 animate-fade-in-up">

      <div class="bg-surface-card rounded-2xl border border-border overflow-hidden shadow-sm">
        <div class="p-5 text-center">
          <p class="text-[10px] text-text-muted font-medium uppercase tracking-wider mb-2">{{ t('wallet.sending') }}</p>
          <div v-if="currentPayout()" class="flex items-baseline justify-center gap-1.5 mb-1">
            <span class="text-3xl font-extrabold tracking-tight">{{ currentPayout().amount }}</span>
            <span class="text-sm font-bold text-info">{{ currentPayout().code }}</span>
          </div>
          <div v-if="effectiveSats" class="flex items-baseline justify-center gap-1.5">
            <span :class="currentPayout() ? 'text-sm font-semibold text-text-muted' : 'text-3xl font-extrabold tracking-tight'">{{ currentPayout() ? '≈ ' : '' }}{{ formatSats(effectiveSats) }}</span>
            <span class="text-sm font-medium text-text-muted">{{ t('wallet.sats') }}</span>
          </div>
          <div v-else class="text-xs text-text-muted">{{ t('wallet.amountInInvoice') }}</div>
          <p v-if="effectiveSats && toFiat(effectiveSats)" class="text-[11px] text-brand mt-1 font-medium">
            ≈ {{ toFiat(effectiveSats) }}
          </p>
          <p v-if="invoiceDetails?.description" class="text-[11px] text-text-muted mt-1 truncate">
            {{ invoiceDetails.description }}
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

      <a v-if="merchantVerification" :href="merchantVerification.verifyUrl || undefined" target="_blank" rel="noopener noreferrer"
        class="flex items-center gap-3 p-3 rounded-2xl border border-success/25 bg-success/8 text-left">
        <img v-if="merchantVerification.logoUrl" :src="merchantVerification.logoUrl" alt="" class="w-9 h-9 rounded-lg object-contain bg-white p-1" />
        <div v-else class="w-9 h-9 rounded-lg bg-success/15 flex items-center justify-center"><BadgeCheck class="w-5 h-5 text-success" /></div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold truncate">{{ merchantVerification.name || t('wallet.verifiedMerchant') }}</p>
          <p class="text-[10px] text-success">{{ t('wallet.verifiedByBranta') }}</p>
        </div>
      </a>

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
        <!-- Animated checkmark (warning icon while a token needs rescuing) -->
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-scale-in"
          :class="requestFallback && !requestFallback.reclaimed ? 'bg-warning/12' : 'bg-success/12'"
        >
          <AlertTriangle v-if="requestFallback && !requestFallback.reclaimed" class="w-8 h-8 text-warning" />
          <Check v-else class="w-8 h-8 text-success" />
        </div>

        <!-- Ecash request: delivery failed, the token holds the sats -->
        <template v-if="requestFallback">
          <template v-if="requestFallback.reclaimed">
            <h3 class="text-[15px] font-extrabold mb-1">{{ t('wallet.tokenTakenBack') }}</h3>
            <p class="text-xs text-text-muted">{{ t('wallet.tokenTakenBackDesc') }}</p>
          </template>
          <template v-else>
            <h3 class="text-[15px] font-extrabold mb-1">{{ t('wallet.requestDeliveryFailed') }}</h3>
            <p class="text-xs text-text-muted px-2">{{ t('wallet.requestDeliveryFailedHint') }}</p>

            <button
              @click="copyFallbackToken"
              class="relative mt-4 w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-left hover:border-brand/40 transition-all duration-200 cursor-pointer"
            >
              <div class="text-[9px] font-mono text-text-muted break-all line-clamp-3 leading-relaxed pr-8">
                {{ requestFallback.token }}
              </div>
              <div class="absolute top-1/2 -translate-y-1/2 right-3 p-1 rounded-md transition-colors"
                :class="requestFallback.copied ? 'text-success' : 'text-text-muted'"
              >
                <Check v-if="requestFallback.copied" class="w-3.5 h-3.5" />
                <Copy v-else class="w-3.5 h-3.5" />
              </div>
            </button>

            <button
              @click="takeBackRequestToken"
              :disabled="paying"
              class="mt-2.5 w-full py-2.5 text-xs rounded-xl bg-success/10 text-success hover:bg-success/15 disabled:opacity-40 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5"
            >
              <Loader2 v-if="paying" class="w-3.5 h-3.5 animate-spin" />
              {{ t('wallet.takeTokenBack', { amount: formatSats(requestFallback.amountSats) }) }}
            </button>

            <div v-if="payError" class="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-error/10 text-error text-xs text-left">
              <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{{ payError }}</span>
            </div>
          </template>
        </template>

        <!-- Withdraw success -->
        <template v-else-if="payResult?.withdrawn">
          <p class="text-2xl font-extrabold tracking-tight">+{{ formatSats(payResult.amount) }}</p>
          <p class="text-xs text-text-muted mt-1.5">{{ t('wallet.withdrawSuccessDesc') }}</p>
        </template>

        <!-- Payment success -->
        <template v-else>
          <template v-if="payResult?.requestSent">
            <p class="text-2xl font-extrabold tracking-tight">-{{ formatSats(payResult.amount) }}</p>
            <h3 class="text-[15px] font-extrabold mb-1 mt-1">{{ t('wallet.paymentSent') }}</h3>
            <p class="text-xs text-text-muted">{{ t('wallet.requestPaidDesc') }}</p>
          </template>
          <template v-else>
            <h3 class="text-[15px] font-extrabold mb-1">{{ t('wallet.paymentSent') }}</h3>
            <p class="text-xs text-text-muted">
              {{ merchantInfo ? `${t('wallet.merchantPaying')} ${merchantInfo.name}` : t('wallet.paymentSuccess') }}
            </p>
          </template>
          <p v-if="paymentVerified" class="text-[10px] text-success mt-1 font-medium">
            {{ t('wallet.paymentVerified') }}
          </p>

          <div v-if="deliveryStatus?.hasPayout" class="mt-3 rounded-2xl border p-3 text-left"
            :class="deliveryStatus.delivered ? 'border-success/25 bg-success/8' : 'border-info/25 bg-info/8'">
            <div class="flex items-center gap-2">
              <Check v-if="deliveryStatus.delivered" class="w-4 h-4 text-success" />
              <Loader2 v-else class="w-4 h-4 text-info animate-spin" />
              <p class="text-xs font-bold">{{ deliveryStatus.delivered ? t('wallet.mobileDelivered') : t('wallet.mobileDeliveryPending') }}</p>
            </div>
            <p v-if="deliveryStatus.recipient" class="text-[10px] text-text-secondary mt-1">{{ deliveryStatus.recipient }}</p>
            <p v-if="deliveryStatus.receipt" class="text-[9px] font-mono text-text-muted mt-1 break-all">{{ deliveryStatus.receipt }}</p>
          </div>

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
                <div v-if="successAction.secret" class="bg-surface-base rounded-lg px-3 py-2 border border-border">
                  <p class="text-xs text-text-primary break-all leading-relaxed">{{ successAction.secret }}</p>
                </div>
                <p v-else-if="successAction.decryptError" class="text-[10px] text-warning">{{ t('wallet.successActionDecryptFailed') }}</p>
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
