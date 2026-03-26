<script setup>
/**
 * Cashu wallet backup management — export, import, relay restore.
 * Used in the options page WalletPage.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import { Download, Upload, Cloud, Loader2, AlertTriangle } from 'lucide-vue-next'

const { t } = useI18n()
const { exportBackup, importBackup, restoreFromRelay } = useWallet()
const toast = useToast()

const exporting = ref(false)
const importing = ref(false)
const restoring = ref(false)
const error = ref('')

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
    error.value = err.message || 'Export failed'
  } finally {
    exporting.value = false
  }
}

async function handleImport(event) {
  const file = event.target?.files?.[0]
  if (!file) return
  if (file.size > 10_000_000) {
    error.value = t('wallet.fileTooLarge')
    return
  }
  importing.value = true
  error.value = ''
  try {
    const data = await file.text()
    const result = await importBackup(data)
    toast.success(t('wallet.backupImported'))
  } catch (err) {
    error.value = err.message || 'Import failed'
  } finally {
    importing.value = false
    event.target.value = '' // reset file input
  }
}

async function handleRestore() {
  restoring.value = true
  error.value = ''
  try {
    const result = await restoreFromRelay()
    if (result?.proofCount > 0) {
      toast.success(t('wallet.backupRestored', { count: result.proofCount }))
    } else {
      toast.info(t('wallet.backupNoData'))
    }
  } catch (err) {
    error.value = err.message || 'Restore failed'
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
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

      <!-- Restore from relay -->
      <button
        @click="handleRestore"
        :disabled="restoring"
        class="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-card border border-border hover:border-brand/20 transition-all duration-200 text-left"
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
    </div>
  </div>
</template>
