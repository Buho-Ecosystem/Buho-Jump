<script setup>
/**
 * Cashu Mint configuration — options page only.
 *
 * Shows the current mint with metadata on tap.
 * Allows changing the mint with validation + warning flow.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'
import { useMessaging } from '../../composables/useMessaging.js'
import { useToast } from '../../composables/useToast.js'
import BottomSheet from '../BottomSheet.vue'
import { DEFAULT_MINT } from '../../lib/cashu-constants.js'
import { formatSats } from '../../lib/utils.js'
import { hasOriginAccess, requestOriginAccess } from '../../lib/browser/hostPermissions.js'
import {
  Globe, Loader2, AlertTriangle, Check, X,
  Info, Shield, Mail, Tag, Settings2,
} from 'lucide-vue-next'

const { t } = useI18n()
const { wallets, loadWallets, getCashuMintInfo, getCashuMintBalances } = useWallet()
const { send } = useMessaging()
const toast = useToast()

// ── State ──
const mintUrl = ref('')
const mintInfo = ref(null)
const loadingInfo = ref(false)
const showInfo = ref(false)
const mintBalances = ref([])
const mintAccessGranted = ref(true)
const showMintExplainer = ref(false)

// Change mint
const showChangeForm = ref(false)
const newMintUrl = ref('')
const validating = ref(false)
const validatedInfo = ref(null)
const validateError = ref('')
const confirmChange = ref(false)

const cashuWalletId = ref(null)
const isDefaultTestingMint = computed(() => mintUrl.value === DEFAULT_MINT)
const mintCapabilities = computed(() => {
  const nuts = mintInfo.value?.nuts || {}
  return [
    { key: 'state', ready: !!nuts['7']?.supported, label: t('cashu.capabilityState') },
    { key: 'recovery', ready: !!nuts['9']?.supported, label: t('cashu.capabilityRecovery') },
    { key: 'dleq', ready: !!nuts['12']?.supported, label: t('cashu.capabilityDleq') },
    { key: 'realtime', ready: !!nuts['17']?.supported, label: t('cashu.capabilityRealtime') },
    {
      key: 'retry',
      ready: Array.isArray(nuts['19']?.cached_endpoints) && nuts['19'].cached_endpoints.length > 0,
      label: t('cashu.capabilityRetry'),
    },
    { key: 'lockedQuote', ready: !!nuts['20']?.supported, label: t('cashu.capabilityLockedQuote') },
  ]
})

function normaliseMintUrl(raw) {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  return url
}

onMounted(async () => {
  try {
    const url = await send('GET_CASHU_MINT_URL')
    if (url) mintUrl.value = url
  } catch { /* no cashu wallet */ }

  const w = wallets.value.find(w => w.isActive && w.type === 'cashu')
  if (w) cashuWalletId.value = w.id
  if (mintUrl.value) mintAccessGranted.value = await hasOriginAccess(mintUrl.value)
  await loadMintBalances()
})

async function allowCurrentMint() {
  mintAccessGranted.value = await requestOriginAccess(mintUrl.value)
  if (!mintAccessGranted.value) toast.error(t('cashu.mintAccessDenied'))
}

async function loadMintBalances() {
  try {
    mintBalances.value = await getCashuMintBalances() || []
  } catch {
    mintBalances.value = []
  }
}

// ── Fetch mint info (tap on mint card) ──

async function fetchMintInfo() {
  const target = mintUrl.value
  if (!target) return
  loadingInfo.value = true
  try {
    const info = await getCashuMintInfo(target)
    if (info) {
      mintInfo.value = info
      showInfo.value = true
    } else {
      toast.error(t('cashu.mintInfoFailed'))
    }
  } catch {
    toast.error(t('cashu.mintInfoFailed'))
  } finally {
    loadingInfo.value = false
  }
}

function closeInfo() {
  showInfo.value = false
  loadingInfo.value = false
}

// ── Change mint flow ──

