<script setup>
/**
 * Wallet selector dropdown — sits in the header.
 * Shows active wallet name + balance badge, lists all wallets,
 * allows switching, renaming, removing, and adding new wallets.
 */
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSats } from '../../lib/utils.js'
import {
  Wallet, ChevronDown, Check, Plus, Pencil, Trash2,
  Loader2, Zap, AlertTriangle, X,
} from 'lucide-vue-next'
import BottomSheet from '../BottomSheet.vue'

const props = defineProps({
  wallets: { type: Array, default: () => [] },
  balance: { type: Number, default: null },
  connected: { type: Boolean, default: false },
  switching: { type: Boolean, default: false },
})

const emit = defineEmits(['switch', 'add', 'rename', 'remove'])
const { t } = useI18n()

const open = ref(false)
const dropdownRef = ref(null)
const triggerRef = ref(null)

// Rename state
const renamingId = ref(null)
const renameValue = ref('')
const renameInput = ref(null)

// Remove confirmation
const removingWallet = ref(null)

const activeWallet = computed(() => props.wallets.find(w => w.isActive))
const otherWallets = computed(() => props.wallets.filter(w => !w.isActive))

function toggle() {
  open.value = !open.value
}

function handleSwitch(walletId) {
  if (activeWallet.value?.id === walletId) return
  emit('switch', walletId)
  open.value = false
}

function startRename(wallet) {
  renamingId.value = wallet.id
  renameValue.value = wallet.name
  nextTick(() => renameInput.value?.focus())
}

