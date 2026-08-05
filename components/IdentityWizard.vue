<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccounts } from '../composables/useAccounts.js'
import { useMessaging } from '../composables/useMessaging.js'
import { truncateKey } from '../lib/utils.js'
import { nip06 } from 'nostr-core'
import {
  KeyRound, Download, Link2, ArrowRight, ArrowLeft, Eye, EyeOff,
  Copy, Check, AlertTriangle, Globe, UserRound, Shield, ScanLine,
  Loader2, Wifi, CheckCircle2, XCircle, ShieldAlert,
  Sparkles, Info, RotateCcw, PinIcon, Puzzle,
} from 'lucide-vue-next'
import QrScanner from './QrScanner.vue'

const emit = defineEmits(['complete', 'cancel'])
const { t } = useI18n()

const { create, createWithMnemonic, importKey, discoverMnemonic, importMnemonic, createRemote, connectRemote, startNostrConnect, cancelNostrConnect, loadNip46Status, nip46Status: nip46GlobalStatus, publishProfile, fetchProfile, load: loadAccounts, remove: removeAccount } = useAccounts()
const { send: sendMsg } = useMessaging()

// ── Wizard state ──
const step = ref(1)
const mode = ref(null) // 'new' | 'import' | 'recover' | 'nip46'
const loading = ref(false)
const error = ref('')

// ── Form data ──
const displayName = ref('')
const aboutMe = ref('')
const importNsec = ref('')
const bunkerUri = ref('')
const showNsec = ref(false)
const copied = ref(false)
const showScanner = ref(false)
const backupStage = ref('show') // show | verify
const backupChallenge = ref(null)
const backupAnswers = ref([])
const downloadedKey = ref(false)

// ── Mnemonic state ──
const mnemonicWords = ref('')
const mnemonicDisplay = ref([]) // 12 words for backup display
const recoveryCandidates = ref([])
const selectedRecoveryIndex = ref(null)
const showAllRecoveryCandidates = ref(false)
const recoveryNetworkChecked = ref(true)
const manualRecoveryIndex = ref('')

// ── NIP-46 connection state ──
const nip46Status = ref('')
const nip46Profile = ref(null)
const nip46Method = ref('bunker') // 'bunker' | 'nostrconnect'
const nostrConnectUri = ref('')
const nostrConnectQr = ref('')
const nostrConnectAccountId = ref(null)
let nostrConnectPollTimer = null
let nostrConnectStarted = false
let nostrConnectCompleted = false
let nostrConnectCleanupPromise = null
const nostrConnectCountdown = ref(0)
let nostrConnectCountdownTimer = null

// Auto-generate QR when user selects "Show QR" on step 2
async function cleanupNostrConnectAccount() {
  if (nostrConnectCleanupPromise) return nostrConnectCleanupPromise
  nostrConnectCleanupPromise = (async () => {
    await cancelNostrConnect().catch(() => {})
    const accountId = nostrConnectAccountId.value
    nostrConnectAccountId.value = null
    if (accountId && !nostrConnectCompleted) await removeAccount(accountId).catch(() => {})
  })().finally(() => { nostrConnectCleanupPromise = null })
  return nostrConnectCleanupPromise
}

watch(nip46Method, async (method, previous) => {
  if (previous === 'nostrconnect' && method !== 'nostrconnect') await cleanupNostrConnectAccount()
  if (method !== 'nostrconnect' || step.value !== 2 || nostrConnectStarted) return
  nostrConnectStarted = true
  try {
    nip46Status.value = 'creating'
    const account = await createRemote('Remote Signer')
    nostrConnectAccountId.value = account.id

    nip46Status.value = 'waiting'
    const result = await startNostrConnect(account.id)
    if (result?.error) {
      nip46Status.value = ''
      nostrConnectStarted = false
      await cleanupNostrConnectAccount()
      return
    }

    nostrConnectUri.value = result.uri
    const QRCode = (await import('qrcode')).default
    nostrConnectQr.value = await QRCode.toDataURL(result.uri, {
      width: 220, margin: 2, color: { dark: '#000', light: '#fff' },
    })

    // Start countdown (matches 90s timeout in background.js)
    nostrConnectCountdown.value = 90
    nostrConnectCountdownTimer = setInterval(() => {
      nostrConnectCountdown.value--
      if (nostrConnectCountdown.value <= 0) {
        clearInterval(nostrConnectCountdownTimer)
        nostrConnectCountdownTimer = null
      }
    }, 1000)

    nostrConnectPollTimer = setInterval(async () => {
      await loadNip46Status()
      if (nip46GlobalStatus.value.connected) {
        clearInterval(nostrConnectPollTimer)
        nostrConnectPollTimer = null
        if (nostrConnectCountdownTimer) { clearInterval(nostrConnectCountdownTimer); nostrConnectCountdownTimer = null }
        await loadAccounts()
        nostrConnectCompleted = true
        nip46Status.value = 'done'
        step.value = 3
      } else if (nip46GlobalStatus.value.error) {
        clearInterval(nostrConnectPollTimer)
        nostrConnectPollTimer = null
        error.value = nip46GlobalStatus.value.error
        nip46Status.value = ''
        nostrConnectStarted = false
        await cleanupNostrConnectAccount()
      }
    }, 1500)
  } catch (err) {
    nip46Status.value = ''
    nostrConnectStarted = false
    error.value = err?.message || t('common.error')
    await cleanupNostrConnectAccount()
  }
})

// ── Created account data ──
const createdAccount = ref(null)
const publishResult = ref(null)

// Primary modes — visible by default (90% of users)
const primaryModes = computed(() => [
  {
    id: 'new',
    icon: Sparkles,
    title: t('wizard.modeNewIdentityTitle'),
    desc: t('wizard.modeNewIdentityDesc'),
    recommended: true,
  },
  {
    id: 'import',
    icon: Download,
    title: t('wizard.modeImportTitle'),
    desc: t('wizard.modeImportDesc'),
    recommended: false,
  },
])

// Advanced modes — hidden behind toggle (power users)
const advancedModes = computed(() => [
  {
    id: 'recover',
    icon: RotateCcw,
    title: t('wizard.modeRecoverTitle'),
    desc: t('wizard.modeRecoverDesc'),
    recommended: false,
  },
  {
    id: 'nip46',
    icon: Link2,
    title: t('wizard.modeSignerTitle'),
    desc: t('wizard.modeSignerDesc'),
    recommended: false,
  },
])

