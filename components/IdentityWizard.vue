<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccounts } from '../composables/useAccounts.js'
import { truncateKey } from '../lib/utils.js'
import {
  KeyRound, Download, Link2, ArrowRight, ArrowLeft, Eye, EyeOff,
  Copy, Check, AlertTriangle, Globe, UserRound, Shield, ScanLine,
  Loader2, Wifi, CheckCircle2, XCircle, ShieldAlert,
  Sparkles, Info, RotateCcw,
} from 'lucide-vue-next'
import QrScanner from './QrScanner.vue'

const emit = defineEmits(['complete', 'cancel'])
const { t } = useI18n()

const { create, createWithMnemonic, importKey, importMnemonic, createRemote, connectRemote, startNostrConnect, cancelNostrConnect, loadNip46Status, nip46Status: nip46GlobalStatus, publishProfile, fetchProfile, load: loadAccounts } = useAccounts()

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
const backupConfirmed = ref(false)
const downloadedKey = ref(false)

// ── Mnemonic state ──
const mnemonicWords = ref('')
const mnemonicDisplay = ref([]) // 12 words for backup display

// ── NIP-46 connection state ──
const nip46Status = ref('')
const nip46Profile = ref(null)
const nip46Method = ref('bunker') // 'bunker' | 'nostrconnect'
const nostrConnectUri = ref('')
const nostrConnectQr = ref('')
const nostrConnectAccountId = ref(null)
let nostrConnectPollTimer = null

// ── Created account data ──
const createdAccount = ref(null)
const publishResult = ref(null)

