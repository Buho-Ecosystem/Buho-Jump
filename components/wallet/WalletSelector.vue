<script setup>
/**
 * Wallet selector dropdown — sits in the header.
 * Shows active wallet name + balance badge, lists all wallets,
 * allows switching, renaming, removing, and adding new wallets.
 */
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSats } from '../../lib/utils.js'
import {
  Wallet, ChevronDown, Check, Plus, Pencil, Trash2,
  Loader2, AlertTriangle, X,
} from 'lucide-vue-next'
import BottomSheet from '../BottomSheet.vue'

const WALLET_LOGOS = {
  nwc: '/nwc/nwc-logo.svg',
  cashu: '/cashu/cashuu.png',
  lnbits: '/lnbits/lnbits.svg',
}

const props = defineProps({
  wallets: { type: Array, default: () => [] },
  balance: { type: Number, default: null },
  connected: { type: Boolean, default: false },
  switching: { type: Boolean, default: false },
})

const emit = defineEmits(['switch', 'add', 'rename', 'remove'])
const { t } = useI18n()

const open = ref(false)

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

</script>

<template>
  <div class="relative">
    <!-- Trigger -->
    <button
      @click.stop="toggle"
      class="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all duration-200 max-w-[140px]"
      :class="open ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/50'"
    >
      <img v-if="activeWallet && WALLET_LOGOS[activeWallet.type]"
        :src="WALLET_LOGOS[activeWallet.type]"
        :alt="activeWallet.type"
        class="w-4 h-4 shrink-0 rounded-sm object-contain"
      />
      <Wallet v-else class="w-3 h-3 shrink-0" :class="connected ? 'text-brand' : 'text-text-muted'" />

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

    <!-- Wallet selector bottom sheet -->
    <BottomSheet :open="open" @close="open = false">
      <template #title>{{ t('wallet.walletSelector') }}</template>
      <template #content>
        <div class="space-y-2">
          <!-- Active wallet -->
          <div v-if="activeWallet"
            class="flex items-center gap-3 px-3 py-3 rounded-2xl bg-brand/5 border border-brand/15">
            <div class="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0 overflow-hidden">
              <img v-if="WALLET_LOGOS[activeWallet.type]"
                :src="WALLET_LOGOS[activeWallet.type]"
                :alt="activeWallet.type"
                class="w-full h-full object-cover rounded-xl"
              />
              <Wallet v-else class="w-4 h-4 text-brand" />
            </div>
            <div class="flex-1 min-w-0">
              <!-- Rename mode -->
              <template v-if="renamingId === activeWallet.id">
                <div class="flex items-center gap-1.5">
                  <input
                    ref="renameInput"
                    v-model="renameValue"
                    @keydown.enter="confirmRename"
                    @keydown.escape="cancelRename"
                    class="flex-1 text-xs font-semibold bg-transparent border-b border-brand outline-none py-0.5 min-w-0"
                    :placeholder="t('wallet.walletName')"
                  />
                  <button @click="confirmRename" class="p-1 rounded-lg hover:bg-brand/10 transition-colors">
                    <Check class="w-3.5 h-3.5 text-brand" />
                  </button>
                  <button @click="cancelRename" class="p-1 rounded-lg hover:bg-surface-elevated transition-colors">
                    <X class="w-3.5 h-3.5 text-text-muted" />
                  </button>
                </div>
              </template>
              <!-- Normal display -->
              <template v-else>
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-semibold truncate">{{ activeWallet.name }}</span>
                  <span class="text-[8px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand font-semibold shrink-0">
                    {{ t('wallet.activeWallet') }}
                  </span>
                </div>
                <div v-if="balance != null" class="text-[11px] text-text-muted font-mono mt-0.5">
                  {{ formatSats(balance) }} {{ t('wallet.sats') }}
                </div>
              </template>
            </div>
            <!-- Actions -->
            <div v-if="renamingId !== activeWallet.id" class="flex items-center gap-1 shrink-0">
              <button
                @click.stop="startRename(activeWallet)"
                class="p-1.5 rounded-lg hover:bg-brand/10 transition-colors"
                :title="t('wallet.renameWallet')"
              >
                <Pencil class="w-3 h-3 text-text-muted" />
              </button>
              <button
                @click.stop="requestRemove(activeWallet)"
                class="p-1.5 rounded-lg hover:bg-error/10 transition-colors"
                :title="t('wallet.removeWallet')"
              >
                <Trash2 class="w-3 h-3 text-text-muted hover:text-error" />
              </button>
            </div>
          </div>

          <!-- Other wallets -->
          <template v-if="otherWallets.length > 0">
            <button
              v-for="w in otherWallets"
              :key="w.id"
              @click="handleSwitch(w.id)"
              :disabled="switching"
              class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-surface-elevated transition-all duration-200 text-left group disabled:opacity-50"
            >
              <div class="w-9 h-9 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0 overflow-hidden">
                <Loader2 v-if="switching" class="w-4 h-4 text-text-muted animate-spin" />
                <img v-else-if="WALLET_LOGOS[w.type]"
                  :src="WALLET_LOGOS[w.type]"
                  :alt="w.type"
                  class="w-full h-full object-cover rounded-xl"
                />
                <Wallet v-else class="w-4 h-4 text-text-muted" />
              </div>
              <span class="flex-1 text-xs font-medium text-text-secondary truncate">{{ w.name }}</span>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button @click.stop="startRename(w)" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-colors">
                  <Pencil class="w-3 h-3 text-text-muted" />
                </button>
                <button @click.stop="requestRemove(w)" class="p-1.5 rounded-lg hover:bg-error/10 transition-colors">
                  <Trash2 class="w-3 h-3 text-text-muted hover:text-error" />
                </button>
              </div>
            </button>
          </template>

          <!-- Add wallet -->
          <button
            @click="handleAdd"
            class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl border border-dashed border-border hover:border-brand/30 hover:bg-brand/5 transition-all duration-200 text-left"
          >
            <div class="w-9 h-9 rounded-xl bg-surface-elevated flex items-center justify-center shrink-0">
              <Plus class="w-4 h-4 text-brand" />
            </div>
            <span class="text-xs font-semibold text-brand">{{ t('wallet.addWallet') }}</span>
          </button>
        </div>
      </template>
    </BottomSheet>

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