const showAdvanced = ref(false)

function isValidKeyInput(val) {
  if (!val) return false
  if (val.startsWith('nsec1') && val.length >= 60) return true
  if (/^[0-9a-f]{64}$/i.test(val)) return true
  return false
}

const importKeyError = computed(() => {
  const val = importNsec.value.trim()
  if (!val) return ''
  if (isValidKeyInput(val)) return ''
  return t('wizard.invalidKeyFormat')
})

const manualRecoveryError = computed(() => {
  if (manualRecoveryIndex.value === '') return ''
  const value = Number(manualRecoveryIndex.value)
  if (Number.isInteger(value) && value >= 0 && value <= 2147483647) return ''
  return t('wizard.recoveryAccountNumberError')
})

const visibleRecoveryCandidates = computed(() => {
  if (showAllRecoveryCandidates.value) return recoveryCandidates.value
  const used = recoveryCandidates.value.filter((candidate) => candidate.used)
  return used.length > 0 ? used : recoveryCandidates.value.slice(0, 1)
})

const canProceedStep2 = computed(() => {
  if (mode.value === 'new') return displayName.value.trim().length > 0
  if (mode.value === 'recover') {
    const words = mnemonicWords.value.trim()
    return words.split(/\s+/).filter(Boolean).length >= 12
      && nip06.validateMnemonic(words.toLowerCase())
      && !manualRecoveryError.value
  }
  if (mode.value === 'import') return isValidKeyInput(importNsec.value.trim())
  if (mode.value === 'nip46') return nip46Method.value === 'nostrconnect' || bunkerUri.value.trim().length > 0
  return false
})

const totalSteps = computed(() => {
  if (mode.value === 'nip46') return 3
  if (mode.value === 'import') return 3
  if (mode.value === 'recover') return 5
  return 5 // new: choose → name → backup → profile → done
})

const stepLabels = computed(() => {
  if (mode.value === 'nip46') return [t('wizard.stepSetup'), t('wizard.stepConnect'), t('wizard.stepDone')]
  if (mode.value === 'import') return [t('wizard.stepSetup'), t('wizard.stepImport'), t('wizard.stepDone')]
  if (mode.value === 'recover') return [t('wizard.stepSetup'), t('wizard.stepRecover'), t('wizard.stepIdentity'), t('wizard.stepProfile'), t('wizard.stepDone')]
  return [t('wizard.stepSetup'), t('wizard.stepName'), t('wizard.stepBackup'), t('wizard.stepProfile'), t('wizard.stepDone')]
})

// ── Step handlers ──

function selectMode(m) {
  mode.value = m
  step.value = 2
  error.value = ''
}

async function goBack() {
  error.value = ''
  if (nostrConnectPollTimer) { clearInterval(nostrConnectPollTimer); nostrConnectPollTimer = null }
  if (nostrConnectAccountId.value && !nostrConnectCompleted) await cleanupNostrConnectAccount()
  else cancelNostrConnect().catch(() => {})
  if (step.value === 2) {
    step.value = 1
    mode.value = null
    nip46Status.value = ''
    nostrConnectUri.value = ''
    nostrConnectQr.value = ''
    nostrConnectStarted = false
  } else if (step.value === 3 && mode.value === 'new') {
    // Backup step — allow going back to name input
    step.value = 2
  } else if (step.value === 3 && mode.value === 'recover') {
    recoveryCandidates.value = []
    selectedRecoveryIndex.value = null
    showAllRecoveryCandidates.value = false
    step.value = 2
  } else if (step.value === 4 && mode.value === 'new') {
    // Profile step — allow going back to backup
    step.value = 3
  }
}

async function completeMnemonicRecovery(candidate) {
  const accountIndex = candidate?.accountIndex ?? 0
  const profile = candidate?.profile || null
  const suggestedName = profile?.display_name || profile?.name || ''
  const account = await importMnemonic(
    displayName.value.trim() || suggestedName || undefined,
    mnemonicWords.value,
    accountIndex
  )
  if (!account) throw new Error('Recovery failed')

  createdAccount.value = account
  mnemonicWords.value = ''
  recoveryCandidates.value = []
  if (profile) {
    displayName.value = profile.display_name || profile.name || displayName.value
    aboutMe.value = profile.about || ''
  } else if (account.pubkey) {
    const existing = await fetchProfile(account.pubkey).catch(() => null)
    if (existing) {
      displayName.value = existing.display_name || existing.name || displayName.value
      aboutMe.value = existing.about || ''
    }
  }
  step.value = 4
}

async function handleRecoverySelection() {
  const candidate = recoveryCandidates.value.find(
    (item) => item.accountIndex === selectedRecoveryIndex.value
  )
  if (!candidate) return

  loading.value = true
  error.value = ''
  try {
    await completeMnemonicRecovery(candidate)
  } catch (err) {
    error.value = err.message || 'Recovery failed'
  } finally {
    loading.value = false
  }
}