const modes = computed(() => [
  {
    id: 'new',
    icon: Sparkles,
    title: t('wizard.modeNewTitle'),
    desc: t('wizard.modeNewDesc'),
    recommended: true,
  },
  {
    id: 'recover',
    icon: RotateCcw,
    title: t('wizard.modeRecoverTitle'),
    desc: t('wizard.modeRecoverDesc'),
    recommended: false,
  },
  {
    id: 'import',
    icon: Download,
    title: t('wizard.modeImportTitle'),
    desc: t('wizard.modeImportDesc'),
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

const canProceedStep2 = computed(() => {
  if (mode.value === 'new') return displayName.value.trim().length > 0
  if (mode.value === 'recover') return mnemonicWords.value.trim().split(/\s+/).filter(Boolean).length >= 12
  if (mode.value === 'import') return importNsec.value.trim().length > 0
  if (mode.value === 'nip46') return nip46Method.value === 'nostrconnect' || bunkerUri.value.trim().length > 0
  return false
})

const totalSteps = computed(() => {
  if (mode.value === 'nip46') return 3
  if (mode.value === 'import') return 4
  if (mode.value === 'recover') return 4
  return 5 // new: choose → name → backup → profile → done
})

const stepLabels = computed(() => {
  if (mode.value === 'nip46') return [t('wizard.stepSetup'), t('wizard.stepConnect'), t('wizard.stepDone')]
  if (mode.value === 'import') return [t('wizard.stepSetup'), t('wizard.stepImport'), t('wizard.stepProfile'), t('wizard.stepDone')]
  if (mode.value === 'recover') return [t('wizard.stepSetup'), t('wizard.stepRecover'), t('wizard.stepProfile'), t('wizard.stepDone')]
  return [t('wizard.stepSetup'), t('wizard.stepName'), t('wizard.stepBackup'), t('wizard.stepProfile'), t('wizard.stepDone')]
})

// ── Step handlers ──

function selectMode(m) {
  mode.value = m
  step.value = 2
  error.value = ''
}

function goBack() {
  error.value = ''
  if (nostrConnectPollTimer) { clearInterval(nostrConnectPollTimer); nostrConnectPollTimer = null }
  cancelNostrConnect()
  if (step.value === 2) {
    step.value = 1
    mode.value = null
    nip46Status.value = ''
    nostrConnectUri.value = ''
    nostrConnectQr.value = ''
  } else if (step.value === 3 && mode.value === 'new') {
    // Backup step — allow going back to name input
    step.value = 2
  } else if (step.value === 3 && (mode.value === 'import' || mode.value === 'recover')) {
    // Profile step — allow going back to input
    step.value = 2
  } else if (step.value === 4 && mode.value === 'new') {
    // Profile step — allow going back to backup
    step.value = 3
  }
}

async function handleStep2() {
  loading.value = true
  error.value = ''

  try {
    if (mode.value === 'new') {
      const account = await createWithMnemonic(displayName.value.trim())
      if (!account) throw new Error('Account creation returned no data')
      createdAccount.value = account
      mnemonicDisplay.value = account.mnemonic.split(' ')
      step.value = 3
    } else if (mode.value === 'recover') {
      const account = await importMnemonic(displayName.value.trim() || undefined, mnemonicWords.value.trim())
      if (!account) throw new Error('Recovery failed')
      createdAccount.value = account
      step.value = 3
      if (account.pubkey) {
        fetchProfile(account.pubkey)
          .then((existing) => {
            if (existing) {
              displayName.value = existing.display_name || existing.name || displayName.value
              aboutMe.value = existing.about || ''
            }
          })
          .catch(() => {})
      }
    } else if (mode.value === 'import') {
      const account = await importKey(displayName.value.trim() || undefined, importNsec.value.trim())
      if (!account) throw new Error('Import returned no data')
      createdAccount.value = account
      // Advance to profile step immediately — don't block on relay fetch
      step.value = 3
      // Fetch existing profile in the background to pre-fill name/about
      if (account.pubkey) {
        fetchProfile(account.pubkey)
          .then((existing) => {
            if (existing) {
              displayName.value = existing.display_name || existing.name || displayName.value
              aboutMe.value = existing.about || ''
            }
          })
          .catch(() => { /* relay fetch failed — user can fill in manually */ })
      }
    } else if (mode.value === 'nip46') {
      if (nip46Method.value === 'nostrconnect') {
        // Nostr Connect flow — generate QR, wait for signer
        nip46Status.value = 'creating'
        const account = await createRemote('Remote Signer')
        nostrConnectAccountId.value = account.id

        nip46Status.value = 'waiting'
        const result = await startNostrConnect(account.id)
        if (result?.error) throw new Error(result.error)

        nostrConnectUri.value = result.uri
        // Generate QR
        const QRCode = (await import('qrcode')).default
        nostrConnectQr.value = await QRCode.toDataURL(result.uri, {
          width: 220, margin: 2, color: { dark: '#000', light: '#fff' },
        })

        // Poll for connection completion
        loading.value = false
        nostrConnectPollTimer = setInterval(async () => {
          await loadNip46Status()
          if (nip46GlobalStatus.value.connected) {
            clearInterval(nostrConnectPollTimer)
            nostrConnectPollTimer = null
            await loadAccounts()
            nip46Status.value = 'done'
            step.value = 3
          }
        }, 1500)
        return
      }

      // Bunker URI flow
      nip46Status.value = 'creating'
      const account = await createRemote('Remote Signer')

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
    step.value = (mode.value === 'import' || mode.value === 'recover') ? 4 : 5
  } catch (err) {
    error.value = err.message || 'Failed to publish profile'
  } finally {
    loading.value = false
  }
}

function skipPublish() {
  step.value = (mode.value === 'import' || mode.value === 'recover') ? 4 : 5
}

function finish() {
  emit('complete')
}

function copyMnemonic() {
  if (!createdAccount.value?.mnemonic) return
  navigator.clipboard.writeText(createdAccount.value.mnemonic)
  copied.value = true
  setTimeout(() => (copied.value = false), 2500)
}
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

      <!-- Mode cards -->
      <div class="space-y-2">
        <button
          v-for="m in modes" :key="m.id"
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
          autofocus
          class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
        <p class="text-[10px] text-text-muted px-0.5 leading-relaxed">
          {{ t('wizard.nameHint') }}
        </p>
      </div>

      <!-- ── Import: Name + Key input ── -->
      <template v-if="mode === 'import'">
        <div class="space-y-2">
          <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">
            {{ t('wizard.displayName') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span>
          </label>
          <input v-model="displayName" placeholder="satoshi"
            class="w-full bg-surface-card border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all placeholder:text-text-muted/50" />
        </div>

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
          <div class="flex items-start gap-1.5 px-0.5">
            <Info class="w-3 h-3 text-text-muted shrink-0 mt-px" />
            <p class="text-[10px] text-text-muted leading-relaxed">
              {{ t('wizard.keySecurityHint') }}
            </p>
          </div>
        </div>
      </template>

      <!-- ── Recover: Name (optional) + Mnemonic input ── -->
      <div v-if="mode === 'recover'" class="space-y-2">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold block px-0.5">
          {{ t('wizard.displayName') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span>
        </label>
        <input v-model="displayName" placeholder="satoshi"
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
          <p class="text-[10px] text-text-muted leading-relaxed">
            {{ t('wizard.recoveryWordsHint') }}
          </p>
          <span class="text-[10px] tabular-nums font-mono"
            :class="mnemonicWords.trim().split(/\s+/).filter(Boolean).length >= 12 ? 'text-success' : 'text-text-muted'">
            {{ mnemonicWords.trim().split(/\s+/).filter(Boolean).length }}/12
          </span>
        </div>
      </div>

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
            {{ t('wizard.waitingForSigner') }}
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
      <button v-if="!(mode === 'nip46' && loading)" @click="handleStep2" :disabled="!canProceedStep2 || loading"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold btn-primary flex items-center justify-center gap-2">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        <template v-else>
          {{ mode === 'new' ? t('wizard.createAccount') : mode === 'recover' ? t('wizard.recoverAccountBtn') : mode === 'import' ? t('wizard.importAccountBtn') : t('wizard.connect') }}
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
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.backupTitle') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ t('wizard.backupDesc') }}
        </p>
      </div>

      <!-- Recovery words card -->
      <div class="bg-surface-card rounded-3xl border border-warning/25 overflow-hidden shadow-sm">

        <!-- Warning banner -->
        <div class="bg-warning/8 px-4 py-2.5 flex items-center gap-2 border-b border-warning/15">
          <AlertTriangle class="w-3.5 h-3.5 text-warning shrink-0" />
          <span class="text-[10px] text-warning font-semibold">{{ t('wizard.mnemonicWarning') }}</span>
        </div>

        <!-- 12-word grid -->
        <div class="p-4 space-y-3">
          <div class="relative">
            <div class="grid grid-cols-3 gap-2"
              :class="showNsec ? '' : 'blur-[8px] select-none pointer-events-none'">
              <div v-for="(word, i) in mnemonicDisplay" :key="i"
                class="flex items-center gap-1.5 bg-surface-base rounded-lg px-2.5 py-2 border border-border">
                <span class="text-[10px] text-text-muted font-mono w-4 text-right">{{ i + 1 }}</span>
                <span class="text-[12px] font-medium text-text-secondary select-all">{{ word }}</span>
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

      <!-- Confirmation checkbox -->
      <label class="flex items-start gap-3 p-3 rounded-3xl cursor-pointer transition-all duration-200"
        :class="backupConfirmed ? 'bg-success/5 border border-success/20' : 'bg-surface-card border border-border hover:border-brand/20'">
        <input type="checkbox" v-model="backupConfirmed"
          class="mt-0.5 w-4 h-4 rounded border-border text-brand focus:ring-brand/20 accent-[var(--brand-primary)]" />
        <div>
          <span class="text-[11px] font-semibold" :class="backupConfirmed ? 'text-success' : 'text-text-primary'">
            {{ t('wizard.backupConfirm') }}
          </span>
          <p class="text-[10px] text-text-muted mt-0.5 leading-relaxed">
            {{ t('wizard.backupConfirmHint') }}
          </p>
        </div>
      </label>

      <!-- Continue button -->
      <button @click="step = 4" :disabled="!backupConfirmed"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold btn-primary flex items-center justify-center gap-2">
        {{ t('common.continue') }}
        <ArrowRight class="w-4 h-4" />
      </button>
    </div>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Step 3 (import/recover): Profile editing   -->
    <!-- ═══════════════════════════════════════════ -->
    <div v-if="step === 3 && (mode === 'import' || mode === 'recover')" class="space-y-4 animate-fade-in-up">

      <!-- Back button -->
      <button @click="goBack" class="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-all duration-200 font-medium">
        <ArrowLeft class="w-3.5 h-3.5" /> {{ t('common.back') }}
      </button>

      <div class="text-center space-y-1.5">
        <h2 class="text-[15px] font-extrabold tracking-tight">{{ t('wizard.profileTitle') }}</h2>
        <p class="text-[11px] text-text-muted leading-relaxed max-w-[280px] mx-auto">
          {{ t('wizard.profileDesc') }}
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
    <div v-if="(step === 5 && mode === 'new') || (step === 4 && (mode === 'import' || mode === 'recover'))" class="space-y-4 animate-fade-in-up">
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

      <button @click="finish"
        class="w-full py-3 text-[13px] rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all font-bold btn-primary">
        {{ t('common.getStarted') }}
      </button>
    </div>
  </div>
</template>
