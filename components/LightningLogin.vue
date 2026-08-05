<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft, CheckCircle2, KeyRound, Loader2, LogIn, ScanLine,
  ShieldCheck, TriangleAlert,
} from 'lucide-vue-next'
import { useMessaging } from '../composables/useMessaging.js'
import { parseLightningLogin } from '../lib/lightningAuth.js'
import { originPermissionPattern } from '../lib/origins.js'
import QrScanner from './QrScanner.vue'

const props = defineProps({
  account: { type: Object, default: null },
})
const emit = defineEmits(['completed'])

const { t } = useI18n()
const { send } = useMessaging()
const expanded = ref(false)
const input = ref('')
const challenge = ref(null)
const showScanner = ref(false)
const loading = ref(false)
const error = ref('')
const result = ref(null)

const capability = computed(() => props.account?.capabilities?.lightningLogin || {
  supported: false,
  reason: 'recovery_words_required',
})

const unsupportedReason = computed(() => {
  if (capability.value.reason === 'remote_signer') return t('lightningLogin.remoteSignerUnsupported')
  return t('lightningLogin.recoveryWordsRequired')
})

const actionLabel = computed(() => {
  const action = challenge.value?.action || 'login'
  return t(`lightningLogin.actions.${action}`)
})

watch(() => props.account?.id, reset)

function reset() {
  expanded.value = false
  input.value = ''
  challenge.value = null
  showScanner.value = false
  loading.value = false
  error.value = ''
  result.value = null
}

function closeFlow() {
  input.value = ''
  challenge.value = null
  showScanner.value = false
  error.value = ''
  result.value = null
  expanded.value = false
}

function readChallenge() {
  error.value = ''
  result.value = null
  try {
    challenge.value = parseLightningLogin(input.value)
  } catch (err) {
    challenge.value = null
    error.value = err.message || t('lightningLogin.invalidCode')
  }
}

function onScanned(value) {
  input.value = value
  showScanner.value = false
  readChallenge()
}

async function requestWebsiteAccess(origin) {
  if (!chrome.permissions?.request) return true
  try {
    return await chrome.permissions.request({ origins: [originPermissionPattern(origin)] })
  } catch {
    return false
  }
}

