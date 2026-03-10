<script setup>
/**
 * Per-site detail view — shows permissions, budget allowance, and actions
 * for a specific connected domain. Opened from the permissions list.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../composables/usePermissions.js'
import { useMessaging } from '../composables/useMessaging.js'
import { useToast } from '../composables/useToast.js'
import BottomSheet from './BottomSheet.vue'
import {
  ArrowLeft, Globe, ShieldCheck, Zap, Trash2,
  Check, X, Loader2, AlertTriangle, RotateCcw,
} from 'lucide-vue-next'

const props = defineProps({
  host: { type: String, required: true },
  methods: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['back', 'revoked'])

const { t } = useI18n()
const { revokeDomain, revokeMethod } = usePermissions()
const { send } = useMessaging()
const toast = useToast()

const allowance = ref(null)
const loadingAllowance = ref(true)
const budgetInput = ref('')
const savingBudget = ref(false)
const confirmRevokeAll = ref(false)
const revokingAll = ref(false)
const revokingMethod = ref(null)

const remaining = computed(() => {
  if (!allowance.value) return 0
  return Math.max(0, allowance.value.budget - allowance.value.spent)
})

const spentPercent = computed(() => {
  if (!allowance.value || !allowance.value.budget) return 0
  return Math.min(100, Math.round((allowance.value.spent / allowance.value.budget) * 100))
})

const faviconUrl = computed(() => {
  try {
    return `https://${props.host}/favicon.ico`
  } catch { return '' }
})
const faviconFailed = ref(false)

onMounted(async () => {
  try {
    const result = await send('GET_ALLOWANCE', props.host)
    allowance.value = result
    if (result) budgetInput.value = String(result.budget)
  } catch {}
  loadingAllowance.value = false
})

async function saveBudget() {
  const amount = parseInt(budgetInput.value)
  if (!amount || amount <= 0) return
  savingBudget.value = true
  try {
    await send('SET_ALLOWANCE', props.host, amount)
    allowance.value = await send('GET_ALLOWANCE', props.host)
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
    allowance.value = null
    budgetInput.value = ''
    toast.info(t('sites.budgetRemoved'))
  } catch {
    toast.error(t('sites.budgetFailed'))
  } finally {
    savingBudget.value = false
  }
}

async function resetSpend() {
  savingBudget.value = true
  try {
    await send('RESET_ALLOWANCE', props.host)
    allowance.value = await send('GET_ALLOWANCE', props.host)
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
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-colors">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('sites.title') }}</span>
    </div>

    <!-- Site identity -->
    <div class="flex items-center gap-3 px-3 py-3 bg-surface-card rounded-xl border border-border">
      <div class="w-9 h-9 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
        <img v-if="!faviconFailed" :src="faviconUrl" @error="faviconFailed = true" class="w-5 h-5" alt="" />
        <Globe v-else class="w-4 h-4 text-text-muted" />
      </div>
      <div>
        <div class="text-sm font-bold">{{ host }}</div>
        <div class="text-[10px] text-text-muted">{{ Object.keys(methods).length }} {{ t('sites.permissionsGranted') }}</div>
      </div>
    </div>

    <!-- Permissions list -->
    <div class="space-y-1.5">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('sites.permissions') }}</p>
      <div v-for="(entry, method) in methods" :key="method"
        class="flex items-center justify-between px-3 py-2 bg-surface-card rounded-lg border border-border">
        <div class="flex items-center gap-2">
          <span class="text-[9px] px-1.5 py-px rounded-full font-medium"
            :class="entry.decision === 'allow' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
            {{ entry.decision === 'allow' ? t('sites.allowed') : t('sites.denied') }}
          </span>
          <span class="text-xs font-medium">{{ method }}</span>
        </div>
        <button @click="handleRevokeMethod(method)"
          :disabled="revokingMethod === method"
          class="text-[10px] text-text-muted hover:text-error transition-colors font-medium flex items-center gap-1">
          <Loader2 v-if="revokingMethod === method" class="w-2.5 h-2.5 animate-spin" />
          <X v-else class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Budget allowance -->
    <div class="space-y-2">
      <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('sites.budget') }}</p>

      <div v-if="loadingAllowance" class="skeleton-shimmer h-20 rounded-xl" />

      <div v-else class="bg-surface-card rounded-xl border border-border p-3 space-y-3">
        <!-- Progress bar (if budget exists) -->
        <div v-if="allowance" class="space-y-1.5">
          <div class="flex items-center justify-between text-[10px]">
            <span class="text-text-muted font-medium">{{ t('sites.spent') }}</span>
            <span class="font-semibold">{{ allowance.spent.toLocaleString() }} / {{ allowance.budget.toLocaleString() }} {{ t('wallet.sats') }}</span>
          </div>
          <div class="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500"
              :class="spentPercent > 90 ? 'bg-error' : spentPercent > 70 ? 'bg-warning' : 'bg-brand'"
              :style="{ width: spentPercent + '%' }" />
          </div>
          <div class="flex items-center justify-between text-[9px] text-text-muted">
            <span>{{ remaining.toLocaleString() }} {{ t('sites.remaining') }}</span>
            <button @click="resetSpend" :disabled="savingBudget || !allowance.spent"
              class="flex items-center gap-0.5 hover:text-brand transition-colors disabled:opacity-40">
              <RotateCcw class="w-2.5 h-2.5" /> {{ t('sites.resetSpend') }}
            </button>
          </div>
        </div>

        <!-- Budget input -->
        <div class="flex gap-2">
          <input v-model="budgetInput" type="number" min="1"
            :placeholder="t('sites.budgetPlaceholder')"
            class="flex-1 bg-surface-base border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-brand transition-colors tabular-nums placeholder:text-text-muted" />
          <button @click="saveBudget" :disabled="savingBudget || !budgetInput"
            class="px-3 py-1.5 text-xs rounded-lg bg-brand text-surface-base font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors flex items-center gap-1">
            <Loader2 v-if="savingBudget" class="w-3 h-3 animate-spin" />
            {{ t('common.save') }}
          </button>
        </div>

        <!-- Remove budget -->
        <button v-if="allowance" @click="removeBudget" :disabled="savingBudget"
          class="text-[10px] text-text-muted hover:text-error transition-colors font-medium">
          {{ t('sites.removeBudget') }}
        </button>
      </div>
    </div>

    <!-- Revoke all -->
    <button @click="confirmRevokeAll = true"
      class="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-text-muted hover:text-error transition-colors">
      <Trash2 class="w-3 h-3" />
      {{ t('sites.revokeAll') }}
    </button>

    <!-- Revoke all confirmation (bottom sheet) -->
    <BottomSheet :open="confirmRevokeAll" variant="danger" @close="confirmRevokeAll = false">
      <template #icon><AlertTriangle class="w-4 h-4 text-error" /></template>
      <template #description>{{ t('sites.revokeAllConfirm', { host }) }}</template>
      <template #actions>
        <button @click="confirmRevokeAll = false"
          class="py-2 text-xs rounded-lg bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleRevokeAll" :disabled="revokingAll"
          class="py-2 text-xs rounded-lg bg-error text-white hover:bg-error/90 transition-colors font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="revokingAll" class="w-3 h-3 animate-spin" />
          {{ t('sites.revokeAll') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