async function validateNewMint() {
  const raw = newMintUrl.value.trim()
  if (!raw) return
  const url = normaliseMintUrl(raw)
  newMintUrl.value = url
  validateError.value = ''
  validatedInfo.value = null
  validating.value = true
  try {
    if (!(await requestOriginAccess(url))) throw new Error(t('cashu.mintAccessDenied'))
    const info = await getCashuMintInfo(url)
    const missingRequired = ['7', '9', '12'].filter(nut => !info?.nuts?.[nut]?.supported)
    if (missingRequired.length > 0) {
      throw new Error(t('cashu.mintMissingRequired', { nuts: missingRequired.join(', ') }))
    }
    validatedInfo.value = info
    confirmChange.value = true
  } catch (err) {
    validateError.value = err.message || t('cashu.mintUnreachable')
  } finally {
    validating.value = false
  }
}

async function applyMintChange() {
  const url = normaliseMintUrl(newMintUrl.value)
  if (!cashuWalletId.value) {
    const w = wallets.value.find(w => w.isActive && w.type === 'cashu')
    if (w) cashuWalletId.value = w.id
  }
  if (!url || !cashuWalletId.value) return
  try {
    await send('CASHU_UPDATE_MINTS', cashuWalletId.value, [url])
    await loadWallets()
    await loadMintBalances()
    mintUrl.value = url
    mintInfo.value = validatedInfo.value
    mintAccessGranted.value = true
    showChangeForm.value = false
    confirmChange.value = false
    newMintUrl.value = ''
    validatedInfo.value = null
    toast.success(t('cashu.mintChanged'))
  } catch {
    toast.error(t('common.error'))
  }
}

function cancelChange() {
  confirmChange.value = false
  validatedInfo.value = null
}

function hostname(url) {
  try { return new URL(url).hostname } catch { return url }
}
</script>

