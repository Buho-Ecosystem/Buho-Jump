<script setup>
/**
 * Relay Settings — full-page overlay with three pool tabs (Account, Wallet, Chat).
 * Each tab shows the relay list with status, add/remove, and reset to defaults.
 * Account tab includes NIP-65 publish/fetch for local accounts.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRelays } from '../composables/useRelays.js'
import { useAccounts } from '../composables/useAccounts.js'
import { useToast } from '../composables/useToast.js'
import RelayInfoSheet from './RelayInfoSheet.vue'
import BottomSheet from './BottomSheet.vue'
import {
  ArrowLeft, Plus, Trash2, RotateCcw, Loader2,
  AlertTriangle, Upload, Download, Globe,
} from 'lucide-vue-next'

const emit = defineEmits(['back'])

const { t } = useI18n()
const { relayConfig, loading, loadRelays, addRelay, removeRelay, resetPool, setPoolRelays, publishRelayList, fetchRelayList } = useRelays()
const { activeAccount } = useAccounts()
const toast = useToast()

const activePool = ref('account')
const newRelayUrl = ref('')
const addError = ref('')
const adding = ref(false)
const publishing = ref(false)
const fetching = ref(false)

// Info sheet
const infoRelayUrl = ref(null)

// Confirmation states
const confirmReset = ref(false)
const confirmRemoveUrl = ref(null)
const removing = ref(null)

const pools = computed(() => [
  { id: 'account', label: t('relay.tabAccount') },
  { id: 'wallet', label: t('relay.tabWallet') },
  { id: 'chat', label: t('relay.tabChat') },
])

const activeRelays = computed(() => relayConfig.value[activePool.value] || [])

const isLocalAccount = computed(() => activeAccount.value?.mode === 'local')

onMounted(() => { loadRelays() })

async function handleAdd() {
  const url = newRelayUrl.value.trim()
  if (!url) return

  addError.value = ''
  adding.value = true
  try {
    await addRelay(activePool.value, url)
    newRelayUrl.value = ''
  } catch (err) {
    if (err.message?.includes('Duplicate')) {
      addError.value = t('relay.duplicate')
    } else if (err.message?.includes('Invalid')) {
      addError.value = t('relay.invalidUrl')
    } else {
      addError.value = err.message || t('common.error')
    }
  } finally {
    adding.value = false
  }
}

async function handleRemove() {
  const url = confirmRemoveUrl.value
  if (!url) return
  removing.value = url
  try {
    await removeRelay(activePool.value, url)
    confirmRemoveUrl.value = null
  } catch {
    toast.error(t('common.error'))
  } finally {
    removing.value = null
  }
}

async function handleReset() {
  try {
    await resetPool(activePool.value)
    confirmReset.value = false
    toast.success(t('relay.resetDefaults'))
  } catch {
    toast.error(t('common.error'))
  }
}

async function handlePublish() {
  publishing.value = true
  try {
    const result = await publishRelayList()
    if (result?.published?.length) {
      toast.success(t('relay.publishSuccess', { count: result.published.length }))
    } else {
      toast.error(t('relay.publishFailed'))
    }
  } catch {
    toast.error(t('relay.publishFailed'))
  } finally {
    publishing.value = false
  }
}

async function handleFetch() {
  fetching.value = true
  try {
    const result = await fetchRelayList()
    if (!result) {
      toast.info(t('relay.fetchEmpty'))
      return
    }
    const allRelays = [...(result.both || []), ...(result.read || []), ...(result.write || [])]
    if (allRelays.length === 0) {
      toast.info(t('relay.fetchEmpty'))
      return
    }
    // Merge with current account relays
    const current = relayConfig.value.account || []
    const merged = [...new Set([...current, ...allRelays])]
    await setPoolRelays('account', merged)
    toast.success(t('relay.fetchSuccess', { count: allRelays.length }))
  } catch {
    toast.error(t('common.error'))
  } finally {
    fetching.value = false
  }
}

function relayHostname(url) {
  try { return new URL(url).hostname } catch { return url }
}
</script>

<template>
  <div class="space-y-3 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2">
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-colors">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('relay.title') }}</span>
    </div>

    <!-- Warning banner -->
    <div class="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-warning/8 border border-warning/15">
      <AlertTriangle class="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
      <p class="text-[10px] text-warning leading-relaxed font-medium">{{ t('relay.warning') }}</p>
    </div>

    <!-- Pool tabs -->
    <div class="flex bg-surface-elevated rounded-lg p-0.5 gap-0.5">
      <button
        v-for="pool in pools"
        :key="pool.id"
        @click="activePool = pool.id; addError = ''; newRelayUrl = ''"
        class="flex-1 text-xs font-medium py-1.5 rounded-md transition-all"
        :class="activePool === pool.id
          ? 'bg-surface-card text-brand shadow-sm'
          : 'text-text-muted hover:text-text-secondary'"
      >
        {{ pool.label }}
      </button>
    </div>

    <!-- Relay list -->
    <div v-if="loading" class="space-y-2">
      <div class="skeleton-shimmer h-12 rounded-xl" />
      <div class="skeleton-shimmer h-12 rounded-xl" />
      <div class="skeleton-shimmer h-12 rounded-xl" />
    </div>

    <div v-else class="space-y-1 max-h-52 overflow-y-auto">
      <button
        v-for="url in activeRelays"
        :key="url"
        @click="infoRelayUrl = url"
        class="w-full flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-xl border border-border hover:border-brand/30 transition-all group text-left"
      >
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="w-7 h-7 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0">
            <Globe class="w-3.5 h-3.5 text-text-muted" />
          </div>
          <div class="min-w-0">
            <span class="text-xs font-medium truncate block">{{ relayHostname(url) }}</span>
            <span class="text-[9px] text-text-muted truncate block">{{ url }}</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button
            @click.stop="confirmRemoveUrl = url"
            class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all"
          >
            <Trash2 class="w-3 h-3 text-text-muted hover:text-error" />
          </button>
        </div>
      </button>

      <!-- Empty state -->
      <div v-if="activeRelays.length === 0" class="bg-surface-card rounded-xl border border-border p-6 text-center">
        <Globe class="w-5 h-5 text-text-muted mx-auto mb-2" />
        <p class="text-xs text-text-muted">{{ t('relay.empty') }}</p>
      </div>
    </div>

    <!-- Add relay input -->
    <div class="space-y-1">
      <div class="flex gap-2">
        <input
          v-model="newRelayUrl"
          :placeholder="t('relay.addPlaceholder')"
          class="flex-1 bg-surface-base border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted font-mono"
          @keydown.enter="handleAdd"
        />
        <button
          @click="handleAdd"
          :disabled="adding || !newRelayUrl.trim()"
          class="px-3 py-2 text-xs rounded-lg bg-brand text-surface-base font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors flex items-center gap-1 btn-primary"
        >
          <Loader2 v-if="adding" class="w-3 h-3 animate-spin" />
          <Plus v-else class="w-3.5 h-3.5" />
        </button>
      </div>
      <p v-if="addError" class="text-[10px] text-error px-1">{{ addError }}</p>
    </div>

    <!-- Reset to defaults -->
    <button
      @click="confirmReset = true"
      class="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-text-muted hover:text-brand transition-colors"
    >
      <RotateCcw class="w-3 h-3" />
      {{ t('relay.resetDefaults') }}
    </button>

    <!-- NIP-65 section (account tab + local accounts only) -->
    <div v-if="activePool === 'account'" class="space-y-2 pt-1 border-t border-border">
      <div class="px-1">
        <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{{ t('relay.nip65Title') }}</p>
        <p class="text-[9px] text-text-muted mt-0.5">{{ t('relay.nip65Desc') }}</p>
      </div>

      <div v-if="isLocalAccount" class="grid grid-cols-2 gap-2">
        <button
          @click="handlePublish"
          :disabled="publishing"
          class="flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-surface-card border border-border hover:border-brand/30 transition-colors font-medium disabled:opacity-50"
        >
          <Loader2 v-if="publishing" class="w-3 h-3 animate-spin text-brand" />
          <Upload v-else class="w-3 h-3 text-text-muted" />
          {{ publishing ? t('relay.publishing') : t('relay.publishList') }}
        </button>
        <button
          @click="handleFetch"
          :disabled="fetching"
          class="flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-surface-card border border-border hover:border-brand/30 transition-colors font-medium disabled:opacity-50"
        >
          <Loader2 v-if="fetching" class="w-3 h-3 animate-spin text-brand" />
          <Download v-else class="w-3 h-3 text-text-muted" />
          {{ fetching ? t('relay.fetching') : t('relay.fetchList') }}
        </button>
      </div>

      <p v-else class="text-[10px] text-text-muted px-1 italic">{{ t('relay.nip65LocalOnly') }}</p>
    </div>

    <!-- Remove confirmation (bottom sheet) -->
    <BottomSheet :open="!!confirmRemoveUrl" variant="danger" @close="confirmRemoveUrl = null">
      <template #icon><AlertTriangle class="w-4 h-4 text-error" /></template>
      <template #description>{{ t('relay.removeConfirm', { url: confirmRemoveUrl, pool: activePool }) }}</template>
      <template #actions>
        <button @click="confirmRemoveUrl = null"
          class="py-2 text-xs rounded-lg bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleRemove"
          :disabled="!!removing"
          class="py-2 text-xs rounded-lg bg-error text-white hover:bg-error/90 transition-colors font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="removing" class="w-3 h-3 animate-spin" />
          {{ t('relay.remove') }}
        </button>
      </template>
    </BottomSheet>

    <!-- Reset confirmation (bottom sheet) -->
    <BottomSheet :open="confirmReset" variant="brand" @close="confirmReset = false">
      <template #icon><RotateCcw class="w-4 h-4 text-brand" /></template>
      <template #description>{{ t('relay.resetConfirm', { pool: activePool }) }}</template>
      <template #actions>
        <button @click="confirmReset = false"
          class="py-2 text-xs rounded-lg bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleReset"
          class="py-2 text-xs rounded-lg bg-brand text-surface-base hover:bg-brand-hover transition-colors font-semibold btn-primary">
          {{ t('relay.resetDefaults') }}
        </button>
      </template>
    </BottomSheet>

    <!-- Relay info sheet -->
    <Teleport to="body">
      <RelayInfoSheet
        v-if="infoRelayUrl"
        :url="infoRelayUrl"
        @close="infoRelayUrl = null"
      />
    </Teleport>
  </div>
</template>
