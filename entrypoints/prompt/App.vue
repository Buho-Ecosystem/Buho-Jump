<script setup>
/**
 * Permission prompt — the gate between websites and the user's identity.
 *
 * Minimal, trust-first layout:
 * - Site identity first (who is asking) + plain-language intent
 * - One permission summary; protocol terms live behind "Technical details"
 * - A safe visit-scoped default; permanent choices live behind "More options"
 * - Payments always show the amount up front and never auto-approve
 * - Unlock mode shows the requesting site + password entry
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../../composables/useTheme.js'
import { useFiat } from '../../composables/useFiat.js'
import { truncateKey } from '../../lib/utils.js'
import { eventKindLabel } from '../../lib/eventKinds.js'
import { isLoopbackHostname, normalizeWebOrigin } from '../../lib/origins.js'
import {
  ShieldCheck, Globe, Fingerprint, FileSignature, Lock, Unlock,
  Check, Clock, KeyRound, Eye, EyeOff, AlertTriangle, ShieldOff,
  Loader2, Wallet, Zap, ChevronDown,
} from 'lucide-vue-next'

useTheme()
const { t } = useI18n()
const { toFiat, loadRate } = useFiat()

const mode = ref('permission') // 'permission' or 'unlock'
const requestOrigin = ref('')
const origin = ref('') // for unlock mode — which site triggered it
const method = ref('')
const kind = ref('')
const profileId = ref('')
const requestId = ref('')
const accountName = ref('')
const accountNpub = ref('')
const accountMode = ref('') // 'local' or 'nip46'
const profilePicture = ref('')
const loading = ref(true)
const deciding = ref('')

// Unlock mode state
const unlockPassword = ref('')
const unlockError = ref('')
const unlockBusy = ref(false)
const showPassword = ref(false)

// Payment methods — both require per-transaction approval + budget UI
const PAYMENT_METHODS = ['weblnSendPayment', 'weblnKeysend']

// Budget "remember" state (payment methods only)
const rememberBudget = ref(false)
const budgetAmount = ref('')

// Favicon + disclosure state
const faviconFailed = ref(false)
const eventData = ref(null)
const showEventData = ref(false)
const showMore = ref(false)
const siteTitle = ref('')
const siteFavicon = ref('')
const queuedCount = ref(0)

// Profile fetch with timeout
async function fetchWithTimeout(message, ms = 5000) {
  let timer
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  requestId.value = params.get('requestId') || ''
  mode.value = params.get('mode') || 'permission'
  requestOrigin.value = normalizeWebOrigin(params.get('origin') || '') || ''
  origin.value = params.get('origin') || ''
  method.value = params.get('method') || ''
  kind.value = params.get('kind') || ''
  profileId.value = params.get('profileId') || ''
  siteTitle.value = params.get('siteTitle') || ''
  siteFavicon.value = params.get('siteFavicon') || ''
  const queued = parseInt(params.get('queued') || '0', 10)
  queuedCount.value = Number.isFinite(queued) && queued > 0 ? queued : 0

  // Unlock mode — only needs origin context, no account data
  if (mode.value === 'unlock') {
    loading.value = false
    return
  }

  // Load fiat rate for payment prompts (non-blocking)
  if (PAYMENT_METHODS.includes(method.value)) loadRate()

  try {
    const accountsRes = await fetchWithTimeout({ type: 'GET_ACCOUNTS', params: [] })
    const accountList = accountsRes?.result || accountsRes
    const active = Array.isArray(accountList)
      ? accountList.find(a => a.id === profileId.value)
      : null
    if (active) {
      accountName.value = active.name || ''
      accountNpub.value = active.npub || ''
      accountMode.value = active.mode || ''

      if (active.pubkey) {
        try {
          const profileResult = await fetchWithTimeout({ type: 'FETCH_PROFILE', params: [active.pubkey] })
          const profile = profileResult?.result || profileResult
          if (profile?.picture) profilePicture.value = profile.picture
          if (profile?.display_name) accountName.value = profile.display_name
          else if (profile?.name && !accountName.value) accountName.value = profile.name
        } catch {
          // Profile fetch timed out or failed — continue with account name
        }
      }
    }
  } catch {
    // Non-critical — continue without profile data
  }

  // Load extra data (event data for signEvent, payment info for weblnSendPayment)
  if (requestId.value) {
    try {
      const key = `prompt_event_${requestId.value}`
      const data = await chrome.storage.session.get(key)
      if (data[key]) {
        eventData.value = data[key]
        // Default budget to 2x payment amount — conservative default
        if (PAYMENT_METHODS.includes(method.value) && data[key].amountSats) {
          budgetAmount.value = String(data[key].amountSats * 2)
        }
      }
    } catch {}
  }

  loading.value = false
})

// ── Permission metadata ──
const PERMISSION_INFO = computed(() => ({
  getPublicKey: {
    label: t('prompt.permPublicLabel'),
    what: t('prompt.permPublicWhat'),
    detail: t('prompt.permPublicDetail'),
    icon: Fingerprint,
    risk: 'low',
    riskLabel: t('prompt.permPublicRisk'),
  },
  signEvent: {
    label: t('prompt.permSignLabel'),
    what: t('prompt.permSignWhat'),
    detail: t('prompt.permSignDetail'),
    icon: FileSignature,
    risk: 'medium',
    riskLabel: t('prompt.permSignRisk'),
  },
  nip04_encrypt: {
    label: t('prompt.permEncryptLabel'),
    what: t('prompt.permEncryptWhat'),
    detail: t('prompt.permEncryptDetail'),
    icon: Lock,
    risk: 'medium',
    riskLabel: t('prompt.permEncryptRisk'),
  },
  nip04_decrypt: {
    label: t('prompt.permDecryptLabel'),
    what: t('prompt.permDecryptWhat'),
    detail: t('prompt.permDecryptDetail'),
    icon: Unlock,
    risk: 'medium',
    riskLabel: t('prompt.permDecryptRisk'),
  },
  nip44_encrypt: {
    label: t('prompt.permEncryptLabel'),
    what: t('prompt.permEncryptWhat'),
    detail: t('prompt.permEncryptDetail'),
    icon: Lock,
    risk: 'medium',
    riskLabel: t('prompt.permEncryptRisk'),
  },
  nip44_decrypt: {
    label: t('prompt.permDecryptLabel'),
    what: t('prompt.permDecryptWhat'),
    detail: t('prompt.permDecryptDetail'),
    icon: Unlock,
    risk: 'medium',
    riskLabel: t('prompt.permDecryptRisk'),
  },
  weblnEnable: {
    label: t('prompt.permWeblnLabel'),
    what: t('prompt.permWeblnWhat'),
    detail: t('prompt.permWeblnDetail'),
    icon: Zap,
    risk: 'medium',
    riskLabel: t('prompt.permWeblnRisk'),
  },
  weblnSendPayment: {
    label: t('prompt.permWeblnPayLabel'),
    what: t('prompt.permWeblnPayWhat'),
    detail: t('prompt.permWeblnPayDetail'),
    icon: Zap,
    risk: 'high',
    riskLabel: t('prompt.permWeblnPayRisk'),
  },
  weblnKeysend: {
    label: t('prompt.permKeysendLabel'),
    what: t('prompt.permKeysendWhat'),
    detail: t('prompt.permKeysendDetail'),
    icon: Zap,
    risk: 'high',
    riskLabel: t('prompt.permKeysendRisk'),
  },
}))

const permInfo = computed(() => {
  const base = PERMISSION_INFO.value[method.value] || {
    label: method.value,
    what: t('prompt.permDefaultWhat'),
    detail: '',
    icon: ShieldCheck,
    risk: 'medium',
    riskLabel: t('prompt.permDefaultRisk'),
  }

  if (method.value !== 'signEvent') return base

  const actions = {
    '0': [t('prompt.actionProfileLabel'), t('prompt.actionProfileWhat')],
    '1': [t('prompt.actionNoteLabel'), t('prompt.actionNoteWhat')],
    '3': [t('prompt.actionContactsLabel'), t('prompt.actionContactsWhat')],
    '4': [t('prompt.actionMessageLabel'), t('prompt.actionMessageWhat')],
    '6': [t('prompt.actionRepostLabel'), t('prompt.actionRepostWhat')],
    '7': [t('prompt.actionReactionLabel'), t('prompt.actionReactionWhat')],
    '9734': [t('prompt.actionZapLabel'), t('prompt.actionZapWhat')],
    '10002': [t('prompt.actionRelaysLabel'), t('prompt.actionRelaysWhat')],
    '27235': [t('prompt.actionLoginLabel'), t('prompt.actionLoginWhat')],
    '30023': [t('prompt.actionArticleLabel'), t('prompt.actionArticleWhat')],
    '30078': [t('prompt.actionAppDataLabel'), t('prompt.actionAppDataWhat')],
  }
  const action = actions[kind.value]
  if (!action) return base
  return { ...base, label: action[0], what: action[1] }
})

const riskBadge = computed(() => {
  if (permInfo.value.risk === 'low') return { class: 'text-success bg-success/10 border-success/20', dot: 'bg-success' }
  if (permInfo.value.risk === 'high') return { class: 'text-error bg-error/10 border-error/20', dot: 'bg-error' }
  return { class: 'text-warning bg-warning/10 border-warning/20', dot: 'bg-warning' }
})

const kindLabel = computed(() => {
  if (!kind.value) return ''
  return eventKindLabel(kind.value, t)
})

// Content-first preview: show what would actually be published, so the
// user approves the note text, not an abstract category. Ciphertext-looking
// content is labeled instead of dumped.
const eventContentPreview = computed(() => {
  if (!isSignEvent.value || isHttpAuth.value) return null
  const content = eventData.value?.content
  if (typeof content !== 'string' || !content.trim()) return null
  const compact = content.trim()
  const looksEncrypted = compact.length >= 24
    && /^[A-Za-z0-9+/=_-]+(\?iv=[A-Za-z0-9+/=]+)?$/.test(compact)
  return { text: compact.slice(0, 2000), encrypted: looksEncrypted }
})


// Show clean hostname for display, full origin for trust verification
const displayHost = computed(() => {
  try {
    return new URL(requestOrigin.value).host.replace(/^www\./, '')
  } catch {
    return requestOrigin.value
  }
})

const fullOrigin = computed(() => requestOrigin.value)

const isHttp = computed(() => {
  try {
    const url = new URL(fullOrigin.value)
    return url.protocol === 'http:' && !isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
})

const faviconUrl = computed(() => {
  // Prefer browser-provided favicon (higher quality, correct path)
  if (siteFavicon.value) return siteFavicon.value
  try {
    const url = new URL(requestOrigin.value)
    return `${url.origin}/favicon.ico`
  } catch {
    return ''
  }
})

// Color-coded initial for favicon fallback
const hostInitial = computed(() => {
  const h = displayHost.value || '?'
  return h[0].toUpperCase()
})

// Payment info (weblnSendPayment + weblnKeysend)
const isPayment = computed(() => PAYMENT_METHODS.includes(method.value))

const paymentAmount = computed(() => {
  if (!isPayment.value || !eventData.value) return null
  return eventData.value.amountSats || null
})

const budgetAmountFiat = computed(() => {
  const sats = parseInt(budgetAmount.value)
  if (!sats || sats <= 0) return null
  return toFiat(sats)
})

const paymentBudget = computed(() => {
  if (!isPayment.value || !eventData.value) return null
  const { budgetSats, spentSats } = eventData.value
  if (!budgetSats) return null
  return { budget: budgetSats, spent: spentSats || 0, remaining: budgetSats - (spentSats || 0) }
})

const accountModeBadge = computed(() => {
  return accountMode.value === 'nip46' ? t('account.external') : t('account.local')
})

// signEvent disclosure — only show the event toggle when there is event data
const isSignEvent = computed(() => method.value === 'signEvent' && !!eventData.value)
const isHttpAuth = computed(() => isSignEvent.value && eventData.value?.kind === 27235)

const technicalProtocol = computed(() => {
  if (method.value.startsWith('nip44_')) return 'NIP-07 · NIP-44'
  if (method.value.startsWith('nip04_')) return 'NIP-07 · NIP-04'
  if (method.value === 'signEvent') return isHttpAuth.value ? 'NIP-07 · NIP-98' : 'NIP-07'
  if (method.value === 'getPublicKey') return 'NIP-07'
  if (method.value.startsWith('webln')) return 'WebLN'
  return method.value
})

// Unlock origin display
const unlockOriginDisplay = computed(() => {
  if (!origin.value) return ''
  try {
    return origin.value.replace(/^(www\.)?/, '')
  } catch {
    return origin.value
  }
})

const unlockOriginFavicon = computed(() => {
  if (!origin.value) return ''
  try {
    return `https://${origin.value}/favicon.ico`
  } catch {
    return ''
  }
})

const unlockFaviconFailed = ref(false)

async function respond(decision) {
  deciding.value = decision
  try {
    const payload = {
      requestId: requestId.value,
      decision,
    }

    // Include budget if user opted in during payment approval
    if (rememberBudget.value && isPayment.value && decision.startsWith('allow')) {
      const budget = parseInt(budgetAmount.value) || 0
      if (budget > 0) payload.setBudget = budget
    }

    await chrome.runtime.sendMessage({
      type: 'PERMISSION_RESPONSE',
      params: [payload],
    })
    window.close()
  } catch {
    deciding.value = ''
  }
}

function closeWindow() {
  window.close()
}

async function submitUnlock() {
  if (!unlockPassword.value || unlockBusy.value) return
  unlockError.value = ''
  unlockBusy.value = true
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'UNLOCK_RESPONSE',
      params: [{
        requestId: requestId.value,
        password: unlockPassword.value,
      }],
    })
    if (res?.error) {
      const msg = res.error
      if (msg.startsWith('TOO_MANY_ATTEMPTS:')) {
        unlockError.value = t('lock.tooManyAttempts', { seconds: msg.split(':')[1] })
      } else if (msg === 'WRONG_PASSWORD') {
        unlockError.value = t('lock.wrongPassword')
      } else {
        unlockError.value = t(`errors.${msg}`, msg)
      }
      unlockBusy.value = false
    } else {
      window.close()
    }
  } catch (err) {
    unlockError.value = err.message || t('lock.wrongPassword')
    unlockBusy.value = false
  }
}
</script>

<template>
  <div class="w-full min-h-screen bg-surface-base flex items-start justify-center">
  <div class="w-full max-w-[420px] min-h-[400px] bg-surface-base text-text-primary flex flex-col select-none">

    <!-- Top accent strip -->
    <div class="h-[3px] bg-gradient-to-r from-brand via-brand-light to-brand" />

    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center p-8">
      <div class="space-y-3 text-center animate-fade-in">
        <ShieldCheck class="w-8 h-8 text-brand mx-auto animate-pulse" />
        <p class="text-xs text-text-muted">{{ t('common.loading') }}</p>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════ -->
    <!-- UNLOCK MODE                                          -->
    <!-- ════════════════════════════════════════════════════ -->
    <template v-else-if="mode === 'unlock'">
      <div class="flex-1 flex flex-col px-6 pt-6 pb-6 overflow-y-auto animate-fade-in-up">

        <!-- Lock icon + title -->
        <div class="text-center space-y-3 pt-2 pb-5">
          <div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto">
            <Lock class="w-7 h-7 text-brand" />
          </div>
          <div>
            <h1 class="text-lg font-extrabold">{{ t('prompt.lockedTitle') }}</h1>
            <p class="text-xs text-text-muted mt-1 leading-relaxed">{{ t('prompt.lockedDesc') }}</p>
          </div>
        </div>

        <!-- Requesting site context -->
        <div v-if="unlockOriginDisplay"
          class="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-surface-card border border-border mb-4">
          <div class="w-9 h-9 rounded-xl bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
            <img
              v-if="unlockOriginFavicon && !unlockFaviconFailed"
              :src="unlockOriginFavicon"
              @error="unlockFaviconFailed = true"
              class="w-5 h-5"
              alt=""
            />
            <Globe v-else class="w-4 h-4 text-text-muted" />
          </div>
          <div class="min-w-0 flex-1">
            <span class="text-[10px] text-text-muted font-medium uppercase tracking-wide">{{ t('prompt.lockedRequestedBy') }}</span>
            <div class="text-xs font-semibold truncate">{{ unlockOriginDisplay }}</div>
          </div>
        </div>

        <!-- Password input with visibility toggle -->
        <div class="space-y-2 mb-4">
          <div class="relative">
            <input
              v-model="unlockPassword"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="t('lock.enterPassword')"
              autofocus
              @keydown.enter="submitUnlock"
              class="w-full pl-4 pr-14 py-3 text-sm rounded-xl bg-surface-card border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
              :class="unlockError ? 'border-error focus:border-error' : 'border-border focus:border-brand'"
            />
            <button
              @click="showPassword = !showPassword"
              type="button"
              tabindex="-1"
              :aria-label="showPassword ? t('prompt.hidePassword') : t('prompt.showPassword')"
              class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-elevated transition-all"
            >
              <Eye v-if="!showPassword" class="w-4 h-4" />
              <EyeOff v-else class="w-4 h-4" />
            </button>
          </div>
          <p v-if="unlockError" class="flex items-center gap-1.5 text-[11px] text-error font-medium px-1">
            <AlertTriangle class="w-3.5 h-3.5 shrink-0" />
            {{ unlockError }}
          </p>
        </div>

        <div class="flex-1 min-h-2" />

        <!-- Actions -->
        <div class="space-y-2.5">
          <button
            @click="submitUnlock"
            :disabled="!unlockPassword || unlockBusy"
            class="w-full flex items-center justify-center gap-2 py-3.5 text-sm rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all btn-primary"
          >
            <Loader2 v-if="unlockBusy" class="w-4 h-4 animate-spin" />
            <KeyRound v-else class="w-4 h-4" />
            {{ t('lock.unlock') }}
          </button>
          <button
            @click="closeWindow"
            :disabled="unlockBusy"
            class="w-full py-3 text-[13px] rounded-2xl text-text-muted font-semibold hover:bg-surface-card disabled:opacity-50 transition-all"
          >
            {{ t('common.cancel') }}
          </button>
        </div>

      </div>
    </template>

    <!-- ════════════════════════════════════════════════════ -->
    <!-- PERMISSION MODE                                      -->
    <!-- ════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="flex-1 flex flex-col px-6 pt-5 pb-6 overflow-y-auto animate-fade-in-up">

        <!-- ── Site identity ── -->
        <div class="flex items-center gap-3.5">
          <div class="w-12 h-12 rounded-2xl border border-border flex items-center justify-center shrink-0 overflow-hidden"
            :class="faviconFailed ? 'bg-brand text-surface-base' : 'bg-surface-elevated'">
            <img
              v-if="faviconUrl && !faviconFailed"
              :src="faviconUrl"
              @error="faviconFailed = true"
              class="w-7 h-7"
              alt=""
            />
            <span v-else class="text-base font-bold">{{ hostInitial }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[15px] font-extrabold truncate leading-tight">{{ siteTitle || displayHost }}</div>
            <div class="text-xs text-text-secondary mt-0.5">{{ t('prompt.wantsAccess') }}</div>
          </div>
        </div>

        <!-- Full origin (trust verification) -->
        <div class="mt-2 text-[10px] text-text-muted font-mono truncate">{{ fullOrigin }}</div>

        <!-- HTTP warning -->
        <div v-if="isHttp"
          class="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/8 border border-warning/20">
          <AlertTriangle class="w-3.5 h-3.5 text-warning shrink-0" />
          <span class="text-[11px] text-warning font-medium">{{ t('prompt.httpWarning') }}</span>
        </div>

        <!-- A burst of requests reads as one guided flow, not window spam -->
        <p v-if="queuedCount > 0" class="mt-2.5 text-center text-[10px] text-text-muted">
          {{ t('prompt.moreWaiting', { n: queuedCount }) }}
        </p>

        <!-- ── Permission summary ── -->
        <div class="mt-5 rounded-2xl border border-border bg-surface-card overflow-hidden">
          <div class="flex items-start gap-3 px-4 py-3.5">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="riskBadge.class">
              <component :is="permInfo.icon" class="w-5 h-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-bold leading-snug">{{ permInfo.label }}</div>
              <p class="text-[11px] text-text-muted mt-1 leading-relaxed">{{ permInfo.what }}</p>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
                <span class="inline-flex items-center gap-1 text-[10px] font-semibold" :class="riskBadge.class.split(' ')[0]">
                  <span class="w-1.5 h-1.5 rounded-full" :class="riskBadge.dot" />
                  {{ permInfo.riskLabel }}
                </span>
                <span v-if="kindLabel"
                  class="inline-flex items-center text-[9px] font-medium px-2 py-0.5 rounded-full bg-surface-elevated text-text-muted border border-border">
                  {{ kindLabel }}
                </span>
              </div>
            </div>
          </div>

          <!-- What will actually be published (signEvent, content-first) -->
          <div v-if="eventContentPreview" class="px-4 py-3 border-t border-border">
            <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1.5">{{ t('prompt.eventPreview') }}</p>
            <p v-if="eventContentPreview.encrypted" class="text-[11px] text-text-muted italic">
              {{ t('prompt.encryptedContent') }}
            </p>
            <p v-else class="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {{ eventContentPreview.text }}
            </p>
          </div>

          <!-- Payment amount (weblnSendPayment / weblnKeysend) -->
          <div v-if="isPayment" class="px-4 py-3 border-t border-border bg-surface-elevated/40">
            <div class="flex items-center justify-between">
              <span class="text-xs text-text-muted font-medium">{{ t('prompt.payAmount') }}</span>
              <div class="text-right">
                <span class="text-lg font-extrabold">{{ paymentAmount ? paymentAmount.toLocaleString() + ' sats' : t('prompt.payAmountUnknown') }}</span>
                <span v-if="paymentAmount && toFiat(paymentAmount)" class="block text-[11px] text-text-muted">≈ {{ toFiat(paymentAmount) }}</span>
              </div>
            </div>
            <div v-if="paymentBudget" class="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
              <span class="text-[11px] text-text-muted">{{ t('prompt.budgetRemaining') }}</span>
              <span class="text-[11px] font-semibold" :class="paymentAmount && paymentBudget.remaining >= paymentAmount ? 'text-success' : 'text-warning'">
                {{ paymentBudget.remaining.toLocaleString() }} / {{ paymentBudget.budget.toLocaleString() }} sats
              </span>
            </div>
          </div>

          <!-- NIP-98 HTTP Auth — show target up front (security-relevant) -->
          <div v-if="isHttpAuth" class="px-4 py-3 border-t border-border space-y-1.5">
            <p class="text-[10px] text-text-muted font-semibold uppercase tracking-wide">{{ t('prompt.httpAuth') }}</p>
            <div class="bg-surface-base rounded-lg p-2.5 border border-border flex items-center gap-2">
              <span class="text-[9px] font-bold uppercase text-brand bg-brand/10 px-1.5 py-0.5 rounded shrink-0">
                {{ eventData.tags?.find(tag => tag[0] === 'method')?.[1] || 'GET' }}
              </span>
              <!-- Mid-truncate: keep start AND end visible so tampering shows -->
              <span class="text-[10px] text-text-secondary font-mono">
                {{ truncateKey(eventData.tags?.find(tag => tag[0] === 'u')?.[1] || '', 34, 14) }}
              </span>
            </div>
          </div>

          <div v-if="permInfo.detail && !isHttpAuth" class="px-4 py-2.5 border-t border-border bg-surface-elevated/40">
            <p class="text-[10px] text-text-muted leading-relaxed">{{ permInfo.detail }}</p>
          </div>

          <!-- Protocol names and raw event data are available without burdening new users. -->
          <button @click="showEventData = !showEventData"
            class="w-full flex items-center justify-between px-4 py-2.5 border-t border-border text-[11px] text-text-muted hover:text-text-secondary transition-all font-medium">
            <span>{{ showEventData ? t('prompt.hideTechnicalDetails') : t('prompt.technicalDetails') }}</span>
            <ChevronDown class="w-3.5 h-3.5 transition-transform" :class="showEventData ? 'rotate-180' : ''" />
          </button>
          <div v-if="showEventData" class="px-4 pb-3 space-y-2">
            <div class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-base px-3 py-2 text-[10px]">
              <span class="text-text-muted">{{ t('prompt.protocol') }}</span>
              <span class="font-mono text-text-secondary">{{ technicalProtocol }}</span>
            </div>
            <div v-if="isSignEvent" class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-base px-3 py-2 text-[10px]">
              <span class="text-text-muted">{{ t('prompt.eventType') }}</span>
              <span class="text-text-secondary">{{ kindLabel || eventData.kind }}
                <span class="font-mono text-text-muted/70">({{ eventData.kind }})</span>
              </span>
            </div>
            <pre v-if="isSignEvent" class="text-[10px] leading-relaxed font-mono bg-surface-base rounded-lg p-3 max-h-[160px] overflow-auto border border-border text-text-secondary whitespace-pre-wrap break-all">{{ JSON.stringify(eventData, null, 2) }}</pre>
          </div>
        </div>

        <!-- ── Account identity ── -->
        <div class="mt-4 flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-surface-card border border-border">
          <div class="w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :class="profilePicture ? '' : 'bg-brand text-surface-base'">
            <img v-if="profilePicture" :src="profilePicture" alt="" class="w-full h-full object-cover" />
            <span v-else class="text-xs font-bold">{{ (accountName || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
              <span class="text-xs font-semibold truncate">{{ accountName || t('prompt.yourAccount') }}</span>
            </div>
            <div v-if="accountNpub" class="text-[10px] text-text-muted font-mono mt-0.5 truncate">
              {{ truncateKey(accountNpub, 10, 6) }}
            </div>
          </div>
          <span class="text-[9px] px-2 py-0.5 rounded-md bg-surface-elevated text-text-muted font-semibold uppercase tracking-wide shrink-0">
            {{ accountModeBadge }}
          </span>
        </div>

        <!-- Spacer pushes actions to the bottom -->
        <div class="flex-1 min-h-5" />

        <!-- ════════════════════════════════════════════════ -->
        <!-- ACTIONS                                          -->
        <!-- ════════════════════════════════════════════════ -->
        <div class="space-y-2.5 stagger-4 animate-fade-in-up">

          <!-- ── Payment: budget opt-in + confirm / deny ── -->
          <template v-if="isPayment">
            <div v-if="!paymentBudget" class="rounded-2xl border border-border bg-surface-card overflow-hidden">
              <label class="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none hover:bg-surface-elevated/50 transition-colors">
                <input
                  v-model="rememberBudget"
                  type="checkbox"
                  class="w-4 h-4 rounded border-border accent-[var(--brand-primary)]"
                />
                <div class="min-w-0 flex items-center gap-1.5">
                  <Wallet class="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span class="text-[11px] font-semibold text-text-secondary">{{ t('prompt.rememberBudget') }}</span>
                </div>
              </label>
              <div v-if="rememberBudget" class="px-3.5 pb-3 pt-0.5 border-t border-border/50 animate-fade-in">
                <div class="flex items-center gap-2">
                  <input
                    v-model="budgetAmount"
                    type="number"
                    min="1"
                    class="flex-1 bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand transition-colors tabular-nums"
                  />
                  <span class="text-[11px] text-text-muted font-semibold shrink-0">sats</span>
                </div>
                <div class="flex items-center justify-between mt-1 px-0.5">
                  <p class="text-[10px] text-text-muted">{{ t('prompt.rememberBudgetHint') }}</p>
                  <span v-if="budgetAmountFiat" class="text-[10px] text-text-muted tabular-nums shrink-0 ml-2">≈ {{ budgetAmountFiat }}</span>
                </div>
              </div>
            </div>

            <button
              @click="respond('allow_once')"
              :disabled="!!deciding"
              class="w-full flex items-center justify-center gap-2 py-3.5 text-sm rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all btn-primary"
            >
              <Loader2 v-if="deciding === 'allow_once'" class="w-4 h-4 animate-spin" />
              <Zap v-else class="w-4 h-4" />
              {{ t('prompt.confirmPayment') }}
            </button>
            <button
              @click="respond('deny_once')"
              :disabled="!!deciding"
              class="w-full py-3 text-[13px] rounded-2xl text-text-muted font-semibold hover:bg-surface-card disabled:opacity-50 transition-all"
            >
              {{ t('prompt.deny') }}
            </button>
          </template>

          <!-- ── Standard: allow / not now / more ── -->
          <template v-else>
            <button
              @click="respond('allow_session')"
              :disabled="!!deciding"
              class="w-full flex items-center justify-center gap-2 py-3.5 text-sm rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all btn-primary"
            >
              <Loader2 v-if="deciding === 'allow_session'" class="w-4 h-4 animate-spin" />
              <Check v-else class="w-4 h-4" />
              {{ t('prompt.allowForVisit') }}
            </button>
            <p class="text-center text-[10px] text-text-muted px-2 leading-relaxed">{{ t('prompt.allowForVisitHint') }}</p>
            <button
              @click="respond('deny_once')"
              :disabled="!!deciding"
              class="w-full py-3 text-[13px] rounded-2xl text-text-muted font-semibold hover:bg-surface-card disabled:opacity-50 transition-all"
            >
              {{ t('prompt.notNow') }}
            </button>

            <button @click="showMore = !showMore"
              class="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-all font-medium">
              {{ t('common.more') }}
              <ChevronDown class="w-3 h-3 transition-transform" :class="showMore ? 'rotate-180' : ''" />
            </button>
            <!-- Kind-scoped wording says exactly what a standing rule covers -->
            <div v-if="showMore" class="flex items-center justify-center gap-2 animate-fade-in">
              <button @click="respond('allow_always')" :disabled="!!deciding"
                class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-xl text-text-muted hover:text-success hover:bg-success/8 transition-all font-medium disabled:opacity-50">
                <Clock class="w-3.5 h-3.5" />
                {{ isSignEvent && kindLabel ? t('prompt.allowAlwaysKind', { kind: kindLabel }) : t('prompt.allowAlways') }}
              </button>
              <span class="text-border text-[10px]">|</span>
              <button @click="respond('deny_always')" :disabled="!!deciding"
                class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-xl text-text-muted hover:text-error hover:bg-error/8 transition-all font-medium disabled:opacity-50">
                <ShieldOff class="w-3.5 h-3.5" />
                {{ isSignEvent && kindLabel ? t('prompt.denyAlwaysKind', { kind: kindLabel }) : t('prompt.denyAlways') }}
              </button>
            </div>
          </template>

        </div>

      </div>
    </template>
  </div>
  </div>
</template>