async function handleStep2() {
  loading.value = true
  error.value = ''

  try {
    if (mode.value === 'new') {
      // Brief staged pause turns key creation into a felt moment and gives
      // the "save these words" screen more weight when it appears.
      const [account] = await Promise.all([
        createWithMnemonic(displayName.value.trim()),
        new Promise(resolve => setTimeout(resolve, 750)),
      ])
      if (!account) throw new Error('Account creation returned no data')
      createdAccount.value = account
      mnemonicDisplay.value = account.mnemonic.split(' ')
      backupStage.value = 'show'
      backupChallenge.value = null
      backupAnswers.value = []
      step.value = 3
    } else if (mode.value === 'recover') {
      if (manualRecoveryIndex.value !== '') {
        await completeMnemonicRecovery({ accountIndex: Number(manualRecoveryIndex.value) })
      } else {
        const discovery = await discoverMnemonic(mnemonicWords.value)
        const candidates = discovery?.candidates || []
        if (candidates.length === 0) throw new Error('Recovery scan returned no identities')

        const used = candidates.filter((candidate) => candidate.used)
        recoveryNetworkChecked.value = discovery.networkChecked !== false

        if (discovery.networkChecked !== false && used.length <= 1) {
          await completeMnemonicRecovery(used[0] || candidates[0])
        } else {
          recoveryCandidates.value = candidates
          selectedRecoveryIndex.value = (used[0] || candidates[0]).accountIndex
          showAllRecoveryCandidates.value = false
          step.value = 3
        }
      }
    } else if (mode.value === 'import') {
      const account = await importKey(undefined, importNsec.value.trim())
      if (!account) throw new Error('Import returned no data')
      createdAccount.value = account
      // Fetch profile from relays before going to done screen
      if (account.pubkey) {
        try {
          const existing = await fetchProfile(account.pubkey)
          if (existing) {
            displayName.value = existing.display_name || existing.name || ''
            aboutMe.value = existing.about || ''
          }
        } catch { /* relay fetch failed — continue anyway */ }
      }
      step.value = 3
    } else if (mode.value === 'nip46') {
      if (nip46Method.value === 'nostrconnect') {
        // QR is already generated by the watcher — nothing to do here
        return
      }

      // Bunker URI flow
      nip46Status.value = 'creating'
      const account = await createRemote('Remote Signer')

      try {
        nip46Status.value = 'connecting'
        const result = await connectRemote(bunkerUri.value.trim(), account.id)

        if (!result?.pubkey) {
          throw new Error('Connection failed — no public key returned from signer')
        }

        nip46Status.value = 'fetching-profile'
        createdAccount.value = { ...account, pubkey: result.pubkey, npub: null }

        try {
          const existing = await fetchProfile(result.pubkey)
          if (existing) {
            nip46Profile.value = existing
            displayName.value = existing.display_name || existing.name || ''
            aboutMe.value = existing.about || ''
          }
        } catch {
          // Non-critical — profile fetch from relays can fail
        }

        nip46Status.value = 'done'
        step.value = 3
        return
      } catch (err) {
        // Clean up the orphaned account on connection failure
        try { await removeAccount(account.id) } catch { /* best effort */ }
        throw err
      }
    }
  } catch (err) {
    error.value = err.message || 'Something went wrong'
    nip46Status.value = ''
  } finally {
    loading.value = false
  }
}

function copyConnectUri() {
  if (!nostrConnectUri.value) return
  navigator.clipboard.writeText(nostrConnectUri.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2500)
}

async function handlePublishProfile() {
  loading.value = true
  error.value = ''

  try {
    const profileData = {
      name: displayName.value.trim(),
      ...(aboutMe.value.trim() && { about: aboutMe.value.trim() }),
    }
    publishResult.value = await publishProfile(profileData)
    step.value = 5
  } catch (err) {
    error.value = err.message || 'Failed to publish profile'
  } finally {
    loading.value = false
  }
}

function skipPublish() {
  step.value = 5
}

function finish() {
  // Publish NIP-65 relay list so other clients know where to reach us.
  // Without this, senders don't know which relays to send DMs to.
  // For new accounts: always publish (no existing list).
  // For imports: only publish if no NIP-65 exists yet (don't overwrite).
  // Fire-and-forget — don't block the user from entering the app.
  if (createdAccount.value?.mode === 'local') {
    const isImport = mode.value === 'import' || mode.value === 'recover'
    sendMsg('GET_RELAY_CONFIG')
      .then(async (config) => {
        const relays = config?.account || []
        if (relays.length === 0) return
        if (isImport) {
          // Check if imported account already has a NIP-65 on the network
          const existing = await sendMsg('FETCH_NIP65').catch(() => null)
          if (existing) return // don't overwrite
        }
        return sendMsg('PUBLISH_NIP65', { both: relays, read: [], write: [] })
      })
      .catch(() => { /* best effort */ })
  }
  nostrConnectCompleted = true
  emit('complete')
}

function copyMnemonic() {
  if (!createdAccount.value?.mnemonic) return
  navigator.clipboard.writeText(createdAccount.value.mnemonic)
  copied.value = true
  setTimeout(() => (copied.value = false), 2500)
}

async function startIdentityBackupVerification() {
  if (!createdAccount.value?.id || loading.value) return
  loading.value = true
  error.value = ''
  try {
    backupChallenge.value = await sendMsg('BEGIN_IDENTITY_BACKUP_VERIFICATION', createdAccount.value.id)
    backupAnswers.value = Array(backupChallenge.value?.indices?.length || 1).fill('')
    showNsec.value = false
    backupStage.value = 'verify'
  } catch (err) {
    error.value = err.message || t('common.error')
  } finally {
    loading.value = false
  }
}

async function confirmIdentityBackup() {
  if (!backupChallenge.value?.token || !createdAccount.value?.id || loading.value) return
  loading.value = true
  error.value = ''
  try {
    await sendMsg(
      'CONFIRM_IDENTITY_BACKUP',
      createdAccount.value.id,
      backupChallenge.value.token,
      backupAnswers.value,
    )
    step.value = 4
  } catch (err) {
    error.value = t('wizard.backupVerificationFailed')
  } finally {
    loading.value = false
  }
}

// Clean up timers on unmount to prevent memory leaks
onBeforeUnmount(() => {
  if (nostrConnectCountdownTimer) {
    clearInterval(nostrConnectCountdownTimer)
    nostrConnectCountdownTimer = null
  }
  if (nostrConnectPollTimer) {
    clearInterval(nostrConnectPollTimer)
    nostrConnectPollTimer = null
  }
  if (nostrConnectAccountId.value && !nostrConnectCompleted) cleanupNostrConnectAccount()
  else cancelNostrConnect().catch(() => {})
  mnemonicWords.value = ''
  recoveryCandidates.value = []
})
</script>

