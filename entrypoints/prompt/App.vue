<script setup>
/**
 * Permission prompt — the gate between websites and the user's identity.
 *
 * Follows Alby-style patterns adapted for non-Nostr users:
 * - Site identity card always first (who is asking)
 * - Clear permission checklist (what they get)
 * - Three-tier actions: primary, secondary button, tertiary text link
 * - Unlock shows requesting site context + password toggle
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../../composables/useTheme.js'
import { truncateKey } from '../../lib/utils.js'
import {
  ShieldCheck, ShieldPlus, Globe, Fingerprint, FileSignature, Lock, Unlock,
  Check, X, Zap, Clock, KeyRound, Eye, EyeOff, AlertTriangle, ShieldOff,
  Ban, Loader2,
} from 'lucide-vue-next'

useTheme()
const { t } = useI18n()

const mode = ref('permission') // 'permission' or 'unlock'
const host = ref('')
const origin = ref('') // for unlock mode — which site triggered it
const method = ref('')
const kind = ref('')
const requestId = ref('')
const accountName = ref('')
const accountNpub = ref('')
const accountMode = ref('') // 'local' or 'nip46'
const profilePicture = ref('')
const loading = ref(true)
const deciding = ref('')
const firstVisit = ref(false)

// Unlock mode state
const unlockPassword = ref('')
const unlockError = ref('')
const unlockBusy = ref(false)
const showPassword = ref(false)

// Favicon state
const faviconFailed = ref(false)
const eventData = ref(null)
const showEventData = ref(false)
const siteTitle = ref('')
const siteFavicon = ref('')

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
  host.value = params.get('host') || ''
  origin.value = params.get('origin') || ''
  method.value = params.get('method') || ''
  kind.value = params.get('kind') || ''
  firstVisit.value = params.get('firstVisit') === 'true'
  siteTitle.value = params.get('siteTitle') || ''
  siteFavicon.value = params.get('siteFavicon') || ''

  // Unlock mode — only needs origin context, no account data
  if (mode.value === 'unlock') {
    loading.value = false
    return
  }

  try {
    const accountsRes = await fetchWithTimeout({ type: 'GET_ACCOUNTS', params: [] })
    const accountList = accountsRes?.result || accountsRes
    const active = Array.isArray(accountList) ? accountList.find(a => a.isActive) : null
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
      const data = await chrome.storage.local.get(key)
      if (data[key]) eventData.value = data[key]
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
}))

const permInfo = computed(() => {
  return PERMISSION_INFO.value[method.value] || {
    label: method.value,
    what: t('prompt.permDefaultWhat'),
    detail: '',
    icon: ShieldCheck,
    risk: 'medium',
    riskLabel: t('prompt.permDefaultRisk'),
  }
})

const riskBadge = computed(() => {
  if (permInfo.value.risk === 'low') return { class: 'text-success bg-success/10 border-success/20', dot: 'bg-success' }
  if (permInfo.value.risk === 'high') return { class: 'text-error bg-error/10 border-error/20', dot: 'bg-error' }
  return { class: 'text-warning bg-warning/10 border-warning/20', dot: 'bg-warning' }
})

const kindLabel = computed(() => {
  if (!kind.value) return ''
  const kinds = {
    '0': t('prompt.kindProfile'),
    '1': t('prompt.kindNote'),
    '3': t('prompt.kindContacts'),
    '4': t('prompt.kindDM'),
    '6': t('prompt.kindRepost'),
    '7': t('prompt.kindReaction'),
    '9734': t('prompt.kindZap'),
    '10002': t('prompt.kindRelayList'),
    '30023': t('prompt.kindArticle'),
    '30078': t('prompt.kindAppData'),
  }
  return kinds[kind.value] || t('prompt.kindGeneric', { kind: kind.value })
})

// Show clean hostname for display, full origin for trust verification
const displayHost = computed(() => {
  try {
    return host.value.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '')
  } catch {
    return host.value
  }
})

const fullOrigin = computed(() => {
  try {
    const raw = host.value.startsWith('http') ? host.value : `https://${host.value}`
    return new URL(raw).origin
  } catch {
    return host.value
  }
})

const isHttp = computed(() => {
  try {
    return fullOrigin.value.startsWith('http://') && !fullOrigin.value.includes('localhost')
  } catch {
    return false
  }
})

const faviconUrl = computed(() => {
  // Prefer browser-provided favicon (higher quality, correct path)
  if (siteFavicon.value) return siteFavicon.value
  try {
    const url = new URL(host.value.startsWith('http') ? host.value : `https://${host.value}`)
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

// Payment info (weblnSendPayment)
const paymentAmount = computed(() => {
  if (method.value !== 'weblnSendPayment' || !eventData.value) return null
  return eventData.value.amountSats || null
})

const paymentBudget = computed(() => {
  if (method.value !== 'weblnSendPayment' || !eventData.value) return null
  const { budgetSats, spentSats } = eventData.value
  if (!budgetSats) return null
  return { budget: budgetSats, spent: spentSats || 0, remaining: budgetSats - (spentSats || 0) }
})

const accountModeBadge = computed(() => {
  if (accountMode.value === 'nip46') return 'Remote Signer'
  return 'Extension'
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
    await chrome.runtime.sendMessage({
      type: 'PERMISSION_RESPONSE',
      params: [{
        requestId: requestId.value,
        decision,
        host: host.value,
        method: method.value,
        kind: kind.value || null,
      }],
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
      } else {
        unlockError.value = msg
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
  <div class="w-full min-h-[400px] bg-surface-base text-text-primary flex flex-col select-none">

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
    <!-- UNLOCK MODE                                        -->
    <!-- ════════════════════════════════════════════════════ -->
    <template v-else-if="mode === 'unlock'">
      <div class="flex-1 flex flex-col p-5 animate-fade-in-up">

        <!-- Lock icon + title -->
        <div class="text-center space-y-3 pt-3 pb-4">
          <div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto">
            <Lock class="w-7 h-7 text-brand" />
          </div>
          <div>
            <h1 class="text-base font-extrabold">{{ t('prompt.lockedTitle') }}</h1>
            <p class="text-[11px] text-text-muted mt-1 leading-relaxed">{{ t('prompt.lockedDesc') }}</p>
          </div>
        </div>

        <!-- Requesting site context -->
        <div v-if="unlockOriginDisplay"
          class="flex items-center gap-2.5 px-3 py-2 rounded-3xl bg-surface-card border border-border shadow-sm mb-4">
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
            <img
              v-if="unlockOriginFavicon && !unlockFaviconFailed"
              :src="unlockOriginFavicon"
              @error="unlockFaviconFailed = true"
              class="w-5 h-5"
              alt=""
            />
            <Globe v-else class="w-3.5 h-3.5 text-text-muted" />
          </div>
          <div class="min-w-0 flex-1">
            <span class="text-[9px] text-text-muted font-medium uppercase tracking-wider">{{ t('prompt.lockedRequestedBy') }}</span>
            <div class="text-[11px] font-semibold truncate">{{ unlockOriginDisplay }}</div>
          </div>
        </div>

        <!-- Password input with visibility toggle -->
        <div class="space-y-1.5 mb-4">
          <div class="relative">
            <input
              v-model="unlockPassword"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="t('lock.enterPassword')"
              autofocus
              @keydown.enter="submitUnlock"
              class="w-full pl-4 pr-16 py-3 text-sm rounded-xl bg-surface-card border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
              :class="unlockError ? 'border-error focus:border-error' : 'border-border focus:border-brand'"
            />
            <button
              @click="showPassword = !showPassword"
              type="button"
              tabindex="-1"
              :aria-label="showPassword ? t('prompt.hidePassword') : t('prompt.showPassword')"
              class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-elevated transition-all duration-200"
            >
              <Eye v-if="!showPassword" class="w-3.5 h-3.5" />
              <EyeOff v-else class="w-3.5 h-3.5" />
              <span class="text-[9px] font-medium">{{ showPassword ? t('prompt.hidePassword') : t('prompt.showPassword') }}</span>
            </button>
          </div>
          <p v-if="unlockError" class="flex items-center gap-1 text-[11px] text-error font-medium px-1">
            <AlertTriangle class="w-3 h-3 shrink-0" />
            {{ unlockError }}
          </p>
        </div>

        <!-- Spacer -->
        <div class="flex-1 min-h-2" />

        <!-- Actions -->
        <div class="space-y-2">
          <button
            @click="submitUnlock"
            :disabled="!unlockPassword || unlockBusy"
            class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all duration-200 btn-primary"
          >
            <Loader2 v-if="unlockBusy" class="w-4 h-4 animate-spin" />
            <KeyRound v-else class="w-4 h-4" />
            {{ t('lock.unlock') }}
          </button>
          <button
            @click="closeWindow"
            :disabled="unlockBusy"
            class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-surface-card border border-border text-text-secondary font-semibold hover:bg-surface-elevated disabled:opacity-50 transition-all duration-200"
          >
            {{ t('common.cancel') }}
          </button>
        </div>

      </div>
    </template>

    <!-- ════════════════════════════════════════════════════ -->
    <!-- PERMISSION MODE                                    -->
    <!-- ════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="flex-1 flex flex-col p-5 space-y-3 animate-fade-in-up">

        <!-- ── Site identity card (Alby PublisherCard pattern) ── -->
        <div class="flex items-center gap-3 stagger-1 animate-fade-in-up">
          <div class="w-11 h-11 rounded-2xl border border-border flex items-center justify-center shrink-0 overflow-hidden"
            :class="faviconFailed ? 'bg-brand text-surface-base' : 'bg-surface-elevated'">
            <img
              v-if="faviconUrl && !faviconFailed"
              :src="faviconUrl"
              @error="faviconFailed = true"
              class="w-7 h-7"
              alt=""
            />
            <span v-else class="text-sm font-bold">{{ hostInitial }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div v-if="siteTitle" class="text-sm font-extrabold truncate">{{ siteTitle }}</div>
            <div class="text-[11px] font-semibold truncate" :class="siteTitle ? 'text-text-secondary' : 'text-sm font-extrabold'">{{ displayHost }}</div>
            <div class="text-[10px] text-text-muted mt-0.5 truncate font-mono">{{ fullOrigin }}</div>
            <div class="text-[11px] text-text-secondary mt-0.5 font-medium">{{ t('prompt.wantsAccess') }}</div>
          </div>
        </div>

        <!-- HTTP warning -->
        <div v-if="isHttp"
          class="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/8 border border-warning/20 stagger-2 animate-fade-in-up">
          <AlertTriangle class="w-3.5 h-3.5 text-warning shrink-0" />
          <span class="text-[10px] text-warning font-medium">{{ t('prompt.httpWarning') }}</span>
        </div>

        <!-- ── What the site wants ── -->
        <div class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden stagger-2 animate-fade-in-up">
          <!-- Permission header -->
          <div class="px-4 py-3 flex items-start gap-3">
            <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 mt-0.5"
              :class="riskBadge.class">
              <component :is="permInfo.icon" class="w-[18px] h-[18px]" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="text-[13px] font-extrabold leading-snug">{{ permInfo.label }}</span>
              <p class="text-[11px] text-text-muted mt-1 leading-relaxed">{{ permInfo.what }}</p>
            </div>
          </div>

          <!-- Tags: risk + kind -->
          <div class="px-4 pb-3 flex flex-wrap items-center gap-1.5">
            <span class="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full border"
              :class="riskBadge.class">
              <span class="w-1 h-1 rounded-full" :class="riskBadge.dot" />
              {{ permInfo.riskLabel }}
            </span>
            <span v-if="kindLabel"
              class="inline-flex items-center text-[9px] font-medium px-2 py-0.5 rounded-full bg-surface-elevated text-text-muted border border-border">
              {{ kindLabel }}
            </span>
          </div>

          <!-- Payment amount (weblnSendPayment) -->
          <div v-if="method === 'weblnSendPayment'" class="px-4 py-3 border-t border-border bg-surface-elevated/40">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-text-muted font-medium">{{ t('prompt.payAmount') }}</span>
              <span class="text-base font-extrabold text-error">{{ paymentAmount ? paymentAmount.toLocaleString() + ' sats' : t('prompt.payAmountUnknown') }}</span>
            </div>
            <div v-if="paymentBudget" class="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/50">
              <span class="text-[10px] text-text-muted">{{ t('prompt.budgetRemaining') }}</span>
              <span class="text-[11px] font-semibold" :class="paymentAmount && paymentBudget.remaining >= paymentAmount ? 'text-success' : 'text-warning'">
                {{ paymentBudget.remaining.toLocaleString() }} / {{ paymentBudget.budget.toLocaleString() }} sats
              </span>
            </div>
          </div>

          <!-- Detail footer -->
          <div v-if="permInfo.detail" class="px-4 py-2.5 border-t border-border bg-surface-elevated/40">
            <p class="text-[10px] text-text-muted leading-relaxed">{{ permInfo.detail }}</p>
          </div>

          <!-- Raw event data (signEvent only) -->
          <div v-if="eventData && method === 'signEvent'" class="border-t border-border">
            <button @click="showEventData = !showEventData"
              class="w-full flex items-center gap-2 px-4 py-2 text-[10px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
              <FileSignature class="w-3 h-3 shrink-0" />
              {{ showEventData ? t('prompt.hideEvent') : t('prompt.viewEvent') }}
            </button>
            <div v-if="showEventData" class="px-4 pb-3">
              <pre class="text-[9px] leading-relaxed font-mono bg-surface-base rounded-lg p-3 max-h-[160px] overflow-auto border border-border text-text-secondary whitespace-pre-wrap break-all">{{ JSON.stringify(eventData, null, 2) }}</pre>
            </div>
          </div>
        </div>

        <!-- ── Account identity ── -->
        <div class="flex items-center gap-3 px-3 py-2.5 rounded-3xl bg-surface-card border border-border shadow-sm stagger-3 animate-fade-in-up">
          <div class="w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
            :class="profilePicture ? '' : 'bg-brand text-surface-base'">
            <img v-if="profilePicture" :src="profilePicture" alt="" class="w-full h-full object-cover" />
            <span v-else class="text-xs font-bold">{{ (accountName || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
              <span class="text-[11px] font-semibold truncate">{{ accountName || t('prompt.yourAccount') }}</span>
            </div>
            <div v-if="accountNpub" class="text-[9px] text-text-muted font-mono mt-0.5 truncate">
              {{ truncateKey(accountNpub, 12, 6) }}
            </div>
          </div>
          <span class="text-[8px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted font-semibold uppercase tracking-wider shrink-0">
            {{ accountModeBadge }}
          </span>
        </div>

        <!-- Spacer -->
        <div class="flex-1 min-h-1" />

        <!-- ════════════════════════════════════════════════ -->
        <!-- FIRST VISIT — Permission checklist              -->
        <!-- ════════════════════════════════════════════════ -->
        <div v-if="firstVisit" class="space-y-2 stagger-4 animate-fade-in-up">

          <!-- Connect button with permission checklist -->
          <button
            @click="respond('allow_all')"
            :disabled="!!deciding"
            class="w-full p-3.5 rounded-2xl bg-brand/8 border border-brand/20 hover:bg-brand/12 disabled:opacity-50 transition-all duration-200 text-left"
          >
            <div class="flex items-center gap-2 mb-2.5">
              <ShieldPlus v-if="deciding !== 'allow_all'" class="w-4 h-4 text-brand shrink-0" />
              <Loader2 v-else class="w-4 h-4 text-brand animate-spin shrink-0" />
              <span class="text-[13px] font-extrabold text-brand">{{ t('prompt.allowAll') }}</span>
              <span class="text-[7px] px-1.5 py-0.5 rounded-full bg-brand/15 text-brand font-bold uppercase tracking-wider ml-auto">{{ t('prompt.allowAllRecommended') }}</span>
            </div>

            <div class="text-[10px] text-text-muted mb-2 font-medium">{{ t('prompt.allowAllDesc') }}</div>

            <!-- Permission checklist -->
            <div class="space-y-1.5 pl-0.5">
              <div class="flex items-center gap-2">
                <Check class="w-3 h-3 text-success shrink-0" />
                <span class="text-[10px] text-text-secondary">{{ t('prompt.allowAllCheck1') }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Check class="w-3 h-3 text-success shrink-0" />
                <span class="text-[10px] text-text-secondary">{{ t('prompt.allowAllCheck2') }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Check class="w-3 h-3 text-success shrink-0" />
                <span class="text-[10px] text-text-secondary">{{ t('prompt.allowAllCheck3') }}</span>
              </div>
              <div class="flex items-center gap-2">
                <Check class="w-3 h-3 text-success shrink-0" />
                <span class="text-[10px] text-text-secondary">{{ t('prompt.allowAllCheck4') }}</span>
              </div>
              <!-- Explicit payment exclusion -->
              <div class="flex items-center gap-2 mt-1 pt-1 border-t border-border/50">
                <ShieldCheck class="w-3 h-3 text-info shrink-0" />
                <span class="text-[10px] text-info font-medium">{{ t('prompt.allowAllExclude') }}</span>
              </div>
            </div>
          </button>

          <!-- Decide per request -->
          <button
            @click="firstVisit = false"
            :disabled="!!deciding"
            class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-surface-card border border-border text-text-secondary font-semibold hover:bg-surface-elevated disabled:opacity-50 transition-all duration-200"
          >
            <ShieldCheck class="w-4 h-4 text-text-muted" />
            {{ t('prompt.decideSeparately') }}
          </button>

          <!-- Block all (tertiary text link) -->
          <button
            @click="respond('deny_all')"
            :disabled="!!deciding"
            class="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-text-muted hover:text-error transition-all duration-200 font-medium"
          >
            <Ban class="w-3 h-3" />
            {{ t('prompt.blockSite') }}
          </button>
        </div>

        <!-- ════════════════════════════════════════════════ -->
        <!-- STANDARD — Per-request allow/deny               -->
        <!-- ════════════════════════════════════════════════ -->
        <template v-else>
          <div class="space-y-2 stagger-4 animate-fade-in-up">

            <!-- ── Payment prompt: allow_once / deny (no "always allow") ── -->
            <template v-if="method === 'weblnSendPayment'">
              <button
                @click="respond('allow_once')"
                :disabled="!!deciding"
                class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all duration-200 btn-primary"
              >
                <Zap v-if="deciding !== 'allow_once'" class="w-4 h-4" />
                <Loader2 v-else class="w-4 h-4 animate-spin" />
                {{ t('prompt.confirmPayment') }}
              </button>

              <button
                @click="respond('deny_once')"
                :disabled="!!deciding"
                class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-surface-card border border-border text-text-secondary font-semibold hover:bg-surface-elevated disabled:opacity-50 transition-all duration-200"
              >
                <X v-if="deciding !== 'deny_once'" class="w-4 h-4" />
                <Loader2 v-else class="w-4 h-4 animate-spin" />
                {{ t('prompt.deny') }}
              </button>
            </template>

            <!-- ── Standard permission prompt ── -->
            <template v-else>
              <button
                @click="respond('allow_always')"
                :disabled="!!deciding"
                class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-brand text-surface-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-all duration-200 btn-primary"
              >
                <Check v-if="deciding !== 'allow_always'" class="w-4 h-4" />
                <Loader2 v-else class="w-4 h-4 animate-spin" />
                {{ t('prompt.allowAlways') }}
              </button>

              <button
                @click="respond('deny_once')"
                :disabled="!!deciding"
                class="w-full flex items-center justify-center gap-2 py-3 text-[13px] rounded-2xl bg-surface-card border border-border text-text-secondary font-semibold hover:bg-surface-elevated disabled:opacity-50 transition-all duration-200"
              >
                <X v-if="deciding !== 'deny_once'" class="w-4 h-4" />
                <Loader2 v-else class="w-4 h-4 animate-spin" />
                {{ t('prompt.notNow') }}
              </button>

              <!-- Granular options row -->
              <div class="flex items-center justify-center gap-3 pt-1">
                <button
                  @click="respond('allow_once')"
                  :disabled="!!deciding"
                  class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-xl text-text-muted hover:text-success hover:bg-success/8 transition-all duration-200 font-medium disabled:opacity-50"
                >
                  <Clock class="w-3.5 h-3.5" />
                  {{ t('prompt.allowOnce') }}
                </button>
                <span class="text-border text-[10px]">|</span>
                <button
                  @click="respond('deny_always')"
                  :disabled="!!deciding"
                  class="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-xl text-text-muted hover:text-error hover:bg-error/8 transition-all duration-200 font-medium disabled:opacity-50"
                >
                  <ShieldOff class="w-3.5 h-3.5" />
                  {{ t('prompt.denyAlways') }}
                </button>
              </div>
            </template>

          </div>
        </template>

      </div>
    </template>
  </div>
</template>
