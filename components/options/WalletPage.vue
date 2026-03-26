<script setup>
/**
 * Options page — Wallet management.
 * Full-page view for managing multiple NWC wallet connections.
 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import CashuBackupSection from './CashuBackupSection.vue'
import { formatSats } from '../../lib/utils.js'
import BottomSheet from '../BottomSheet.vue'
import QrScanner from '../QrScanner.vue'
import {
  Zap, Wallet, Plus, Pencil, Trash2, Check, X,
  Link, ScanLine, Loader2, AlertTriangle, RefreshCw,
} from 'lucide-vue-next'

const { t } = useI18n()
const {
  status, wallets, walletType, connecting, switching,
  loadStatus, loadWallets, connect, disconnect, switchWallet, rename,
} = useWallet()
const toast = useToast()

// Connect form
const showConnectForm = ref(false)
const nwcUri = ref('')
const walletName = ref('')
const showScanner = ref(false)

// Rename
const renamingId = ref(null)
const renameValue = ref('')
const renameInput = ref(null)

// Remove
const removingWallet = ref(null)

const activeWallet = computed(() => wallets.value.find(w => w.isActive))
const otherWallets = computed(() => wallets.value.filter(w => !w.isActive))

onMounted(async () => {
  await Promise.all([loadStatus(), loadWallets()])
})

async function handleConnect() {
  if (!nwcUri.value.trim()) return
  try {
    await connect(nwcUri.value.trim(), walletName.value.trim() || undefined)
    nwcUri.value = ''
    walletName.value = ''
    showConnectForm.value = false
    toast.success(t('wallet.walletConnected'))
  } catch (err) {
    toast.error(err.message || t('wallet.connectFailedDetail'))
  }
}

function onScan(val) {
  nwcUri.value = val
  showScanner.value = false
}

function startRename(wallet) {
  renamingId.value = wallet.id
  renameValue.value = wallet.name
  nextTick(() => renameInput.value?.focus())
}

async function confirmRename() {
  if (!renamingId.value || !renameValue.value.trim()) return
  try {
    await rename(renamingId.value, renameValue.value.trim())
    toast.success(t('wallet.walletRenamed'))
  } catch (err) {
    toast.error(err.message)
  }
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function handleSwitch(walletId) {
  try {
    await switchWallet(walletId)
    const name = wallets.value.find(w => w.id === walletId)?.name || ''
    toast.success(t('wallet.walletSwitched', { name }))
  } catch (err) {
    toast.error(err.message || t('wallet.connectFailed'))
  }
}

async function confirmRemove() {
  if (!removingWallet.value) return
  await disconnect(removingWallet.value.id)
  removingWallet.value = null
  toast.info(t('toast.walletDisconnected'))
}

async function handleRefresh() {
  await Promise.all([loadStatus(), loadWallets()])
  toast.success(t('wallet.balanceUpdated'))
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-extrabold">{{ t('options.wallets') }}</h1>
        <p class="text-xs text-text-muted mt-0.5">{{ t('options.walletsDesc') }}</p>
      </div>
      <button
        @click="handleRefresh"
        class="p-2 rounded-xl hover:bg-surface-elevated transition-colors"
        :title="t('wallet.failedRefresh')"
      >
        <RefreshCw class="w-4 h-4 text-text-muted" />
      </button>
    </div>

    <!-- Active wallet card -->
    <div v-if="activeWallet" class="bg-surface-card rounded-3xl border border-brand/20 shadow-sm overflow-hidden">
      <div class="px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
            <Zap class="w-5 h-5 text-brand" />
          </div>
          <div class="flex-1 min-w-0">
            <!-- Rename mode -->
            <template v-if="renamingId === activeWallet.id">
              <div class="flex items-center gap-2">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  @keydown.enter="confirmRename"
                  @keydown.escape="cancelRename"
                  class="flex-1 text-sm font-semibold bg-transparent border-b border-brand outline-none py-0.5 min-w-0"
                  :placeholder="t('wallet.walletName')"
                />
                <button @click="confirmRename" class="p-1 rounded-lg hover:bg-brand/10 transition-colors">
                  <Check class="w-4 h-4 text-brand" />
                </button>
                <button @click="cancelRename" class="p-1 rounded-lg hover:bg-surface-elevated transition-colors">
                  <X class="w-4 h-4 text-text-muted" />
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-sm font-extrabold truncate">{{ activeWallet.name }}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand font-semibold shrink-0">
                  {{ t('wallet.activeWallet') }}
                </span>
              </div>
              <div v-if="status.balance != null" class="text-xs text-text-muted font-mono mt-0.5">
                {{ formatSats(status.balance) }} {{ t('wallet.sats') }}
              </div>
            </template>
          </div>
          <div v-if="renamingId !== activeWallet.id" class="flex items-center gap-1 shrink-0">
            <button @click="startRename(activeWallet)"
              class="p-2 rounded-xl hover:bg-brand/10 transition-colors" :title="t('wallet.renameWallet')">
              <Pencil class="w-3.5 h-3.5 text-text-muted" />
            </button>
            <button @click="removingWallet = activeWallet"
              class="p-2 rounded-xl hover:bg-error/10 transition-colors" :title="t('wallet.removeWallet')">
              <Trash2 class="w-3.5 h-3.5 text-text-muted hover:text-error" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Other wallets -->
    <div v-if="otherWallets.length > 0" class="space-y-2">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">
        {{ t('wallet.walletSelector') }}
      </h2>
      <button
        v-for="w in otherWallets"
        :key="w.id"
        @click="handleSwitch(w.id)"
        :disabled="switching"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left group disabled:opacity-50"
      >
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center shrink-0">
          <Loader2 v-if="switching" class="w-4 h-4 text-text-muted animate-spin" />
          <Wallet v-else class="w-4 h-4 text-text-muted" />
        </div>
        <span class="flex-1 text-sm font-medium text-text-secondary truncate">{{ w.name }}</span>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button @click.stop="startRename(w)" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-colors">
            <Pencil class="w-3 h-3 text-text-muted" />
          </button>
          <button @click.stop="removingWallet = w" class="p-1.5 rounded-lg hover:bg-error/10 transition-colors">
            <Trash2 class="w-3 h-3 text-text-muted hover:text-error" />
          </button>
        </div>
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="wallets.length === 0 && !showConnectForm"
      class="bg-surface-card rounded-3xl border border-border shadow-sm p-8 text-center">
      <div class="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-3">
        <img src="/nwc/nwc-logo.svg" alt="NWC" class="w-8 h-8" />
      </div>
      <p class="text-sm font-extrabold mb-1">{{ t('wallet.noWallets') }}</p>
      <p class="text-xs text-text-muted mb-4">{{ t('wallet.noWalletHomeDesc') }}</p>
      <button
        @click="showConnectForm = true"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-brand text-surface-base text-xs font-semibold hover:bg-brand-hover transition-colors btn-primary"
      >
        <Link class="w-3.5 h-3.5" />
        {{ t('wallet.connectWallet') }}
      </button>
    </div>

    <!-- Add wallet button -->
    <button
      v-if="wallets.length > 0 && !showConnectForm"
      @click="showConnectForm = true"
      class="w-full flex items-center justify-center gap-2 py-3 rounded-3xl border border-dashed border-border text-text-muted hover:text-brand hover:border-brand transition-all duration-200 text-sm font-medium"
    >
      <Plus class="w-4 h-4" />
      {{ t('wallet.addWallet') }}
    </button>

    <!-- Connect form -->
    <div v-if="showConnectForm" class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-extrabold">{{ t('wallet.addWallet') }}</h2>
        <button @click="showConnectForm = false; nwcUri = ''; walletName = ''"
          class="p-1 rounded-lg hover:bg-surface-elevated transition-colors">
          <X class="w-4 h-4 text-text-muted" />
        </button>
      </div>

      <input
        v-model="walletName"
        :placeholder="t('wallet.walletName')"
        class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
      />

      <div class="flex items-center justify-end">
        <button @click="showScanner = !showScanner"
          class="flex items-center gap-1 text-[10px] text-text-muted hover:text-brand transition-colors font-medium">
          <ScanLine class="w-3 h-3" />
          {{ showScanner ? t('common.typeInstead') : t('common.scanQr') }}
        </button>
      </div>

      <QrScanner v-if="showScanner" @scan="onScan" @close="showScanner = false" />

      <div v-else class="space-y-1.5">
        <input
          v-model="nwcUri"
          placeholder="nostr+walletconnect://..."
          class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted"
        />
        <p class="text-[10px] text-text-muted px-1 leading-relaxed">{{ t('wallet.nwcHelp') }}</p>
      </div>

      <button
        @click="handleConnect"
        :disabled="!nwcUri.trim() || connecting"
        class="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-semibold btn-primary"
      >
        <Loader2 v-if="connecting" class="w-4 h-4 animate-spin" />
        <Link v-else class="w-4 h-4" />
        {{ connecting ? t('wallet.connecting') : t('wallet.connectWallet') }}
      </button>
    </div>

    <!-- Remove confirmation -->
    <BottomSheet :open="!!removingWallet" variant="danger" @close="removingWallet = null">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #title>{{ t('wallet.removeWalletTitle') }}</template>
      <template #description>
        <span v-if="removingWallet" class="font-semibold">{{ removingWallet.name }}</span>
        <br />{{ t('wallet.removeWalletDesc') }}
      </template>
      <template #actions>
        <button @click="removingWallet = null"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="confirmRemove"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold">
          {{ t('wallet.removeWallet') }}
        </button>
      </template>
    </BottomSheet>

    <!-- Cashu backup section (only when Cashu wallet is active) -->
    <CashuBackupSection v-if="walletType === 'cashu'" class="mt-8" />
  </div>
</template>
