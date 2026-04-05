<script setup>
/**
 * Per-site detail view — shows permissions, budget allowance, and actions
 * for a specific connected domain. Opened from the permissions list.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../composables/usePermissions.js'
import { useMessaging } from '../composables/useMessaging.js'
import { useAllowanceSync } from '../composables/useAllowanceSync.js'
import { useFiat } from '../composables/useFiat.js'
import { useToast } from '../composables/useToast.js'
import BottomSheet from './BottomSheet.vue'
import {
  ArrowLeft, Globe, ShieldCheck, Wallet, Trash2,
  Check, X, Loader2, AlertTriangle, RotateCcw, Clock,
} from 'lucide-vue-next'

const props = defineProps({
  host: { type: String, required: true },
  methods: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['back', 'revoked'])

const { t } = useI18n()
const { revokeDomain, revokeMethod } = usePermissions()
const { send } = useMessaging()
const { getForHost, loaded: allowancesLoaded } = useAllowanceSync()
const { toFiat, loadRate } = useFiat()
const toast = useToast()

onMounted(() => loadRate())

const allowance = computed(() => getForHost(props.host))
const loadingAllowance = computed(() => !allowancesLoaded.value)
const budgetEnabled = computed(() => allowance.value?.enabled !== false)
const budgetInput = ref('')
const savingBudget = ref(false)
const togglingEnabled = ref(false)
const confirmRemoveBudget = ref(false)
const confirmRevokeAll = ref(false)
const revokingAll = ref(false)
const revokingMethod = ref(null)

function methodLabel(method) {
  const key = `sites.methodLabel_${method}`
  const translated = t(key)
  // If no translation found, fall back to the raw method name
  return translated !== key ? translated : method
}

const remaining = computed(() => {
  if (!allowance.value) return 0
  return Math.max(0, allowance.value.budget - allowance.value.spent)
})

const spentPercent = computed(() => {
  if (!allowance.value || !allowance.value.budget) return 0
  return Math.min(100, Math.round((allowance.value.spent / allowance.value.budget) * 100))
})

const budgetInputFiat = computed(() => {
  const sats = parseInt(budgetInput.value)
  if (!sats || sats <= 0) return null
  return toFiat(sats)
})

// Recent payments — newest first
const recentPayments = computed(() => {
  if (!allowance.value?.payments?.length) return []
  return [...allowance.value.payments].reverse()
})

const faviconUrl = computed(() => {
  try {
    return `https://www.google.com/s2/favicons?domain=${props.host}&sz=64`
  } catch { return '' }
})
const faviconFailed = ref(false)

onMounted(() => {
  if (allowance.value) budgetInput.value = String(allowance.value.budget)
})

async function saveBudget() {
  const amount = parseInt(budgetInput.value)
  if (!amount || amount <= 0) return
  savingBudget.value = true
  try {
    await send('SET_ALLOWANCE', props.host, amount)
    toast.success(t('sites.budgetSaved'))
  } catch {
    toast.error(t('sites.budgetFailed'))
  } finally {
    savingBudget.value = false
  }
}

async function removeBudget() {
  savingBudget.value = true
  try {
    await send('REMOVE_ALLOWANCE', props.host)
    budgetInput.value = ''
    confirmRemoveBudget.value = false
    toast.info(t('sites.budgetRemoved'))
  } catch {
    toast.error(t('sites.budgetFailed'))
  } finally {
    savingBudget.value = false
  }
}

function formatPaymentTime(ts) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return t('chat.justNow')
  if (diff < 3600) return t('chat.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('chat.hoursAgo', { n: Math.floor(diff / 3600) })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function toggleEnabled() {
  togglingEnabled.value = true
  try {
    await send('TOGGLE_ALLOWANCE', props.host, !budgetEnabled.value)
  } catch {
    toast.error(t('common.error'))
  } finally {
    togglingEnabled.value = false
  }
}

async function resetSpend() {
  savingBudget.value = true
  try {
    await send('RESET_ALLOWANCE', props.host)
    toast.success(t('sites.spendReset'))
  } catch {
    toast.error(t('common.error'))
  } finally {
    savingBudget.value = false
  }
}

async function handleRevokeMethod(method) {
  revokingMethod.value = method
  try {
    await revokeMethod(props.host, method)
  } finally {
    revokingMethod.value = null
  }
}

async function handleRevokeAll() {
  revokingAll.value = true
  try {
    await revokeDomain(props.host)
    await send('REMOVE_ALLOWANCE', props.host)
    emit('revoked')
  } finally {
    revokingAll.value = false
    confirmRevokeAll.value = false
  }
}
</script>

<template>
  <div class="space-y-4 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2">
      <button @click="emit('back')" :aria-label="t('common.back')" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('sites.title') }}</span>
    </div>

    <!-- Site identity -->
    <div class="flex items-center gap-3 px-3 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
      <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
        <img v-if="!faviconFailed" :src="faviconUrl" @error="faviconFailed = true" class="w-5 h-5" alt="" />
        <Globe v-else class="w-4 h-4 text-text-muted" />
      </div>
      <div>
        <div class="text-sm font-extrabold">{{ host }}</div>
        <div class="text-[10px] text-text-muted">{{ Object.keys(methods).length }} {{ t('sites.permissionsGranted') }}</div>
      </div>
    </div>

    <!-- Permissions list (only if any exist) -->
    <div v-if="Object.keys(methods).length" class="space-y-1.5">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('sites.permissions') }}</p>
      <div v-for="(entry, method) in methods" :key="method"
        class="flex items-center justify-between px-3 py-2 bg-surface-card rounded-2xl border border-border">
        <div class="flex items-center gap-2">
          <span class="text-[9px] px-1.5 py-px rounded-full font-medium"
            :class="entry.decision === 'allow' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
            {{ entry.decision === 'allow' ? t('sites.allowed') : t('sites.denied') }}
          </span>
          <span class="text-xs font-medium">{{ methodLabel(method) }}</span>
        </div>
        <button @click="handleRevokeMethod(method)"
          :disabled="revokingMethod === method"
          class="text-[10px] text-text-muted hover:text-error transition-all duration-200 font-medium flex items-center gap-1">
          <Loader2 v-if="revokingMethod === method" class="w-2.5 h-2.5 animate-spin" />
          <X v-else class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Budget allowance -->
    <div class="space-y-2">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('sites.budget') }}</p>

      <div v-if="loadingAllowance" class="skeleton-shimmer h-20 rounded-3xl" />

      <div v-else class="bg-surface-card rounded-3xl border border-border shadow-sm p-3 space-y-2.5">

        <!-- Has budget — compact status view -->
        <template v-if="allowance">
          <!-- Toggle -->
          <button @click="toggleEnabled" :disabled="togglingEnabled"
            class="w-full flex items-center justify-between px-2 py-1.5 rounded-xl transition-all duration-200"
            :class="budgetEnabled ? 'bg-success/8 hover:bg-success/12' : 'bg-surface-elevated hover:bg-surface-hover'">
            <span class="text-[10px] font-semibold" :class="budgetEnabled ? 'text-success' : 'text-text-muted'">
              {{ budgetEnabled ? t('sites.budgetEnabled') : t('sites.budgetPaused') }}
            </span>
            <div class="w-7 h-4 rounded-full transition-all duration-200 relative"
              :class="budgetEnabled ? 'bg-success' : 'bg-border'">
              <div class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200"
                :class="budgetEnabled ? 'left-3.5' : 'left-0.5'" />
            </div>
          </button>

          <!-- Progress -->
          <div class="space-y-1" :class="!budgetEnabled && 'opacity-40'">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-text-muted font-medium">{{ t('sites.spent') }}</span>
              <div class="text-right">
                <span class="font-semibold">{{ allowance.spent.toLocaleString() }} / {{ allowance.budget.toLocaleString() }} {{ t('wallet.sats') }}</span>
                <span v-if="allowance.spent > 0 && toFiat(allowance.spent)" class="text-[9px] text-text-muted ml-1">({{ toFiat(allowance.spent) }})</span>
              </div>
            </div>
            <div class="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500"
                :class="spentPercent > 90 ? 'bg-error' : spentPercent > 70 ? 'bg-warning' : 'bg-brand'"
                :style="{ width: spentPercent + '%' }" />
            </div>
            <div class="flex items-center justify-between text-[9px] text-text-muted">
              <span>{{ remaining.toLocaleString() }} {{ t('sites.remaining') }}</span>
              <button v-if="allowance.spent > 0" @click="resetSpend" :disabled="savingBudget"
                class="flex items-center gap-0.5 hover:text-brand transition-all duration-200 disabled:opacity-40">
                <RotateCcw class="w-2.5 h-2.5" /> {{ t('sites.resetSpend') }}
              </button>
            </div>
          </div>

          <!-- Edit budget -->
          <div class="space-y-1 pt-1 border-t border-border/50">
            <div class="flex gap-2">
              <input v-model="budgetInput" type="number" min="1"
                :placeholder="t('sites.budgetPlaceholder')"
                class="flex-1 bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted" />
              <button @click="saveBudget" :disabled="savingBudget || !budgetInput"
                class="px-3 py-1.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all duration-200 flex items-center gap-1">
                <Loader2 v-if="savingBudget" class="w-3 h-3 animate-spin" />
                {{ t('common.save') }}
              </button>
            </div>
            <div class="flex items-center justify-between px-0.5">
              <p v-if="budgetInputFiat" class="text-[9px] text-text-muted tabular-nums">≈ {{ budgetInputFiat }}</p>
              <span v-else />
              <button @click="confirmRemoveBudget = true" :disabled="savingBudget"
                class="text-[9px] text-text-muted hover:text-error transition-all duration-200 font-medium">
                {{ t('sites.removeBudget') }}
              </button>
            </div>
          </div>
        </template>

        <!-- No budget yet — explainer + set -->
        <template v-else>
          <p class="text-[10px] text-text-muted leading-relaxed">{{ t('sites.budgetExplainer') }}</p>
          <div class="space-y-1">
            <div class="flex gap-2">
              <input v-model="budgetInput" type="number" min="1"
                :placeholder="t('sites.budgetPlaceholder')"
                class="flex-1 bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted" />
              <button @click="saveBudget" :disabled="savingBudget || !budgetInput"
                class="px-3 py-1.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all duration-200 flex items-center gap-1">
                <Loader2 v-if="savingBudget" class="w-3 h-3 animate-spin" />
                {{ t('common.save') }}
              </button>
            </div>
            <p v-if="budgetInputFiat" class="text-[9px] text-text-muted px-0.5 tabular-nums">≈ {{ budgetInputFiat }}</p>
          </div>
        </template>
      </div>
    </div>

    <!-- Recent auto-approved payments -->
    <div v-if="recentPayments.length" class="space-y-1.5">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('sites.recentPayments') }}</p>
      <div class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden divide-y divide-border">
        <div v-for="(p, i) in recentPayments" :key="i"
          class="flex items-center justify-between px-3 py-2">
          <div class="flex items-center gap-2 min-w-0">
            <Wallet class="w-3 h-3 text-warning shrink-0" />
            <div class="min-w-0">
              <span class="text-xs font-medium">{{ p.amount.toLocaleString() }} sats</span>
              <span v-if="toFiat(p.amount)" class="text-[9px] text-text-muted ml-1">({{ toFiat(p.amount) }})</span>
            </div>
          </div>
          <div class="flex items-center gap-1 text-[9px] text-text-muted shrink-0">
            <Clock class="w-2.5 h-2.5" />
            <span>{{ formatPaymentTime(p.timestamp) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Revoke all (only if there's something to revoke) -->
    <button v-if="Object.keys(methods).length || allowance" @click="confirmRevokeAll = true"
      class="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-text-muted hover:text-error transition-all duration-200">
      <Trash2 class="w-3 h-3" />
      {{ t('sites.revokeAll') }}
    </button>

    <!-- Remove budget confirmation -->
    <BottomSheet :open="confirmRemoveBudget" variant="danger" @close="confirmRemoveBudget = false">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #description>{{ t('sites.removeBudgetConfirm', { host }) }}</template>
      <template #actions>
        <button @click="confirmRemoveBudget = false"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="removeBudget" :disabled="savingBudget"
          class="py-2 text-xs rounded-2xl bg-warning text-surface-base hover:bg-warning/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="savingBudget" class="w-3 h-3 animate-spin" />
          {{ t('sites.removeBudget') }}
        </button>
      </template>
    </BottomSheet>

    <!-- Revoke all confirmation (bottom sheet) -->
    <BottomSheet :open="confirmRevokeAll" variant="danger" @close="confirmRevokeAll = false">
      <template #icon><AlertTriangle class="w-4 h-4 text-error" /></template>
      <template #description>{{ t('sites.revokeAllConfirm', { host }) }}</template>
      <template #actions>
        <button @click="confirmRevokeAll = false"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleRevokeAll" :disabled="revokingAll"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="revokingAll" class="w-3 h-3 animate-spin" />
          {{ t('sites.revokeAll') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