<template>
  <div class="space-y-4">

    <!-- Section header -->
    <div>
      <h2 class="text-sm font-extrabold">{{ t('cashu.mintTitle') }}</h2>
      <p class="text-xs text-text-muted mt-0.5">{{ t('cashu.mintDesc') }}</p>
    </div>

    <!-- Mint info tooltip -->
    <div class="relative inline-flex">
      <button
        @click="showMintExplainer = !showMintExplainer"
        @keydown.esc="showMintExplainer = false"
        :aria-expanded="showMintExplainer"
        class="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-brand transition-colors duration-200"
      >
        <Info class="w-3.5 h-3.5" />
        <span class="font-medium">{{ t('cashu.whatsAMint') }}</span>
      </button>
      <!-- Tooltip -->
      <div v-if="showMintExplainer" class="absolute left-0 top-full mt-2 w-[340px] z-50 animate-scale-in">
        <div class="bg-surface-card border border-border rounded-2xl shadow-xl p-4 space-y-3">
          <p class="text-[11px] text-text-secondary leading-relaxed">
            {{ t('cashu.mintExplainerIntro') }}
          </p>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <p class="text-[10px] font-bold uppercase tracking-wider text-brand">{{ t('cashu.mintTooltipGood') }}</p>
              <ul class="space-y-1">
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-success mt-px shrink-0">&#10003;</span>
                  {{ t('cashu.mintBulletInstant') }}
                </li>
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-success mt-px shrink-0">&#10003;</span>
                  {{ t('cashu.mintBulletNoSetup') }}
                </li>
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-success mt-px shrink-0">&#10003;</span>
                  {{ t('cashu.mintBulletPrivacy') }}
                </li>
              </ul>
            </div>
            <div class="space-y-1.5">
              <p class="text-[10px] font-bold uppercase tracking-wider text-warning">{{ t('cashu.mintTooltipKnow') }}</p>
              <ul class="space-y-1">
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-warning mt-px shrink-0">!</span>
                  {{ t('cashu.mintBulletCustodial') }}
                </li>
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-warning mt-px shrink-0">!</span>
                  {{ t('cashu.mintBulletSmall') }}
                </li>
                <li class="flex items-start gap-1.5 text-[10px] text-text-secondary leading-snug">
                  <span class="text-warning mt-px shrink-0">!</span>
                  {{ t('cashu.mintBulletAdvanced') }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Current mint card — tappable for info -->
    <button
      v-if="mintUrl"
      @click="fetchMintInfo"
      class="w-full flex items-center gap-3 p-4 bg-surface-card rounded-2xl border border-border hover:border-brand/30 transition-all duration-200 text-left group"
    >
      <div class="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
        <Loader2 v-if="loadingInfo" class="w-4 h-4 text-brand animate-spin" />
        <Globe v-else class="w-4 h-4 text-brand" />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm font-semibold block truncate group-hover:text-brand transition-colors">
          {{ hostname(mintUrl) }}
        </span>
        <span class="text-[10px] text-text-muted font-mono truncate block">{{ mintUrl }}</span>
      </div>
      <Info class="w-4 h-4 text-text-muted group-hover:text-brand shrink-0 transition-colors" />
    </button>

    <div v-if="mintUrl && !mintAccessGranted" class="flex items-start gap-2.5 rounded-2xl border border-warning/25 bg-warning/8 p-3.5">
      <AlertTriangle class="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <div class="flex-1">
        <p class="text-xs font-bold text-warning">{{ t('cashu.mintAccessTitle') }}</p>
        <p class="text-[11px] text-text-secondary leading-relaxed mt-1">{{ t('cashu.mintAccessDesc', { host: hostname(mintUrl) }) }}</p>
        <button @click="allowCurrentMint" class="mt-2 px-3 py-1.5 rounded-lg bg-warning text-white text-[10px] font-bold">
          {{ t('cashu.allowMintAccess') }}
        </button>
      </div>
    </div>

    <div v-if="isDefaultTestingMint" class="flex items-start gap-2.5 rounded-2xl border border-warning/25 bg-warning/8 p-3.5">
      <AlertTriangle class="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <div>
        <p class="text-xs font-bold text-warning">{{ t('cashu.defaultMintTestingTitle') }}</p>
        <p class="text-[11px] text-text-secondary leading-relaxed mt-1">{{ t('cashu.defaultMintTestingDesc') }}</p>
      </div>
    </div>

    <div v-if="mintBalances.length" class="space-y-2">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
        {{ t('cashu.fundsByMint') }}
      </p>
      <div
        v-for="item in mintBalances"
        :key="item.mint"
        class="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-3.5 py-3"
      >
        <Globe class="w-3.5 h-3.5 text-text-muted shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-semibold truncate">{{ hostname(item.mint) }}</span>
            <span v-if="item.preferred" class="text-[8px] px-1.5 py-0.5 rounded-full bg-brand/10 text-brand font-bold">
              {{ t('cashu.preferredMint') }}
            </span>
          </div>
          <p class="text-[9px] text-text-muted font-mono truncate">{{ item.mint }}</p>
        </div>
        <span class="text-xs font-bold tabular-nums">{{ formatSats(item.balance) }} {{ t('wallet.sats') }}</span>
      </div>
    </div>

    <!-- Change mint button -->
    <button
      v-if="mintUrl && !showChangeForm"
      @click="showChangeForm = true"
      class="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-border text-xs font-semibold text-text-secondary hover:text-warning hover:border-warning/30 hover:bg-warning/5 transition-all duration-200"
    >
      <Settings2 class="w-3.5 h-3.5" />
      {{ t('cashu.changeMint') }}
    </button>

    <!-- Change mint form -->
    <div v-if="showChangeForm" class="bg-surface-card rounded-2xl border border-warning/20 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <AlertTriangle class="w-3.5 h-3.5 text-warning" />
          <span class="text-xs font-bold">{{ t('cashu.newMint') }}</span>
        </div>
        <button @click="showChangeForm = false; newMintUrl = ''; validateError = ''"
          class="p-1 rounded-lg hover:bg-surface-elevated transition-colors">
          <X class="w-3.5 h-3.5 text-text-muted" />
        </button>
      </div>

      <!-- Advanced warning -->
      <div class="text-[10px] text-warning/80 leading-relaxed">
        {{ t('cashu.changeWarningInline') }}
      </div>

      <input
        v-model="newMintUrl"
        placeholder="mint.example.com"
        class="w-full bg-surface-base border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted"
        @keydown.enter="validateNewMint"
      />

      <p v-if="validateError" class="text-[11px] text-error flex items-center gap-1.5">
        <AlertTriangle class="w-3 h-3 shrink-0" />
        {{ validateError }}
      </p>

      <button
        @click="validateNewMint"
        :disabled="!newMintUrl.trim() || validating"
        class="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-2xl bg-warning text-white hover:bg-warning/90 disabled:opacity-40 transition-all duration-200 font-semibold"
      >
        <Loader2 v-if="validating" class="w-3.5 h-3.5 animate-spin" />
        {{ validating ? t('common.validating') : t('cashu.validateMint') }}
      </button>
    </div>

    <!-- Mint info bottom sheet -->
    <BottomSheet :open="showInfo && !!mintInfo" @close="closeInfo">
      <template #title>{{ t('cashu.mintInfo') }}</template>
      <template #content>
        <div v-if="mintInfo" class="space-y-4">
          <div class="space-y-1.5">
            <h3 class="text-base font-extrabold">{{ mintInfo.name || hostname(mintUrl) }}</h3>
            <p v-if="mintInfo.description" class="text-xs text-text-muted leading-relaxed">
              {{ mintInfo.description }}
            </p>
            <p v-if="mintInfo.description_long" class="text-[11px] text-text-muted leading-relaxed">
              {{ mintInfo.description_long }}
            </p>
          </div>

          <div class="space-y-2">
            <div v-if="mintInfo.version" class="flex items-center gap-3 text-xs">
              <Tag class="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span class="text-text-muted">{{ t('cashu.version') }}</span>
              <span class="ml-auto font-mono text-text-secondary">{{ mintInfo.version }}</span>
            </div>
            <div v-if="mintInfo.contact?.length" class="flex items-start gap-3 text-xs">
              <Mail class="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
              <span class="text-text-muted">{{ t('cashu.contact') }}</span>
              <div class="ml-auto text-right">
                <div v-for="c in mintInfo.contact" :key="c.method + c.info" class="text-text-secondary text-[11px]">
                  {{ c.info }}
                </div>
              </div>
            </div>
            <div v-if="mintInfo.nuts" class="flex items-center gap-3 text-xs">
              <Shield class="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span class="text-text-muted">{{ t('cashu.supportedNuts') }}</span>
              <span class="ml-auto font-mono text-text-secondary text-[11px]">
                {{ Object.keys(mintInfo.nuts).join(', ') }}
              </span>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('cashu.safetyFeatures') }}
            </p>
            <div class="grid grid-cols-1 gap-1.5">
              <div
                v-for="capability in mintCapabilities"
                :key="capability.key"
                class="flex items-center gap-2 text-[11px] rounded-lg px-2.5 py-2"
                :class="capability.ready ? 'bg-success/8 text-text-secondary' : 'bg-warning/8 text-warning'"
              >
                <Check v-if="capability.ready" class="w-3.5 h-3.5 text-success shrink-0" />
                <AlertTriangle v-else class="w-3.5 h-3.5 shrink-0" />
                {{ capability.label }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 p-3 rounded-xl bg-surface-elevated text-[11px] font-mono text-text-muted break-all">
            <Globe class="w-3.5 h-3.5 shrink-0" />
            {{ mintUrl }}
          </div>
        </div>
      </template>
    </BottomSheet>

    <!-- Confirm change bottom sheet -->
    <BottomSheet :open="confirmChange" variant="danger" @close="cancelChange">
      <template #icon><AlertTriangle class="w-5 h-5 text-warning" /></template>
      <template #title>{{ t('cashu.confirmChangeTitle') }}</template>
      <template #description>
        <span class="block mb-2">{{ t('cashu.confirmChangeDesc') }}</span>
        <span class="block text-[11px] font-mono bg-surface-elevated px-2 py-1 rounded-lg">
          {{ hostname(mintUrl) }} &rarr; {{ hostname(newMintUrl) }}
        </span>
        <span v-if="validatedInfo?.name" class="block mt-2 text-text-secondary font-semibold">
          {{ validatedInfo.name }}
        </span>
      </template>
      <template #actions>
        <button @click="cancelChange"
          class="py-2.5 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="applyMintChange"
          class="py-2.5 text-xs rounded-2xl bg-warning text-white hover:bg-warning/90 transition-all duration-200 font-semibold">
          {{ t('cashu.confirmChange') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
