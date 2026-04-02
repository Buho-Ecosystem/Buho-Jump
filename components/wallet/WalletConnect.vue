<script setup>
/**
 * Wallet connection screen — type picker (NWC / LNbits) with type-specific forms.
 * Clean separation: each wallet type has its own form, all share the name input.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useToast } from '../../composables/useToast.js'
import QrScanner from '../QrScanner.vue'
import {
  Link, ScanLine, Loader2, ArrowLeft, Server, Eye, EyeOff,
} from 'lucide-vue-next'

const emit = defineEmits(['back'])
const { t } = useI18n()
const { connect, connectLnbits, connecting, wallets } = useWallet()
const toast = useToast()

// ── Shared state ──
const walletType = ref(null) // null | 'nwc' | 'lnbits'
const walletName = ref('')
const error = ref('')
const hasExistingWallets = wallets.value.length > 0

// ── NWC state ──
const nwcUri = ref('')
const showScanner = ref(false)

// ── LNbits state ──
const lnbitsUrl = ref('')
const lnbitsKey = ref('')
const showKey = ref(false)

function selectType(type) {
  walletType.value = type
  error.value = ''
}

function goBack() {
  if (walletType.value) {
    walletType.value = null
    error.value = ''
  } else {
    emit('back')
  }
}

// ── NWC connect ──
async function handleConnectNwc() {
  if (!nwcUri.value.trim()) return
  error.value = ''
  try {
    await connect(nwcUri.value.trim(), walletName.value.trim() || undefined)
    toast.success(t('wallet.walletConnected'))
    emit('back')
  } catch (err) {
    error.value = err.message || t('wallet.connectFailedDetail')
    toast.error(error.value)
  }
}

// ── LNbits connect ──
function normaliseLnbitsUrl(raw) {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  return url
}

async function handleConnectLnbits() {
  if (!lnbitsUrl.value.trim() || !lnbitsKey.value.trim()) return
  error.value = ''
  try {
    await connectLnbits(
      normaliseLnbitsUrl(lnbitsUrl.value),
      lnbitsKey.value.trim(),
      walletName.value.trim() || undefined,
    )
    toast.success(t('wallet.walletConnected'))
    emit('back')
  } catch (err) {
    error.value = err.message || t('wallet.connectFailedDetail')
    toast.error(error.value)
  }
}

function onScan(val) {
  nwcUri.value = val
  showScanner.value = false
}
</script>

<template>
  <div class="space-y-4 animate-fade-in-up">

    <!-- Back button -->
    <button
      v-if="hasExistingWallets || walletType"
      @click="goBack"
      class="flex items-center gap-1 text-xs text-text-muted hover:text-brand transition-colors"
    >
      <ArrowLeft class="w-3.5 h-3.5" />
      {{ t('common.back') }}
    </button>

    <!-- ═══════════════════════════════════════════ -->
    <!-- Type picker                                -->
    <!-- ═══════════════════════════════════════════ -->
    <template v-if="!walletType">
      <div class="text-center py-2">
        <p class="text-sm font-extrabold">
          {{ hasExistingWallets ? t('wallet.addWallet') : t('wallet.connectWallet') }}
        </p>
        <p class="text-xs text-text-muted mt-1">{{ t('wallet.chooseType') }}</p>
      </div>

      <div class="space-y-2">
        <!-- NWC option -->
        <button
          @click="selectType('nwc')"
          class="w-full flex items-center gap-4 p-4 rounded-2xl bg-surface-card border border-border hover:border-brand/30 transition-all duration-200 text-left group"
        >
          <img src="/nwc/nwc-logo.svg" alt="NWC" class="w-11 h-11 rounded-xl shrink-0" />
          <div class="flex-1 min-w-0">
            <span class="text-sm font-bold block group-hover:text-brand transition-colors">Nostr Wallet Connect</span>
            <span class="text-[10px] text-text-muted leading-relaxed">{{ t('wallet.nwcDesc') }}</span>
          </div>
        </button>

        <!-- LNbits option -->
        <button
          @click="selectType('lnbits')"
          class="w-full flex items-center gap-4 p-4 rounded-2xl bg-surface-card border border-border hover:border-brand/30 transition-all duration-200 text-left group"
        >
          <img src="/lnbits/lnbits.svg" alt="LNbits" class="w-11 h-11 rounded-xl shrink-0" />
          <div class="flex-1 min-w-0">
            <span class="text-sm font-bold block group-hover:text-brand transition-colors">LNbits</span>
            <span class="text-[10px] text-text-muted leading-relaxed">{{ t('wallet.lnbitsDesc') }}</span>
          </div>
        </button>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════ -->
    <!-- NWC Form                                   -->
    <!-- ═══════════════════════════════════════════ -->
    <template v-else-if="walletType === 'nwc'">
      <div class="flex flex-col items-center gap-3 py-2">
        <img src="/nwc/nwc-logo.svg" alt="NWC" class="w-14 h-14" />
        <div class="text-center">
          <p class="text-sm font-extrabold">Nostr Wallet Connect</p>
          <p class="text-[10px] text-text-muted mt-1">{{ t('wallet.nwcHelp') }}</p>
        </div>
      </div>

      <!-- Wallet name -->
      <input
        v-model="walletName"
        :placeholder="t('wallet.walletName')"
        class="w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-all duration-200 placeholder:text-text-muted"
      />

      <!-- QR scanner overlay -->
      <QrScanner v-if="showScanner" @scan="onScan" @close="showScanner = false" />

      <!-- NWC URI input -->
      <div v-else class="space-y-1.5">
        <div class="relative">
          <input
            v-model="nwcUri"
            placeholder="nostr+walletconnect://..."
            class="w-full bg-surface-card border border-border rounded-xl pl-3.5 pr-10 py-2.5 text-sm outline-none focus:border-brand transition-all duration-200 font-mono placeholder:text-text-muted"
          />
          <button
            type="button"
            @click="showScanner = true"
            :title="t('common.scanQr')"
            class="absolute top-1/2 -translate-y-1/2 right-2.5 p-1 rounded-md text-text-muted hover:text-brand hover:bg-brand/10 transition-all duration-150"
          >
            <ScanLine class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Error -->
      <p v-if="error" class="text-[11px] text-error px-1">{{ error }}</p>

      <button
        @click="handleConnectNwc"
        :disabled="!nwcUri.trim() || connecting"
        class="w-full flex items-center justify-center gap-1.5 py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-bold btn-primary"
      >
        <Loader2 v-if="connecting" class="w-4 h-4 animate-spin" />
        <Link v-else class="w-4 h-4" />
        {{ connecting ? t('wallet.connecting') : t('wallet.connectWallet') }}
      </button>
    </template>

    <!-- ═══════════════════════════════════════════ -->
    <!-- LNbits Form                                -->
    <!-- ═══════════════════════════════════════════ -->
    <template v-else-if="walletType === 'lnbits'">
      <div class="flex flex-col items-center gap-3 py-2">
        <img src="/lnbits/lnbits.svg" alt="LNbits" class="w-14 h-14 rounded-2xl" />
        <div class="text-center">
          <p class="text-sm font-extrabold">LNbits</p>
          <p class="text-[10px] text-text-muted mt-1">{{ t('wallet.lnbitsHelp') }}</p>
        </div>
      </div>

      <!-- Wallet name -->
      <input
        v-model="walletName"
        :placeholder="t('wallet.walletName')"
        class="w-full bg-surface-card border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-all duration-200 placeholder:text-text-muted"
      />

      <!-- LNbits URL -->
      <div class="space-y-1">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">
          {{ t('wallet.lnbitsUrl') }}
        </label>
        <div class="relative">
          <input
            v-model="lnbitsUrl"
            placeholder="https://your-lnbits.com"
            class="w-full bg-surface-card border border-border rounded-xl pl-3.5 pr-10 py-2.5 text-sm outline-none focus:border-brand transition-all duration-200 font-mono placeholder:text-text-muted"
          />
          <Server class="absolute top-1/2 -translate-y-1/2 right-3 w-4 h-4 text-text-muted/40 pointer-events-none" />
        </div>
      </div>

      <!-- Admin Key -->
      <div class="space-y-1">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">
          {{ t('wallet.lnbitsAdminKey') }}
        </label>
        <div class="relative">
          <input
            v-model="lnbitsKey"
            :type="showKey ? 'text' : 'password'"
            placeholder="admin key"
            class="w-full bg-surface-card border border-border rounded-xl pl-3.5 pr-10 py-2.5 text-sm outline-none focus:border-brand transition-all duration-200 font-mono placeholder:text-text-muted"
          />
          <button
            type="button"
            @click="showKey = !showKey"
            class="absolute top-1/2 -translate-y-1/2 right-2.5 p-1 text-text-muted hover:text-text-secondary transition-all duration-200"
            tabindex="-1"
          >
            <EyeOff v-if="showKey" class="w-3.5 h-3.5" />
            <Eye v-else class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Error -->
      <p v-if="error" class="text-[11px] text-error px-1">{{ error }}</p>

      <button
        @click="handleConnectLnbits"
        :disabled="!lnbitsUrl.trim() || !lnbitsKey.trim() || connecting"
        class="w-full flex items-center justify-center gap-1.5 py-3 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-bold btn-primary"
      >
        <Loader2 v-if="connecting" class="w-4 h-4 animate-spin" />
        <Link v-else class="w-4 h-4" />
        {{ connecting ? t('wallet.connecting') : t('wallet.connectWallet') }}
      </button>
    </template>
  </div>
</template>
