<script setup>
/**
 * Permission prompt — the gate between websites and the user's identity.
 *
 * Minimal, trust-first layout:
 * - Site identity first (who is asking) + plain-language intent
 * - One permission summary; protocol terms live behind "Technical details"
 * - One-time approval and explicit site trust stay visible in the footer
 * - Payments always show the amount up front and never auto-approve
 * - Unlock mode shows the requesting site + password entry
 */
import { ref, computed, onMounted } from 'vue'
import UnlockForm from '../../components/UnlockForm.vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../../composables/useTheme.js'
import { useFiat } from '../../composables/useFiat.js'
import { accountProfile } from '../../lib/accountProfile.js'
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

// Payment methods — both require per-transaction approval + budget UI
const PAYMENT_METHODS = ['weblnSendPayment', 'weblnKeysend']

// Budget "remember" state (payment methods only)
const rememberBudget = ref(false)
const budgetAmount = ref('')
const validBudget = computed(() => Number.isSafeInteger(Number(budgetAmount.value)) && Number(budgetAmount.value) > 0)

// Favicon + disclosure state
const faviconFailed = ref(false)
const eventData = ref(null)
const responseError = ref('')
const isLogin = computed(() => method.value === 'getPublicKey' || (method.value === 'signEvent' && ['22242', '27235'].includes(kind.value)))
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
        // Optional metadata must never hold the approval UI behind a slow relay.
        fetchWithTimeout({ type: 'FETCH_PROFILE', params: [active.pubkey] }).then(result => {
          const profile = result?.result || result
          const safe = accountProfile(profile)
          if (safe?.picture) profilePicture.value = safe.picture
          accountName.value = safe?.display_name || safe?.name || accountName.value
        }).catch(() => {})
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
  getRelays: {
    label: t('prompt.permRelaysLabel'), what: t('prompt.permRelaysWhat'), detail: '', icon: Globe,
  },
  getPublicKey: {
    label: t('prompt.permPublicLabel'),
    what: t('prompt.permPublicWhat'),
    detail: t('prompt.permPublicDetail'),
    icon: Fingerprint,
  },
  signEvent: {
    label: t('prompt.permSignLabel'),
    what: t('prompt.permSignWhat'),
    detail: t('prompt.permSignDetail'),
    icon: FileSignature,
  },
  nip04_encrypt: {
    label: t('prompt.permEncryptLabel'),
    what: t('prompt.permEncryptWhat'),
    detail: t('prompt.permEncryptDetail'),
    icon: Lock,
  },
  nip04_decrypt: {
    label: t('prompt.permDecryptLabel'),
    what: t('prompt.permDecryptWhat'),
    detail: t('prompt.permDecryptDetail'),
    icon: Unlock,
  },
  nip44_encrypt: {
    label: t('prompt.permEncryptLabel'),
    what: t('prompt.permEncryptWhat'),
    detail: t('prompt.permEncryptDetail'),
    icon: Lock,
  },
  nip44_decrypt: {
    label: t('prompt.permDecryptLabel'),
    what: t('prompt.permDecryptWhat'),
    detail: t('prompt.permDecryptDetail'),
    icon: Unlock,
  },
  weblnEnable: {
    label: t('prompt.permWeblnLabel'),
    what: t('prompt.permWeblnWhat'),
    detail: t('prompt.permWeblnDetail'),
    icon: Zap,
  },
  weblnSendPayment: {
    label: t('prompt.permWeblnPayLabel'),
    what: t('prompt.permWeblnPayWhat'),
    detail: t('prompt.permWeblnPayDetail'),
    icon: Zap,
  },
  weblnKeysend: {
    label: t('prompt.permKeysendLabel'),
    what: t('prompt.permKeysendWhat'),
    detail: t('prompt.permKeysendDetail'),
    icon: Zap,
  },
}))

