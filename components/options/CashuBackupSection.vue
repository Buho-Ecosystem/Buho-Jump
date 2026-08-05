<script setup>
/**
 * Cashu wallet backup management — export, import, relay restore.
 * Used in the options page WalletPage.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useToast } from '../../composables/useToast.js'
import { Download, Upload, Cloud, Loader2, AlertTriangle, KeyRound, ShieldCheck, X } from 'lucide-vue-next'
import { requestOriginsAccess } from '../../lib/browser/hostPermissions.js'

const { t, te } = useI18n()
const {
  wallets, exportBackup, importBackup, previewBackupImport,
  restoreFromRelay, previewRelayRestore, restoreFromRecoveryWords,
  previewMintBackup,
} = useWallet()
const { activeAccount, load: loadAccounts } = useAccounts()
const toast = useToast()

const exporting = ref(false)
const importing = ref(false)
const restoring = ref(false)
const restoringWords = ref(false)
const error = ref('')
const pendingImport = ref(null)
const selectedImport = ref(null)
const importPassword = ref('')
const pendingRelay = ref(null)
// NUT-27: mints found under the recovery words, offered before restoring
const pendingWordMints = ref(null) // [{ url, checked }]
const canRelayRestore = computed(() => activeAccount.value?.mode === 'local')
const canWordRestore = computed(() => activeAccount.value?.capabilities?.seedBacked === true)

onMounted(() => loadAccounts().catch(() => {}))

function friendlyError(err, fallback) {
  return err?.message && te(err.message) ? t(err.message) : fallback
}

async function allowConfiguredMints(additionalMints = []) {
  const configured = wallets.value.find(wallet => wallet.isActive && wallet.type === 'cashu')?.mints || []
  const mints = [...new Set([...configured, ...additionalMints])]
  if (!(await requestOriginsAccess(mints))) throw new Error('cashu.mintAccessDenied')
}

function hostname(url) {
  try { return new URL(url).hostname } catch { return url }
}

async function handleExport() {
  exporting.value = true
  error.value = ''
  try {
    const result = await exportBackup()
    if (!result?.data) throw new Error('Export failed')
    // Trigger browser download
    const blob = new Blob([result.data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('wallet.backupExported'))
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupExportFailed'))
  } finally {
    exporting.value = false
  }
}

async function handleImport(event) {
  const file = event.target?.files?.[0]
  if (!file) return
  if (file.size > 10_000_000) {
    error.value = t('wallet.fileTooLarge')
    event.target.value = ''
    return
  }
  importing.value = true
  error.value = ''
  try {
    const data = await file.text()
    selectedImport.value = { data, name: file.name }
    pendingImport.value = null
    importPassword.value = ''
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupImportFailed'))
  } finally {
    importing.value = false
    event.target.value = '' // reset file input
  }
}

function clearImport() {
  selectedImport.value = null
  pendingImport.value = null
  importPassword.value = ''
}

async function reviewImport() {
  if (!selectedImport.value || !importPassword.value) return
  importing.value = true
  error.value = ''
  try {
    pendingImport.value = await previewBackupImport(
      selectedImport.value.data, importPassword.value,
    )
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupOpenFailed'))
  } finally {
    importing.value = false
  }
}

async function confirmImport() {
  if (!pendingImport.value || !selectedImport.value || !importPassword.value) return
  importing.value = true
  error.value = ''
  try {
    await allowConfiguredMints(pendingImport.value.mints)
    await importBackup(selectedImport.value.data, importPassword.value)
    clearImport()
    toast.success(t('wallet.backupImported'))
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupImportFailed'))
  } finally {
    importing.value = false
  }
}

async function handleRestore() {
  restoring.value = true
  error.value = ''
  try {
    const preview = await previewRelayRestore()
    if (!preview?.mints?.length && !preview?.proofCount && !preview?.hasReceivingKey) {
      toast.info(t('wallet.backupNoData'))
      pendingRelay.value = null
    } else {
      pendingRelay.value = preview
    }
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupRestoreFailed'))
  } finally {
    restoring.value = false
  }
}

async function confirmRelayRestore() {
  if (!pendingRelay.value) return
  restoring.value = true
  error.value = ''
  try {
    await allowConfiguredMints(pendingRelay.value.mints)
    const result = await restoreFromRelay()
    pendingRelay.value = null
    if (result?.proofCount > 0) {
      toast.success(t('wallet.backupRestored', { count: result.proofCount }))
    } else if (result?.receivingKeyRestored) {
      toast.success(t('wallet.relayReceivingKeyRestored'))
    } else {
      toast.info(t('wallet.recoveryNoFunds'))
    }
  } catch (err) {
    error.value = friendlyError(err, t('wallet.backupRestoreFailed'))
  } finally {
    restoring.value = false
  }
}

async function handleWordRestore() {
  restoringWords.value = true
  error.value = ''
  try {
    // NUT-27: the recovery words may have a saved mint list on relays.
    // Offer any mints this wallet does not use yet before scanning.
    const backup = await previewMintBackup().catch(() => null)
    if (backup?.mints?.length) {
      pendingWordMints.value = backup.mints.map(url => ({ url, checked: true }))
      restoringWords.value = false
      return
    }
    await runWordRestore([])
  } catch (err) {
    error.value = friendlyError(err, t('common.error'))
    restoringWords.value = false
  }
}

async function runWordRestore(extraMints) {
  restoringWords.value = true
  error.value = ''
  try {
    await allowConfiguredMints(extraMints)
    const result = await restoreFromRecoveryWords(extraMints.length ? extraMints : undefined)
    if (result?.proofCount > 0) {
      toast.success(t('wallet.backupRestored', { count: result.proofCount }))
    } else {
      toast.info(t('wallet.recoveryNoFunds'))
    }
  } catch (err) {
    error.value = friendlyError(err, t('common.error'))
  } finally {
    restoringWords.value = false
  }
}

function confirmWordMints() {
  const selected = (pendingWordMints.value || []).filter(entry => entry.checked).map(entry => entry.url)
  pendingWordMints.value = null
  runWordRestore(selected)
}
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl bg-brand/5 border border-brand/10 px-4 py-3 flex items-center gap-3">
      <img src="/Onboarding wizard/Hidden mining-bro.svg" alt="" class="w-16 h-16 object-contain shrink-0" />
      <div>
        <h3 class="text-xs font-bold">{{ t('wallet.ecashRecoveryTitle') }}</h3>
        <p class="text-[10px] text-text-muted mt-1 leading-relaxed">{{ t('wallet.ecashRecoveryIntro') }}</p>
      </div>
    </div>
    <h3 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">
      {{ t('wallet.backupWallet') }}
    </h3>
    <p class="text-xs text-text-muted px-1">{{ t('wallet.backupDesc') }}</p>

    <!-- Error -->
    <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-lg bg-error/10 text-error text-xs animate-scale-in">
      <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div class="space-y-2">
      <!-- Export -->
      <button
        @click="handleExport"
        :disabled="exporting"
        class="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card border border-border hover:border-brand/20 transition-all duration-200 text-left"
      >
        <div class="w-9 h-9 rounded-xl bg-brand/8 flex items-center justify-center shrink-0">
          <Download v-if="!exporting" class="w-4 h-4 text-brand" />
          <Loader2 v-else class="w-4 h-4 text-brand animate-spin" />
        </div>
        <div>
          <div class="text-xs font-semibold">{{ t('wallet.backupExport') }}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{{ t('wallet.backupWarning') }}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{{ t('wallet.backupPasswordHint') }}</div>
        </div>
      </button>

      <!-- Import -->
      <label
        class="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card border border-border hover:border-brand/20 transition-all duration-200 text-left cursor-pointer"
        :class="importing ? 'opacity-60 pointer-events-none' : ''"
      >
        <div class="w-9 h-9 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0">
          <Upload v-if="!importing" class="w-4 h-4 text-text-muted" />
          <Loader2 v-else class="w-4 h-4 text-text-muted animate-spin" />
        </div>
        <div>
          <div class="text-xs font-semibold">{{ t('wallet.backupImport') }}</div>
        </div>
        <input type="file" accept=".buho,.json" class="hidden" @change="handleImport" />
      </label>

      <form
        v-if="selectedImport && !pendingImport"
        @submit.prevent="reviewImport"
        class="rounded-2xl border border-brand/20 bg-brand/5 p-3.5 space-y-3"
      >
        <div class="flex items-start gap-2.5">
          <KeyRound class="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-bold">{{ t('wallet.backupPasswordTitle') }}</p>
            <p class="text-[10px] text-text-muted mt-1 leading-relaxed">
              {{ t('wallet.backupPasswordPrompt') }}
            </p>
            <p class="text-[10px] text-text-secondary mt-1.5 truncate">{{ selectedImport.name }}</p>
          </div>
          <button type="button" @click="clearImport" :aria-label="t('common.cancel')" class="p-1 rounded-lg hover:bg-surface-elevated">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
        <input
          v-model="importPassword"
          type="password"
          autocomplete="current-password"
          :placeholder="t('wallet.backupPasswordPlaceholder')"
          class="w-full bg-surface-base border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-colors"
        />
        <button type="submit" :disabled="!importPassword || importing"
          class="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-brand text-white text-[11px] font-bold disabled:opacity-60">
          <Loader2 v-if="importing" class="w-3 h-3 animate-spin" />
          {{ t('wallet.backupReview') }}
        </button>
      </form>

      <div v-if="pendingImport" class="rounded-2xl border border-brand/20 bg-brand/5 p-3.5 space-y-3">
        <div class="flex items-start gap-2.5">
          <ShieldCheck class="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-bold">{{ t('wallet.backupReadyTitle') }}</p>
            <p class="text-[10px] text-text-muted mt-1 leading-relaxed">
              {{ t('wallet.backupReadyDesc', { count: pendingImport.proofCount || 0 }) }}
            </p>
            <p v-if="pendingImport.hasReceivingKey" class="text-[10px] text-brand mt-1.5 leading-relaxed">
              {{ t('wallet.backupReceivingKeyFound') }}
            </p>
            <p v-if="pendingImport.mints?.length" class="text-[10px] text-text-secondary mt-1.5 break-words">
              {{ pendingImport.mints.map(hostname).join(', ') }}
            </p>
          </div>
          <button @click="clearImport" :aria-label="t('common.cancel')" class="p-1 rounded-lg hover:bg-surface-elevated">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
        <button @click="confirmImport" :disabled="importing"
          class="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-brand text-white text-[11px] font-bold disabled:opacity-60">
          <Loader2 v-if="importing" class="w-3 h-3 animate-spin" />
          {{ t('wallet.backupConfirmRestore') }}
        </button>
      </div>

      <!-- Restore from relay -->
      <button
        @click="handleRestore"
        :disabled="restoring || !canRelayRestore"
        class="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card border border-border hover:border-brand/20 transition-all duration-200 text-left"
        :class="!canRelayRestore ? 'opacity-60 cursor-not-allowed' : ''"
      >
        <div class="w-9 h-9 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0">
          <Cloud v-if="!restoring" class="w-4 h-4 text-text-muted" />
          <Loader2 v-else class="w-4 h-4 text-text-muted animate-spin" />
        </div>
        <div>
          <div class="text-xs font-semibold">{{ t('wallet.backupRestore') }}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{{ t('wallet.backupRestoreDesc') }}</div>
        </div>
      </button>
      <p v-if="activeAccount && !canRelayRestore" class="text-[10px] text-text-muted px-2 leading-relaxed">
        {{ t('wallet.relayRestoreUnavailable') }}
      </p>

      <div v-if="pendingRelay" class="rounded-2xl border border-brand/20 bg-brand/5 p-3.5 space-y-3">
        <div class="flex items-start gap-2.5">
          <ShieldCheck class="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-bold">{{ t('wallet.relayBackupReadyTitle') }}</p>
            <p class="text-[10px] text-text-muted mt-1 leading-relaxed">
              {{ t('wallet.relayBackupReadyDesc', { count: pendingRelay.proofCount || 0 }) }}
            </p>
            <p v-if="pendingRelay.hasReceivingKey" class="text-[10px] text-brand mt-1.5 leading-relaxed">
              {{ t('wallet.relayReceivingKeyFound') }}
            </p>
            <p v-if="pendingRelay.mints?.length" class="text-[10px] text-text-secondary mt-1.5 break-words">
              {{ pendingRelay.mints.map(hostname).join(', ') }}
            </p>
          </div>
          <button @click="pendingRelay = null" :aria-label="t('common.cancel')" class="p-1 rounded-lg hover:bg-surface-elevated">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
        <button @click="confirmRelayRestore" :disabled="restoring"
          class="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-brand text-white text-[11px] font-bold disabled:opacity-60">
          <Loader2 v-if="restoring" class="w-3 h-3 animate-spin" />
          {{ t('wallet.backupAllowAndRestore') }}
        </button>
      </div>

      <!-- NUT-27: mints found under the recovery words -->
      <div v-if="pendingWordMints" class="rounded-2xl border border-brand/25 bg-brand/5 p-3.5 space-y-2.5 animate-fade-in">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-xs font-bold">{{ t('wallet.wordMintsFound') }}</p>
            <p class="text-[10px] text-text-muted mt-1 leading-relaxed">{{ t('wallet.wordMintsFoundDesc') }}</p>
          </div>
          <button @click="pendingWordMints = null" :aria-label="t('common.cancel')" class="p-1 rounded-lg hover:bg-surface-elevated">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
        <label
          v-for="entry in pendingWordMints"
          :key="entry.url"
          class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface-card border border-border cursor-pointer hover:border-brand/30 transition-colors"
        >
          <input type="checkbox" v-model="entry.checked" class="accent-[var(--brand)] w-3.5 h-3.5" />
          <span class="text-[11px] font-medium truncate">{{ hostname(entry.url) }}</span>
        </label>
        <button @click="confirmWordMints" :disabled="restoringWords"
          class="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-brand text-white text-[11px] font-bold disabled:opacity-60">
          <Loader2 v-if="restoringWords" class="w-3 h-3 animate-spin" />
          {{ t('wallet.backupAllowAndRestore') }}
        </button>
      </div>

      <button
        @click="handleWordRestore"
        :disabled="restoringWords || !canWordRestore"
        class="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card border border-border hover:border-brand/20 transition-all duration-200 text-left"
        :class="!canWordRestore ? 'opacity-60 cursor-not-allowed' : ''"
      >
        <div class="w-9 h-9 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0">
          <KeyRound v-if="!restoringWords" class="w-4 h-4 text-brand" />
          <Loader2 v-else class="w-4 h-4 text-brand animate-spin" />
        </div>
        <div>
          <div class="text-xs font-semibold">{{ t('wallet.restoreFromWords') }}</div>
          <div class="text-[10px] text-text-muted mt-0.5">{{ t('wallet.restoreFromWordsDesc') }}</div>
        </div>
      </button>
      <p v-if="activeAccount && !canWordRestore" class="text-[10px] text-text-muted px-2 leading-relaxed">
        {{ t('wallet.wordRestoreUnavailable') }}
      </p>
    </div>
  </div>
</template>