function confirmRename() {
  if (!renamingId.value || !renameValue.value.trim()) return
  emit('rename', renamingId.value, renameValue.value.trim())
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

function requestRemove(wallet) {
  removingWallet.value = wallet
  open.value = false
}

function confirmRemove() {
  if (!removingWallet.value) return
  emit('remove', removingWallet.value.id)
  removingWallet.value = null
}

function handleAdd() {
  emit('add')
  open.value = false
}

// Click outside to close
function onClickOutside(e) {
  if (!open.value) return
  if (dropdownRef.value?.contains(e.target)) return
  if (triggerRef.value?.contains(e.target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', onClickOutside, true))
onUnmounted(() => document.removeEventListener('click', onClickOutside, true))
</script>

<template>
  <div class="relative">
    <!-- Trigger -->
    <button
      ref="triggerRef"
      @click.stop="toggle"
      class="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all duration-200 max-w-[140px]"
      :class="open ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'"
    >
      <Wallet class="w-3 h-3 shrink-0" :class="connected ? 'text-brand' : 'text-text-muted'" />

      <template v-if="connected && activeWallet">
        <span class="text-[11px] font-semibold truncate">{{ activeWallet.name }}</span>
        <span v-if="balance != null" class="text-[9px] text-text-muted font-mono shrink-0">
          {{ formatSats(balance) }}
        </span>
      </template>
      <template v-else>
        <span class="text-[11px] text-text-muted font-medium truncate">{{ t('wallet.connectPrompt') }}</span>
      </template>

      <ChevronDown
        class="w-2.5 h-2.5 text-text-muted shrink-0 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      ref="dropdownRef"
      class="absolute left-0 top-full mt-1.5 w-56 bg-surface-card rounded-2xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-left"
    >
      <!-- Header -->
      <div class="px-3 pt-2.5 pb-1.5">
        <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">
          {{ t('wallet.walletSelector') }}
        </span>
      </div>

      <!-- Active wallet -->
      <div v-if="activeWallet" class="px-2 pb-1">
        <div class="flex items-center gap-2 px-2 py-2 rounded-xl bg-brand/5 border border-brand/15">
          <div class="w-7 h-7 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <Zap class="w-3.5 h-3.5 text-brand" />
          </div>
          <div class="flex-1 min-w-0">
            <!-- Rename mode -->
            <template v-if="renamingId === activeWallet.id">
              <div class="flex items-center gap-1">
                <input
                  ref="renameInput"
                  v-model="renameValue"
                  @keydown.enter="confirmRename"
                  @keydown.escape="cancelRename"
                  class="flex-1 text-[11px] font-semibold bg-transparent border-b border-brand outline-none py-0.5 min-w-0"
                  :placeholder="t('wallet.walletName')"
                />
                <button @click="confirmRename" class="p-0.5 rounded hover:bg-brand/10 transition-colors">
                  <Check class="w-3 h-3 text-brand" />
                </button>
                <button @click="cancelRename" class="p-0.5 rounded hover:bg-surface-elevated transition-colors">
                  <X class="w-3 h-3 text-text-muted" />
                </button>
              </div>
            </template>
            <!-- Normal display -->
            <template v-else>
              <div class="flex items-center gap-1">
                <span class="text-[11px] font-semibold truncate">{{ activeWallet.name }}</span>
                <span class="text-[8px] px-1 py-px rounded-full bg-brand/10 text-brand font-semibold shrink-0">
                  {{ t('wallet.activeWallet') }}
                </span>
              </div>
              <div v-if="balance != null" class="text-[10px] text-text-muted font-mono mt-0.5">
                {{ formatSats(balance) }} {{ t('wallet.sats') }}
              </div>
            </template>
          </div>
          <!-- Actions for active wallet -->
          <div v-if="renamingId !== activeWallet.id" class="flex items-center gap-0.5 shrink-0">
            <button
              @click.stop="startRename(activeWallet)"
              class="p-1 rounded-md hover:bg-brand/10 transition-colors"
              :title="t('wallet.renameWallet')"
            >
              <Pencil class="w-2.5 h-2.5 text-text-muted" />
            </button>
            <button
              @click.stop="requestRemove(activeWallet)"
              class="p-1 rounded-md hover:bg-error/10 transition-colors"
              :title="t('wallet.removeWallet')"
            >
              <Trash2 class="w-2.5 h-2.5 text-text-muted hover:text-error" />
            </button>
          </div>
        </div>
      </div>

      <!-- Other wallets -->
      <template v-if="otherWallets.length > 0">
        <div class="h-px bg-border mx-2" />
        <div class="px-2 py-1 space-y-0.5">
          <button
            v-for="w in otherWallets"
            :key="w.id"
            @click="handleSwitch(w.id)"
            :disabled="switching"
            class="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-surface-elevated transition-all duration-200 text-left group disabled:opacity-50"
          >
            <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center shrink-0">
              <Loader2 v-if="switching" class="w-3.5 h-3.5 text-text-muted animate-spin" />
              <Wallet v-else class="w-3.5 h-3.5 text-text-muted" />
            </div>
            <span class="flex-1 text-[11px] font-medium text-text-secondary truncate">{{ w.name }}</span>
            <!-- Rename / remove on hover -->
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                @click.stop="startRename(w)"
                class="p-1 rounded-md hover:bg-surface-elevated transition-colors"
              >
                <Pencil class="w-2.5 h-2.5 text-text-muted" />
              </button>
              <button
                @click.stop="requestRemove(w)"
                class="p-1 rounded-md hover:bg-error/10 transition-colors"
              >
                <Trash2 class="w-2.5 h-2.5 text-text-muted hover:text-error" />
              </button>
            </div>
          </button>
        </div>
      </template>

      <!-- Add wallet -->
      <div class="h-px bg-border mx-2" />
      <button
        @click="handleAdd"
        class="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left"
      >
        <Plus class="w-3.5 h-3.5 text-brand" />
        <span class="text-[11px] font-semibold text-brand">{{ t('wallet.addWallet') }}</span>
      </button>
    </div>

    <!-- Remove confirmation bottom sheet -->
    <BottomSheet :open="!!removingWallet" variant="danger" @close="removingWallet = null">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #title>{{ t('wallet.removeWalletTitle') }}</template>
      <template #description>
        <span v-if="removingWallet" class="font-semibold">{{ removingWallet.name }}</span>
        <br />{{ t('wallet.removeWalletDesc') }}
      </template>
      <template #actions>
        <button
          @click="removingWallet = null"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          @click="confirmRemove"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold"
        >
          {{ t('wallet.removeWallet') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