const permInfo = computed(() => {
  const base = PERMISSION_INFO.value[method.value] || {
    label: t('prompt.permSignLabel'),
    what: t('prompt.permDefaultWhat'),
    detail: '',
    icon: ShieldCheck,
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
    '22242': [t('prompt.actionLoginLabel'), t('prompt.actionLoginWhat')],
    '27235': [t('prompt.actionLoginLabel'), t('prompt.actionLoginWhat')],
    '30023': [t('prompt.actionArticleLabel'), t('prompt.actionArticleWhat')],
    '30078': [t('prompt.actionAppDataLabel'), t('prompt.actionAppDataWhat')],
  }
  const action = actions[kind.value]
  if (!action) return base
  return { ...base, label: action[0], what: action[1] }
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

async function respond(decision) {
  if (deciding.value) return
  responseError.value = ''
  deciding.value = decision
  try {
    const payload = {
      requestId: requestId.value,
      decision,
    }

    // Include budget if user opted in during payment approval
    if (rememberBudget.value && isPayment.value && decision.startsWith('allow')) {
      const budget = Number(budgetAmount.value) || 0
      if (Number.isSafeInteger(budget) && budget > 0) payload.setBudget = budget
    }

    const response = await chrome.runtime.sendMessage({
      type: 'PERMISSION_RESPONSE',
      params: [payload],
    })
    if (response?.error) throw new Error(response.error)
    window.close()
  } catch {
    responseError.value = t('prompt.responseFailed')
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
  <div class="prompt-window bg-surface-base text-text-primary">
    <div v-if="loading" class="flex-1 flex items-center justify-center" role="status">
      <Loader2 class="w-6 h-6 animate-spin text-brand" :aria-label="t('common.loading')" />
    </div>
    <UnlockForm v-else-if="mode === 'unlock'" :origin="unlockOriginDisplay" :error="unlockError" :loading="unlockBusy" dismissible @submit="unlockPassword = $event; submitUnlock()" @cancel="closeWindow" />
    <template v-else>
      <main class="prompt-content space-y-4">
        <header class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0 overflow-hidden">
            <img v-if="faviconUrl && !faviconFailed" :src="faviconUrl" @error="faviconFailed = true" referrerpolicy="no-referrer" class="w-6 h-6" alt="" />
            <Globe v-else class="w-5 h-5 text-text-secondary" />
          </div>
          <!-- The origin is authoritative; a website's chosen title is not. Never truncate it. -->
          <div class="min-w-0">
            <p class="text-sm font-semibold break-all" dir="ltr">{{ fullOrigin }}</p>
            <p v-if="siteTitle" class="text-xs text-text-secondary truncate">{{ siteTitle }}</p>
          </div>
        </header>
        <div>
          <h1 class="text-xl font-bold leading-snug break-words">{{ isLogin ? t('prompt.signInTitle', { site: displayHost }) : permInfo.label }}</h1>
          <p class="mt-2 text-sm text-text-secondary leading-relaxed">{{ isLogin ? t('prompt.signInDescription') : permInfo.what }}</p>
        </div>
        <p v-if="isHttp" class="text-sm text-warning flex gap-2"><AlertTriangle class="w-4 h-4 shrink-0" />{{ t('prompt.httpWarning') }}</p>
        <div class="flex items-center gap-2 text-sm">
          <img v-if="profilePicture" :src="profilePicture" @error="profilePicture = ''" referrerpolicy="no-referrer" alt="" class="w-8 h-8 rounded-full object-cover" />
          <Fingerprint v-else class="w-7 h-7 text-text-secondary shrink-0" />
          <span class="truncate">{{ accountName || t('prompt.yourAccount') }}</span>
          <span v-if="accountMode === 'nip46'" class="text-xs text-text-secondary">{{ t('account.externalSigner') }}</span>
        </div>
        <div v-if="eventContentPreview" class="rounded-xl bg-surface-card border border-border p-3">
          <p class="text-xs text-text-secondary mb-1">{{ t('prompt.eventPreview') }}</p>
          <p class="text-sm whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{{ eventContentPreview.encrypted ? t('prompt.encryptedContent') : eventContentPreview.text }}</p>
        </div>
        <div v-if="isPayment" class="rounded-xl bg-surface-card border border-border p-3 space-y-2">
          <p class="text-sm text-text-secondary">{{ t('prompt.payAmount') }}</p>
          <p class="text-2xl font-bold">{{ paymentAmount ? paymentAmount.toLocaleString() + ' sats' : t('prompt.payAmountUnknown') }}</p>
          <p v-if="paymentAmount && toFiat(paymentAmount)" class="text-sm text-text-secondary">≈ {{ toFiat(paymentAmount) }}</p>
          <p v-if="paymentBudget" class="text-sm">{{ t('prompt.budgetRemaining') }}: {{ paymentBudget.remaining.toLocaleString() }} / {{ paymentBudget.budget.toLocaleString() }} sats</p>
          <template v-else>
            <label class="flex items-center gap-2 min-h-11 text-sm"><input v-model="rememberBudget" type="checkbox" />{{ t('prompt.rememberBudget') }}</label>
            <div v-if="rememberBudget">
              <label for="budget" class="text-sm">{{ t('prompt.rememberBudgetHint') }}</label>
              <div class="flex items-center gap-2 mt-2"><input id="budget" v-model="budgetAmount" :aria-invalid="!validBudget" type="number" min="1" class="w-full min-w-0 bg-surface-elevated border border-border rounded-lg p-2 text-sm" /><span class="text-sm">sats</span></div>
              <p v-if="budgetAmountFiat" class="text-xs mt-1">≈ {{ budgetAmountFiat }}</p>
            </div>
          </template>
        </div>
        <div v-if="isHttpAuth" class="text-sm rounded-xl border border-border p-3 break-all">
          <p class="text-text-secondary mb-1">{{ t('prompt.httpAuth') }}</p>
          <p>{{ eventData.tags?.find(tag => tag[0] === 'method')?.[1] || 'GET' }} {{ eventData.tags?.find(tag => tag[0] === 'u')?.[1] }}</p>
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer min-h-8 text-text-secondary">{{ t('prompt.details') }}</summary>
          <div class="space-y-3 pt-2">
            <p v-if="permInfo.detail" class="text-text-secondary">{{ permInfo.detail }}</p>
            <p v-if="accountNpub" class="break-all text-xs font-mono">{{ accountNpub }}</p>
            <p class="text-xs text-text-secondary">{{ technicalProtocol }}<span v-if="kindLabel"> · {{ kindLabel }}</span></p>
            <pre v-if="isSignEvent" class="text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto bg-surface-card p-3 rounded-xl">{{ JSON.stringify(eventData, null, 2) }}</pre>
            <button @click="respond('deny_all')" :disabled="!!deciding" class="prompt-button border border-border text-error">{{ t('prompt.denyAll') }}</button>
          </div>
        </details>
        <p v-if="queuedCount" class="text-xs text-text-secondary">{{ t('prompt.moreWaiting', { n: queuedCount }) }}</p>
      </main>
      <footer class="prompt-actions">
        <p v-if="responseError" role="alert" class="text-sm text-error">{{ responseError }}</p>
        <button @click="respond('allow_once')" :disabled="!!deciding || (isPayment && rememberBudget && !validBudget)" data-decision="allow_once" class="prompt-button bg-brand text-surface-base font-semibold">
          <Loader2 v-if="deciding === 'allow_once'" class="w-4 h-4 animate-spin" />
          {{ isPayment ? t('prompt.confirmPayment') : isLogin ? t('prompt.actionLoginLabel') : t('prompt.allow') }}
        </button>
        <template v-if="!isPayment">
          <button @click="respond('allow_all')" :disabled="!!deciding" data-decision="allow_all" aria-describedby="trust-description" class="prompt-button border border-border bg-surface-card font-semibold">
            <Loader2 v-if="deciding === 'allow_all'" class="w-4 h-4 animate-spin shrink-0" />
            <span>{{ t('prompt.alwaysAllowSite', { site: displayHost }) }}</span>
          </button>
          <p id="trust-description" class="text-xs text-text-secondary leading-snug">{{ t('prompt.trustDescription') }}</p>
        </template>
        <button @click="respond('deny_once')" :disabled="!!deciding" data-decision="deny_once" class="prompt-button text-text-secondary">{{ t('prompt.notNow') }}</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.prompt-window { height: 100dvh; max-width: 440px; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; }
.prompt-content { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 12px; }
.prompt-actions { flex: none; display: grid; gap: 8px; padding: 12px 24px 16px; border-top: 1px solid var(--border); background: var(--surface-base); }
.prompt-button { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; line-height: 1.3; overflow-wrap: anywhere; }
.prompt-button:disabled { opacity: 0.5; }
</style>