async function approveLogin() {
  if (!challenge.value || loading.value) return
  error.value = ''

  const permitted = await requestWebsiteAccess(challenge.value.origin)
  if (!permitted) {
    error.value = t('lightningLogin.websiteAccessDenied')
    return
  }

  loading.value = true
  try {
    result.value = await send('PERFORM_LIGHTNING_LOGIN', input.value)
    if (result.value?.ok || result.value?.requestSent) emit('completed')
  } catch (err) {
    const message = err.message || ''
    if (message === 'errors.LIGHTNING_LOGIN_REMOTE_SIGNER') {
      error.value = t('lightningLogin.remoteSignerUnsupported')
    } else if (message === 'errors.LIGHTNING_LOGIN_RECOVERY_WORDS_REQUIRED') {
      error.value = t('lightningLogin.recoveryWordsRequired')
    } else {
      error.value = message || t('lightningLogin.failed')
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden">
    <div v-if="!expanded" class="p-4 flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        :class="capability.supported ? 'bg-brand/10 text-brand' : 'bg-warning/10 text-warning'">
        <LogIn class="w-4.5 h-4.5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="text-[12px] font-bold">{{ t('lightningLogin.title') }}</h3>
          <span v-if="capability.supported" class="text-[8px] uppercase tracking-wide font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5">
            {{ t('lightningLogin.ready') }}
          </span>
        </div>
        <p class="text-[10px] text-text-muted leading-relaxed mt-1">
          {{ capability.supported ? t('lightningLogin.description') : unsupportedReason }}
        </p>
        <button v-if="capability.supported" @click="expanded = true"
          class="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-brand hover:text-brand-hover transition-colors">
          <KeyRound class="w-3.5 h-3.5" />
          {{ t('lightningLogin.start') }}
        </button>
      </div>
    </div>

    <div v-else class="p-4 space-y-4">
      <button @click="closeFlow" class="inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary font-medium">
        <ArrowLeft class="w-3.5 h-3.5" /> {{ t('common.back') }}
      </button>

      <div v-if="result" class="text-center space-y-3 py-2">
        <div class="w-11 h-11 rounded-full mx-auto flex items-center justify-center"
          :class="result.ok || result.requestSent ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
          <CheckCircle2 v-if="result.ok || result.requestSent" class="w-5 h-5" />
          <TriangleAlert v-else class="w-5 h-5" />
        </div>
        <div>
          <h3 class="text-[13px] font-bold">
            {{ result.ok ? t('lightningLogin.success') : result.requestSent ? t('lightningLogin.requestSent') : t('lightningLogin.failed') }}
          </h3>
          <p class="text-[10px] text-text-muted mt-1 leading-relaxed">
            {{ result.ok || result.requestSent
              ? t('lightningLogin.returnToWebsite', { domain: result.domain })
              : (result.reason || t('lightningLogin.tryAgain')) }}
          </p>
        </div>
        <button @click="closeFlow" class="w-full py-2.5 rounded-2xl bg-brand text-surface-base text-[11px] font-bold">
          {{ t('common.done') }}
        </button>
      </div>

      <template v-else-if="challenge">
        <div class="text-center space-y-1.5">
          <div class="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center mx-auto">
            <ShieldCheck class="w-5 h-5" />
          </div>
          <h3 class="text-[13px] font-bold break-all">{{ challenge.origin }}</h3>
          <p class="text-[10px] text-text-muted">{{ actionLabel }}</p>
        </div>

        <div class="p-3 rounded-2xl bg-surface-base border border-border text-[10px] text-text-muted leading-relaxed">
          {{ t('lightningLogin.confirmHint', { domain: challenge.domain }) }}
        </div>

        <div v-if="error" class="flex items-start gap-2 p-3 rounded-2xl bg-error/8 border border-error/15 text-[10px] text-error">
          <TriangleAlert class="w-3.5 h-3.5 shrink-0 mt-px" /> {{ error }}
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button @click="challenge = null; error = ''" :disabled="loading"
            class="py-2.5 rounded-2xl bg-surface-elevated text-text-secondary text-[11px] font-semibold disabled:opacity-50">
            {{ t('common.cancel') }}
          </button>
          <button @click="approveLogin" :disabled="loading"
            class="py-2.5 rounded-2xl bg-brand text-surface-base text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Loader2 v-if="loading" class="w-3.5 h-3.5 animate-spin" />
            {{ loading ? t('lightningLogin.signingIn') : t('lightningLogin.approve') }}
          </button>
        </div>
      </template>

      <template v-else>
        <div>
          <h3 class="text-[13px] font-bold">{{ t('lightningLogin.enterCode') }}</h3>
          <p class="text-[10px] text-text-muted mt-1 leading-relaxed">{{ t('lightningLogin.enterCodeHint') }}</p>
        </div>

        <QrScanner v-if="showScanner" @scan="onScanned" @close="showScanner = false" />
        <textarea v-else v-model="input" rows="3" :placeholder="t('lightningLogin.codePlaceholder')"
          class="w-full bg-surface-base border border-border rounded-xl px-3.5 py-3 text-[11px] font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 resize-none placeholder:font-sans placeholder:text-text-muted/50" />

        <div v-if="error" class="flex items-start gap-2 p-3 rounded-2xl bg-error/8 border border-error/15 text-[10px] text-error">
          <TriangleAlert class="w-3.5 h-3.5 shrink-0 mt-px" /> {{ error }}
        </div>

        <div class="grid grid-cols-2 gap-2">
          <button @click="showScanner = !showScanner"
            class="py-2.5 rounded-2xl bg-surface-elevated border border-border text-text-secondary text-[11px] font-semibold flex items-center justify-center gap-1.5">
            <ScanLine class="w-3.5 h-3.5" /> {{ showScanner ? t('common.typeInstead') : t('common.scanQr') }}
          </button>
          <button @click="readChallenge" :disabled="!input.trim()"
            class="py-2.5 rounded-2xl bg-brand text-surface-base text-[11px] font-bold disabled:opacity-40">
            {{ t('common.continue') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