<template>
  <div class="space-y-5">

    <!-- ── Step progress bar ── -->
    <div v-if="mode" class="px-1">
      <div class="flex items-center gap-0">
        <template v-for="(label, i) in stepLabels" :key="i">
          <!-- Step circle + label -->
          <div class="flex flex-col items-center gap-1 min-w-0" :style="{ flex: '0 0 auto' }">
            <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300"
              :class="i + 1 < step
                ? 'bg-success text-white'
                : i + 1 === step
                  ? 'bg-brand text-surface-base ring-2 ring-brand/20'
                  : 'bg-surface-elevated text-text-muted'">
              <Check v-if="i + 1 < step" class="w-3 h-3" />
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span class="text-[8px] font-semibold uppercase tracking-wider"
              :class="i + 1 <= step ? 'text-text-secondary' : 'text-text-muted'">
              {{ label }}
            </span>
          </div>
          <!-- Connector line -->
          <div v-if="i < stepLabels.length - 1"
            class="flex-1 h-px mx-1.5 mb-4 transition-colors duration-300"
            :class="i + 1 < step ? 'bg-success' : 'bg-border'" />
        </template>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 1: Choose how to set up              -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 1" class="space-y-4 animate-fade-in-up">

      <!-- Welcome header -->
      <div class="text-center space-y-2 pt-1">
        <div class="w-11 h-11 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto">
          <Shield class="w-5 h-5 text-brand" />
        </div>
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.addAccount') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ t('wizard.addAccountDesc') }}
        </p>
      </div>

      <!-- Primary mode cards -->
      <div class="space-y-2">
        <button
          v-for="m in primaryModes" :key="m.id"
          @click="selectMode(m.id)"
          class="w-full flex items-center gap-3.5 p-3.5 rounded-3xl bg-surface-card border text-left group card-interactive relative shadow-sm"
          :class="m.recommended ? 'border-brand/30' : 'border-border hover:border-brand/20'"
        >
          <!-- Recommended ribbon -->
          <span v-if="m.recommended"
            class="absolute -top-px -right-px text-[8px] font-bold uppercase tracking-wider bg-brand text-surface-base px-2 py-0.5 rounded-bl-lg rounded-tr-3xl">
            {{ t('wizard.recommended') }}
          </span>

          <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0"
            :class="m.recommended ? 'bg-brand/10' : 'bg-surface-elevated'">
            <component :is="m.icon" class="w-5 h-5" :class="m.recommended ? 'text-brand' : 'text-text-muted'" />
          </div>
          <div class="flex-1 min-w-0 pr-4">
            <div class="text-[13px] font-extrabold group-hover:text-brand transition-all duration-200">{{ m.title }}</div>
            <div class="text-[10px] text-text-muted leading-relaxed mt-0.5">{{ m.desc }}</div>
          </div>
          <ArrowRight class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200 shrink-0 absolute right-3.5 top-1/2 -translate-y-1/2" />
        </button>
      </div>

      <!-- Advanced options toggle -->
      <button
        @click="showAdvanced = !showAdvanced"
        class="w-full flex items-center justify-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary py-1.5 transition-all duration-200 font-medium"
      >
        <span>{{ t('wizard.advancedOptions') }}</span>
        <ArrowRight class="w-3 h-3 transition-transform duration-200" :class="showAdvanced ? 'rotate-90' : ''" />
      </button>

      <!-- Advanced mode cards (collapsed by default) -->
      <div v-if="showAdvanced" class="space-y-2 animate-fade-in-up">
        <button
          v-for="m in advancedModes" :key="m.id"
          @click="selectMode(m.id)"
          class="w-full flex items-center gap-3.5 p-3.5 rounded-3xl bg-surface-card border text-left group card-interactive relative shadow-sm border-border hover:border-brand/20"
        >
          <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-surface-elevated">
            <component :is="m.icon" class="w-5 h-5 text-text-muted" />
          </div>
          <div class="flex-1 min-w-0 pr-4">
            <div class="text-[13px] font-extrabold group-hover:text-brand transition-all duration-200">{{ m.title }}</div>
            <div class="text-[10px] text-text-muted leading-relaxed mt-0.5">{{ m.desc }}</div>
          </div>
          <ArrowRight class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200 shrink-0 absolute right-3.5 top-1/2 -translate-y-1/2" />
        </button>
      </div>

      <button @click="emit('cancel')" class="w-full text-[11px] text-text-muted hover:text-text-secondary py-2 transition-all duration-200 font-medium">
        {{ t('common.cancel') }}
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 2: Input details                     -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 2" class="space-y-4 animate-fade-in-up">

      <!-- Back button -->
      <button @click="goBack" class="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
        <ArrowLeft class="w-3.5 h-3.5" /> {{ t('common.back') }}
      </button>

      <!-- Header -->
      <div class="text-center space-y-1.5">
        <h2 class="text-[15px] font-extrabold tracking-tight">
          {{ mode === 'new' ? t('wizard.chooseName')
            : mode === 'recover' ? t('wizard.recoverAccount')
            : mode === 'import' ? t('wizard.importAccount')
            : t('wizard.connectSigner') }}
        </h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ mode === 'new' ? t('wizard.chooseNameDesc')
            : mode === 'recover' ? t('wizard.recoverAccountDesc')
            : mode === 'import' ? t('wizard.importAccountDesc')
            : t('wizard.connectSignerDesc') }}
        </p>
      </div>

      <!-- ── New: Name input ── -->
      <div v-if="mode === 'new'" class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">
          {{ t('wizard.displayName') }}
        </label>
        <input v-model="displayName" :placeholder="t('wizard.namePlaceholder')"
          autofocus maxlength="50"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
        <p class="text-[10px] text-text-muted px-0.5 leading-relaxed">
          {{ t('wizard.nameHint') }}
        </p>
      </div>

      <!-- ── Import: Key input only ── -->
      <template v-if="mode === 'import'">
        <div class="space-y-2">
          <div class="flex items-center justify-between px-0.5">
            <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{{ t('wizard.backupKey') }}</label>
            <button @click="showScanner = !showScanner"
              class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium">
              <ScanLine class="w-3 h-3" />
              {{ showScanner ? t('common.typeInstead') : t('common.scanQr') }}
            </button>
          </div>

          <QrScanner v-if="showScanner"
            @scan="(val) => { importNsec = val; showScanner = false }"
            @close="showScanner = false" />

          <div v-else class="relative">
            <input v-model="importNsec" :type="showNsec ? 'text' : 'password'" :placeholder="t('wizard.backupKeyPlaceholder')"
              class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 pr-11 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono placeholder:text-text-muted/50 placeholder:font-sans" />
            <button @click="showNsec = !showNsec"
              class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-all duration-200 rounded-md">
              <EyeOff v-if="showNsec" class="w-4 h-4" />
              <Eye v-else class="w-4 h-4" />
            </button>
          </div>
          <p v-if="importKeyError" class="text-[10px] text-warning px-0.5">
            {{ importKeyError }}
          </p>
          <div class="flex items-start gap-1.5 px-0.5">
            <Info class="w-3 h-3 text-text-muted shrink-0 mt-px" />
            <p class="text-[10px] text-text-muted leading-relaxed">
              {{ t('wizard.nsecWhereToFind') }}
            </p>
          </div>
        </div>
      </template>

      <!-- ── Recover: Name (optional) + Mnemonic input ── -->
      <div v-if="mode === 'recover'" class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">
          {{ t('wizard.displayName') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span>
        </label>
        <input v-model="displayName" placeholder="satoshi" maxlength="50"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
      </div>

      <div v-if="mode === 'recover'" class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">
          {{ t('wizard.recoveryWords') }}
        </label>
        <textarea v-model="mnemonicWords"
          :placeholder="t('wizard.recoveryWordsPlaceholder')"
          rows="3"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono placeholder:text-text-muted/50 placeholder:font-sans resize-none lowercase" />
        <div class="flex items-center justify-between px-0.5">
          <p v-if="mnemonicWords.trim().split(/\s+/).filter(Boolean).length >= 12 && !nip06.validateMnemonic(mnemonicWords.trim().toLowerCase())"
            class="text-[10px] text-warning leading-relaxed">
            {{ t('wizard.invalidMnemonic') }}
          </p>
          <p v-else class="text-[10px] text-text-muted leading-relaxed">
            {{ t('wizard.recoveryWordsHint') }}
          </p>
          <span class="text-[10px] tabular-nums font-mono"
            :class="mnemonicWords.trim().split(/\s+/).filter(Boolean).length >= 12 ? 'text-success' : 'text-text-muted'">
            {{ mnemonicWords.trim().split(/\s+/).filter(Boolean).length }}/12
          </span>
        </div>
      </div>

      <div v-if="mode === 'recover' && manualRecoveryIndex === ''"
        class="flex items-start gap-2.5 p-3 rounded-3xl bg-brand/5 border border-brand/15">
        <Info class="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <p class="text-[10px] text-text-muted leading-relaxed">
          {{ t('wizard.recoveryScanPrivacy') }}
        </p>
      </div>

      <details v-if="mode === 'recover'" class="group rounded-2xl border border-border bg-surface-card overflow-hidden">
        <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-3.5 py-3 text-[10px] font-semibold text-text-secondary">
          <span>{{ t('wizard.recoverySpecificAccount') }}</span>
          <ArrowRight class="w-3.5 h-3.5 text-text-muted transition-transform group-open:rotate-90" />
        </summary>
        <div class="px-3.5 pb-3.5 space-y-2 border-t border-border pt-3">
          <p class="text-[10px] text-text-muted leading-relaxed">{{ t('wizard.recoverySpecificAccountHint') }}</p>
          <input v-model="manualRecoveryIndex" type="number" min="0" max="2147483647" step="1"
            :placeholder="t('wizard.recoveryAccountNumberPlaceholder')"
            class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono placeholder:text-text-muted/50" />
          <p v-if="manualRecoveryError" class="text-[10px] text-warning">{{ manualRecoveryError }}</p>
        </div>
      </details>

      <!-- ── NIP-46: Connection method toggle ── -->
      <div v-if="mode === 'nip46' && !loading && nip46Status !== 'waiting'" class="space-y-3">
        <!-- Method toggle -->
        <div class="flex rounded-2xl border border-border overflow-hidden">
          <button @click="nip46Method = 'bunker'"
            class="flex-1 py-2 text-[11px] font-semibold transition-all duration-200"
            :class="nip46Method === 'bunker' ? 'bg-brand text-surface-base' : 'bg-surface-card text-text-muted hover:text-text-secondary'">
            {{ t('wizard.pasteUri') }}
          </button>
          <button @click="nip46Method = 'nostrconnect'"
            class="flex-1 py-2 text-[11px] font-semibold transition-all duration-200"
            :class="nip46Method === 'nostrconnect' ? 'bg-brand text-surface-base' : 'bg-surface-card text-text-muted hover:text-text-secondary'">
            {{ t('wizard.showQr') }}
          </button>
        </div>

        <!-- Bunker URI input -->
        <template v-if="nip46Method === 'bunker'">
          <div class="flex items-center justify-between px-0.5">
            <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{{ t('wizard.connectionLink') }}</label>
            <button @click="showScanner = !showScanner"
              class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium">
              <ScanLine class="w-3 h-3" />
              {{ showScanner ? t('common.typeInstead') : t('common.scanQr') }}
            </button>
          </div>

          <QrScanner v-if="showScanner"
            @scan="(val) => { bunkerUri = val; showScanner = false }"
            @close="showScanner = false" />

          <template v-else>
            <input v-model="bunkerUri" :placeholder="t('wizard.connectionPlaceholder')"
              class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all font-mono placeholder:text-text-muted/50 placeholder:font-sans" />
            <div class="flex items-start gap-1.5 px-0.5">
              <Info class="w-3 h-3 text-text-muted shrink-0 mt-px" />
              <p class="text-[10px] text-text-muted leading-relaxed">
                {{ t('wizard.signerHint') }}
              </p>
            </div>
          </template>
        </template>

        <!-- Nostr Connect info -->
        <div v-else class="flex items-start gap-1.5 px-0.5">
          <Info class="w-3 h-3 text-text-muted shrink-0 mt-px" />
          <p class="text-[10px] text-text-muted leading-relaxed">
            {{ t('wizard.nostrConnectHint') }}
          </p>
        </div>
      </div>

      <!-- ── NIP-46: Nostr Connect waiting screen ── -->
      <div v-if="mode === 'nip46' && nip46Status === 'waiting' && nostrConnectQr" class="space-y-4 animate-fade-in-up">
        <div class="flex flex-col items-center gap-3 bg-surface-card rounded-3xl border border-border shadow-sm p-4">
          <p class="text-[11px] font-semibold text-text-secondary">{{ t('wizard.scanWithSigner') }}</p>
          <img :src="nostrConnectQr" alt="QR" class="w-[200px] h-[200px] rounded-lg" />
          <button @click="copyConnectUri"
            class="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-brand transition-all duration-200 font-medium">
            <Check v-if="copied" class="w-3 h-3 text-success" />
            <Copy v-else class="w-3 h-3" />
            {{ copied ? t('common.copied') : t('wizard.copyUri') }}
          </button>
          <div class="flex items-center gap-2 text-[10px] text-text-muted">
            <Loader2 class="w-3 h-3 animate-spin text-brand" />
            <span>{{ t('wizard.waitingForSigner') }}</span>
            <span v-if="nostrConnectCountdown > 0" class="tabular-nums text-text-muted/60">
              {{ Math.floor(nostrConnectCountdown / 60) }}:{{ (nostrConnectCountdown % 60).toString().padStart(2, '0') }}
            </span>
            <span v-else-if="nostrConnectCountdown <= 0 && nostrConnectQr" class="text-warning">
              {{ t('wizard.connectExpired') }}
            </span>
          </div>
        </div>
      </div>

      <!-- ── NIP-46 connection progress ── -->
      <div v-if="mode === 'nip46' && loading" class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-4 animate-fade-in-up">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-[10px] bg-brand/10 flex items-center justify-center shrink-0">
            <Loader2 class="w-5 h-5 text-brand animate-spin" />
          </div>
          <div>
            <div class="text-[13px] font-extrabold">
              {{ nip46Status === 'creating' ? t('wizard.connectPreparing') :
                 nip46Status === 'connecting' ? t('wizard.connectConnecting') :
                 nip46Status === 'fetching-profile' ? t('wizard.connectFetchingProfile') :
                 t('common.working') }}
            </div>
            <div class="text-[10px] text-text-muted mt-0.5">
              {{ nip46Status === 'connecting' ? t('wizard.connectTimeout') :
                 nip46Status === 'fetching-profile' ? t('wizard.connectAlmostThere') :
                 t('common.pleaseWait') }}
            </div>
          </div>
        </div>

        <!-- Progress steps -->
        <div class="space-y-2.5 pl-1">
          <div v-for="(s, i) in [
            { key: 'creating', label: t('wizard.progressSecureConnection') },
            { key: 'connecting', label: t('wizard.progressConnecting') },
            { key: 'fetching-profile', label: t('wizard.progressLoadingProfile') },
          ]" :key="s.key"
            class="flex items-center gap-2.5 text-[11px] transition-colors"
            :class="
              (['connecting','fetching-profile','done'].includes(nip46Status) && i === 0) ||
              (['fetching-profile','done'].includes(nip46Status) && i === 1) ||
              (nip46Status === 'done' && i === 2)
                ? 'text-success'
                : nip46Status === s.key
                  ? 'text-brand'
                  : 'text-text-muted/50'
            ">
            <CheckCircle2 v-if="
              (['connecting','fetching-profile','done'].includes(nip46Status) && i === 0) ||
              (['fetching-profile','done'].includes(nip46Status) && i === 1) ||
              (nip46Status === 'done' && i === 2)
            " class="w-3.5 h-3.5" />
            <Loader2 v-else-if="nip46Status === s.key" class="w-3.5 h-3.5 animate-spin" />
            <span v-else class="w-3.5 h-3.5 rounded-full border-[1.5px] border-current inline-block" />
            <span>{{ s.label }}</span>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="flex items-start gap-2.5 p-3 rounded-3xl bg-error/8 border border-error/15 text-[11px] text-error animate-scale-in">
        <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <span class="font-semibold">{{ t('common.error') }}</span>
          <p class="mt-0.5 text-error/80">{{ error }}</p>
        </div>
      </div>

      <!-- Action button -->
      <button v-if="!(mode === 'nip46' && loading) && !(mode === 'nip46' && nip46Method === 'nostrconnect' && (nostrConnectQr || nip46Status === 'creating' || nip46Status === 'waiting'))" @click="handleStep2" :disabled="!canProceedStep2 || loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <template v-if="loading">
          <Loader2 class="w-4 h-4 animate-spin" />
          <span v-if="mode === 'new'">{{ t('wizard.creatingKey') }}</span>
        </template>
        <template v-else>
          {{ mode === 'new' ? t('wizard.createIdentity') : mode === 'recover' ? (manualRecoveryIndex === '' ? t('wizard.findIdentities') : t('wizard.recoverAccountBtn')) : mode === 'import' ? t('wizard.importAccountBtn') : t('wizard.connect') }}
          <ArrowRight class="w-4 h-4" />
        </template>
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 3 (new): Backup your secret key      -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 3 && mode === 'new'" class="space-y-4 animate-fade-in-up">

      <!-- Header -->
      <div class="text-center space-y-2">
        <div class="w-11 h-11 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto">
          <ShieldAlert class="w-5 h-5 text-warning" />
        </div>
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ backupStage === 'verify' ? t('wizard.verifyBackup') : t('wizard.backupTitle') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ backupStage === 'verify' ? t('wizard.backupVerifyDesc') : t('wizard.backupDesc') }}
        </p>
      </div>

      <!-- Recovery words card -->
      <div v-if="backupStage === 'show'" class="bg-surface-card rounded-3xl border border-warning/25 overflow-hidden shadow-sm">

        <!-- Warning banner -->
        <div class="bg-warning/8 px-4 py-2.5 flex items-center gap-2 border-b border-warning/15">
          <AlertTriangle class="w-3.5 h-3.5 text-warning shrink-0" />
          <span class="text-[10px] text-warning font-semibold">{{ t('wizard.mnemonicWarning') }}</span>
        </div>

        <!-- 12-word grid -->
        <div class="p-4 space-y-3">
          <div class="relative">
            <!-- Real words enter the page only after reveal, so nothing
                 sensitive sits in the DOM behind the blur. -->
            <div class="grid grid-cols-3 gap-2"
              :class="showNsec ? '' : 'blur-[8px] select-none pointer-events-none'">
              <div v-for="(word, i) in mnemonicDisplay" :key="i"
                class="flex items-center gap-1.5 bg-surface-base rounded-lg px-2.5 py-2 border border-border">
                <span class="text-[10px] text-text-muted font-mono w-4 text-right">{{ i + 1 }}</span>
                <span class="text-[12px] font-medium text-text-secondary select-all">{{ showNsec ? word : '••••' }}</span>
              </div>
            </div>
            <!-- Reveal overlay -->
            <button v-if="!showNsec" @click="showNsec = true"
              class="absolute inset-0 flex items-center justify-center gap-2 bg-surface-card/60 rounded-lg cursor-pointer group">
              <Eye class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200" />
              <span class="text-[11px] font-semibold text-text-muted group-hover:text-brand transition-all duration-200">{{ t('wizard.clickToReveal') }}</span>
            </button>
          </div>

          <!-- Copy words -->
          <button @click="copyMnemonic"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] rounded-2xl font-semibold transition-all"
            :class="copied
              ? 'bg-success/10 text-success border border-success/20'
              : 'bg-surface-elevated text-text-secondary hover:bg-surface-hover border border-border'">
            <Check v-if="copied" class="w-3.5 h-3.5" />
            <Copy v-else class="w-3.5 h-3.5" />
            {{ copied ? t('common.copied') : t('wizard.copyWords') }}
          </button>
        </div>
      </div>

      <div v-else class="bg-surface-card rounded-3xl border border-border p-4 space-y-3">
        <div class="grid grid-cols-3 gap-2">
          <label v-for="(wordIndex, index) in backupChallenge?.indices || []" :key="wordIndex" class="space-y-1">
            <span class="text-[10px] font-semibold text-text-muted">{{ t('wizard.wordNumber', { number: wordIndex + 1 }) }}</span>
            <input v-model="backupAnswers[index]" autocomplete="off" autocapitalize="none" spellcheck="false"
              class="w-full bg-surface-base border border-border rounded-xl px-2.5 py-2 text-sm outline-none focus:border-brand" />
          </label>
        </div>
        <button @click="backupStage = 'show'; error = ''" class="text-[10px] text-brand font-semibold">{{ t('wizard.showAgain') }}</button>
      </div>

      <!-- Continue button -->
      <div v-if="error" class="flex items-start gap-2.5 p-3 rounded-3xl bg-error/8 border border-error/15 text-[11px] text-error">
        <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <button v-if="backupStage === 'show'" @click="startIdentityBackupVerification" :disabled="loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        {{ t('wizard.verifyBackup') }}
        <ArrowRight class="w-4 h-4" />
      </button>
      <button v-else @click="confirmIdentityBackup" :disabled="backupAnswers.some(answer => !answer.trim()) || loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        {{ t('wizard.confirmBackup') }}
        <ArrowRight class="w-4 h-4" />
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 3 (recover): Choose a derived identity -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 3 && mode === 'recover'" class="space-y-4 animate-fade-in-up">

      <button @click="goBack" class="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
        <ArrowLeft class="w-3.5 h-3.5" /> {{ t('common.back') }}
      </button>

      <div class="text-center space-y-1.5">
        <div class="w-11 h-11 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-2">
          <UserRound class="w-5 h-5 text-brand" />
        </div>
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.chooseRecoveredIdentity') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ recoveryNetworkChecked ? t('wizard.multipleIdentitiesFound') : t('wizard.recoveryScanUnavailable') }}
        </p>
      </div>

      <div class="space-y-2 max-h-[310px] overflow-y-auto pr-0.5">
        <label v-for="candidate in visibleRecoveryCandidates" :key="candidate.accountIndex"
          class="flex items-center gap-3 p-3 rounded-3xl border cursor-pointer transition-all"
          :class="selectedRecoveryIndex === candidate.accountIndex ? 'border-brand bg-brand/5' : 'border-border bg-surface-card hover:border-brand/25'">
          <input v-model="selectedRecoveryIndex" type="radio" :value="candidate.accountIndex" class="sr-only" />
          <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
            :class="selectedRecoveryIndex === candidate.accountIndex ? 'bg-brand text-surface-base' : 'bg-surface-elevated text-text-secondary'">
            {{ (candidate.profile?.display_name || candidate.profile?.name || String(candidate.accountIndex + 1))[0].toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-bold text-[12px] truncate">
                {{ candidate.profile?.display_name || candidate.profile?.name || t('wizard.derivedIdentity', { number: candidate.accountIndex + 1 }) }}
              </span>
              <span v-if="candidate.used" class="text-[8px] font-bold uppercase tracking-wide text-success bg-success/10 rounded-full px-1.5 py-0.5 shrink-0">
                {{ t('wizard.activityFound') }}
              </span>
            </div>
            <div class="text-[9px] text-text-muted font-mono truncate mt-0.5">{{ truncateKey(candidate.npub, 13, 5) }}</div>
            <div class="text-[8px] text-text-muted/70 font-mono truncate mt-0.5">{{ candidate.path }}</div>
          </div>
          <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
            :class="selectedRecoveryIndex === candidate.accountIndex ? 'border-brand' : 'border-border'">
            <div v-if="selectedRecoveryIndex === candidate.accountIndex" class="w-2 h-2 rounded-full bg-brand" />
          </div>
        </label>
      </div>

      <button v-if="!showAllRecoveryCandidates && recoveryCandidates.length > visibleRecoveryCandidates.length"
        @click="showAllRecoveryCandidates = true"
        class="w-full text-[10px] text-text-muted hover:text-brand py-1 font-semibold transition-colors">
        {{ t('wizard.showAllDerivedIdentities', { count: recoveryCandidates.length }) }}
      </button>

      <div v-if="error" class="flex items-start gap-2.5 p-3 rounded-3xl bg-error/8 border border-error/15 text-[11px] text-error">
        <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <button @click="handleRecoverySelection" :disabled="loading || selectedRecoveryIndex === null"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        <span>{{ loading ? t('wizard.recoveringIdentity') : t('wizard.importSelectedIdentity') }}</span>
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 4 (recover): Profile editing          -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 4 && mode === 'recover'" class="space-y-4 animate-fade-in-up">

      <div class="text-center space-y-1.5">
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.profileTitle') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ t('wizard.profileDesc') }}
        </p>
      </div>

      <div class="bg-surface-card rounded-3xl p-4 border border-border shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full bg-brand flex items-center justify-center text-surface-base font-bold text-lg shrink-0">
            {{ (displayName || '?')[0].toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="font-extrabold text-sm truncate">{{ displayName || 'Anonymous' }}</div>
            <div class="text-[10px] text-text-muted font-mono mt-0.5 truncate">
              {{ createdAccount?.npub ? truncateKey(createdAccount.npub, 14, 6) : '' }}
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">{{ t('wizard.displayName') }}</label>
        <input v-model="displayName" placeholder="satoshi"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
      </div>

      <div class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">{{ t('wizard.about') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span></label>
        <textarea v-model="aboutMe" :placeholder="t('wizard.aboutPlaceholder')" rows="2"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50 resize-none" />
      </div>

      <div v-if="error" class="flex items-start gap-2.5 p-3 rounded-3xl bg-error/8 border border-error/15 text-[11px] text-error">
        <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <button @click="handlePublishProfile" :disabled="loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        <span>{{ loading ? t('wizard.saving') : t('wizard.saveProfile') }}</span>
      </button>

      <button @click="skipPublish" class="w-full text-[11px] text-text-muted hover:text-text-secondary py-1 transition-all duration-200 font-medium">
        {{ t('common.skip') }}
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 3 (nip46): Connected success         -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 3 && mode === 'nip46'" class="space-y-4 animate-fade-in-up">
      <div class="text-center space-y-2 pt-1">
        <div class="w-12 h-12 rounded-full bg-success/12 flex items-center justify-center mx-auto">
          <CheckCircle2 class="w-6 h-6 text-success" />
        </div>
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.connectedTitle') }}</h2>
        <p class="text-[11px] text-text-muted">{{ t('wizard.connectedDesc') }}</p>
      </div>

      <!-- Connected identity card -->
      <div class="bg-surface-card rounded-3xl border border-border overflow-hidden shadow-sm">
        <div class="p-4 space-y-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
              :class="nip46Profile?.picture ? '' : 'bg-brand text-surface-base'">
              <img v-if="nip46Profile?.picture" :src="nip46Profile.picture" alt="" class="w-full h-full object-cover" />
              <span v-else class="font-bold text-lg">{{ (displayName || '?')[0].toUpperCase() }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-extrabold text-sm truncate">{{ displayName || 'Anonymous' }}</div>
              <div v-if="createdAccount?.pubkey" class="text-[10px] text-text-muted font-mono mt-0.5 truncate">
                {{ truncateKey(createdAccount.pubkey, 14, 6) }}
              </div>
            </div>
            <span class="flex items-center gap-1 text-[9px] text-success font-bold px-2 py-0.5 rounded-full bg-success/10 border border-success/20 shrink-0">
              <Wifi class="w-2.5 h-2.5" />
              {{ t('wizard.connectedBadge') }}
            </span>
          </div>

          <div v-if="nip46Profile?.about" class="text-[11px] text-text-muted line-clamp-2 leading-relaxed">
            {{ nip46Profile.about }}
          </div>

          <div v-if="nip46Profile?.nip05" class="flex items-center gap-1.5 text-[10px] text-text-muted">
            <CheckCircle2 class="w-3 h-3 text-brand" />
            <span class="font-mono">{{ nip46Profile.nip05 }}</span>
          </div>
        </div>
      </div>

      <!-- Explainer -->
      <div class="flex items-start gap-2.5 p-3 rounded-3xl bg-surface-card border border-border shadow-sm">
        <Info class="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <p class="text-[10px] text-text-muted leading-relaxed">
          <strong class="text-text-secondary">{{ t('wizard.howItWorks') }}</strong> {{ t('wizard.signerExplainer') }}
        </p>
      </div>

      <!-- Pin extension tip -->
      <div class="bg-surface-card rounded-2xl border border-border p-3.5 flex items-start gap-3">
        <div class="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
          <Puzzle class="w-4.5 h-4.5 text-brand" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold text-text-primary leading-snug">{{ t('wizard.pinTitle') }}</p>
          <p class="text-[10px] text-text-muted mt-0.5 leading-relaxed">{{ t('wizard.pinDesc') }}</p>
        </div>
      </div>

      <button @click="finish"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all font-bold btn-primary">
        {{ t('common.getStarted') }}
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 4 (new): Profile details             -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 4 && mode === 'new'" class="space-y-4 animate-fade-in-up">

      <!-- Back button -->
      <button @click="goBack" class="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
        <ArrowLeft class="w-3.5 h-3.5" /> {{ t('common.back') }}
      </button>

      <div class="text-center space-y-1.5">
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.completeProfile') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ t('wizard.completeProfileDesc') }}
        </p>
      </div>

      <!-- Profile preview card -->
      <div class="bg-surface-card rounded-3xl p-4 border border-border shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full bg-brand flex items-center justify-center text-surface-base font-bold text-lg shrink-0">
            {{ (displayName || '?')[0].toUpperCase() }}
          </div>
          <div class="min-w-0">
            <div class="font-extrabold text-sm truncate">{{ displayName || 'Anonymous' }}</div>
            <div class="text-[10px] text-text-muted font-mono mt-0.5 truncate">
              {{ createdAccount?.npub ? truncateKey(createdAccount.npub, 14, 6) : '' }}
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">{{ t('wizard.displayName') }}</label>
        <input v-model="displayName" placeholder="satoshi"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
      </div>

      <div class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">{{ t('wizard.about') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span></label>
        <textarea v-model="aboutMe" :placeholder="t('wizard.aboutPlaceholder')" rows="2"
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50 resize-none" />
      </div>

      <div v-if="error" class="flex items-start gap-2.5 p-3 rounded-3xl bg-error/8 border border-error/15 text-[11px] text-error">
        <AlertTriangle class="w-4 h-4 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <button @click="handlePublishProfile" :disabled="loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        <span>{{ loading ? t('wizard.saving') : t('wizard.saveProfile') }}</span>
      </button>

      <button @click="skipPublish" class="w-full text-[11px] text-text-muted hover:text-text-secondary py-1 transition-all duration-200 font-medium">
        {{ t('common.skip') }}
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Final step: Done                          -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="(step === 5 && mode === 'new') || (step === 3 && mode === 'import') || (step === 5 && mode === 'recover')" class="space-y-4 animate-fade-in-up">
      <div class="text-center space-y-2 pt-4">
        <div class="w-14 h-14 rounded-full bg-success/12 flex items-center justify-center mx-auto">
          <Check class="w-7 h-7 text-success" />
        </div>
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.doneTitle') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[260px] mx-auto">
          {{ t('wizard.doneDesc') }}
        </p>
      </div>

      <div v-if="publishResult" class="bg-surface-card rounded-3xl p-3.5 border border-border shadow-sm space-y-1.5">
        <div v-if="publishResult.published?.length" class="flex items-center gap-2 text-[11px] text-success font-medium">
          <CheckCircle2 class="w-3.5 h-3.5" />
          {{ t('wizard.profileSaved') }}
        </div>
        <div v-if="publishResult.failed?.length" class="flex items-center gap-2 text-[11px] text-warning font-medium">
          <AlertTriangle class="w-3.5 h-3.5" />
          {{ t('wizard.profileSyncLater') }}
        </div>
      </div>

      <!-- Pin extension tip -->
      <div class="bg-surface-card rounded-2xl border border-border p-3.5 flex items-start gap-3">
        <div class="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
          <Puzzle class="w-4.5 h-4.5 text-brand" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold text-text-primary leading-snug">{{ t('wizard.pinTitle') }}</p>
          <p class="text-[10px] text-text-muted mt-0.5 leading-relaxed">{{ t('wizard.pinDesc') }}</p>
        </div>
      </div>

      <button @click="finish"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all font-bold btn-primary">
        {{ t('common.getStarted') }}
      </button>
    </div>
  </div>
</template>
