<script setup>
/**
 * Site-aware budget bar — shown at the top of the wallet tab.
 * Queries the active browser tab, displays the site's spending limit status.
 * Fully reactive via useAllowanceSync (live updates on payment auto-approve).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessaging } from '../composables/useMessaging.js'
import { useAllowanceSync } from '../composables/useAllowanceSync.js'
import { formatSats } from '../lib/utils.js'
import { Globe, ChevronRight } from 'lucide-vue-next'

const emit = defineEmits(['navigate-site'])
const { t } = useI18n()
const { send } = useMessaging()
const { getForHost, loaded } = useAllowanceSync()

const tabHost = ref('')
const tabFavicon = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const info = await send('GET_ACTIVE_TAB_INFO')
    if (info?.host) {
      tabHost.value = info.host
      tabFavicon.value = info.favIconUrl || ''
    }
  } catch { /* not on a web page */ }
  loading.value = false
})

const allowance = computed(() => getForHost(tabHost.value))
const hasBudget = computed(() => !!allowance.value?.budget)
const budgetPaused = computed(() => allowance.value?.enabled === false)

const remaining = computed(() => {
  if (!allowance.value) return 0
  return Math.max(0, allowance.value.budget - allowance.value.spent)
})

const spentPercent = computed(() => {
  if (!allowance.value?.budget) return 0
  return Math.min(100, Math.round((allowance.value.spent / allowance.value.budget) * 100))
})

const statusColor = computed(() => {
  if (spentPercent.value >= 90) return 'error'
  if (spentPercent.value >= 70) return 'warning'
  return 'success'
})

const barColorClass = computed(() => ({
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
}[statusColor.value]))

const faviconFailed = ref(false)
const visible = computed(() => !!tabHost.value && loaded.value)

function navigateToSite() {
  emit('navigate-site', tabHost.value)
}
</script>

<template>
  <!-- Loading shimmer -->
  <div v-if="loading" class="skeleton-shimmer h-10 rounded-2xl" />

  <!-- Not on a web page — hidden -->
  <template v-else-if="visible">

    <!-- Has budget — show progress -->
    <button
      v-if="hasBudget"
      @click="navigateToSite"
      class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-surface-card border transition-all duration-200 text-left group"
      :class="budgetPaused ? 'border-border opacity-60' : statusColor === 'error' ? 'border-error/20 bg-error/3' : statusColor === 'warning' ? 'border-warning/20' : 'border-border hover:border-brand/20'"
    >
      <!-- Favicon -->
      <div class="w-5 h-5 rounded shrink-0 overflow-hidden flex items-center justify-center bg-surface-elevated">
        <img v-if="tabFavicon && !faviconFailed" :src="tabFavicon" class="w-full h-full object-contain" @error="faviconFailed = true" />
        <Globe v-else class="w-3 h-3 text-text-muted" />
      </div>

      <!-- Domain + status text -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-medium text-text-secondary truncate">{{ tabHost }}</span>
          <span v-if="budgetPaused" class="text-[9px] font-semibold text-text-muted">
            {{ t('sites.budgetPaused') }}
          </span>
          <span v-else-if="spentPercent >= 90" class="text-[9px] font-semibold" :class="statusColor === 'error' ? 'text-error' : 'text-warning'">
            {{ spentPercent >= 100 ? t('sites.budgetBar.exhausted') : t('sites.budgetBar.almostOut') }}
          </span>
        </div>
      </div>

      <!-- Progress bar + numbers -->
      <div class="flex items-center gap-2 shrink-0">
        <div class="w-10 h-1 bg-surface-elevated rounded-full overflow-hidden">
          <div v-if="!budgetPaused" class="h-full rounded-full transition-all duration-500" :class="barColorClass" :style="{ width: spentPercent + '%' }" />
        </div>
        <span class="text-[10px] font-mono text-text-muted tabular-nums whitespace-nowrap">
          {{ formatSats(allowance.spent) }}<span class="opacity-40">/</span>{{ formatSats(allowance.budget) }}
        </span>
      </div>

      <ChevronRight class="w-3 h-3 text-text-muted/40 shrink-0 group-hover:text-brand transition-colors" />
    </button>

    <!-- No budget — subtle invite -->
    <button
      v-else
      @click="navigateToSite"
      class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl border border-dashed border-border/60 text-left hover:border-brand/20 hover:bg-brand/3 transition-all duration-200 group"
    >
      <div class="w-5 h-5 rounded shrink-0 overflow-hidden flex items-center justify-center bg-surface-elevated">
        <img v-if="tabFavicon && !faviconFailed" :src="tabFavicon" class="w-full h-full object-contain" @error="faviconFailed = true" />
        <Globe v-else class="w-3 h-3 text-text-muted" />
      </div>
      <span class="text-[11px] text-text-muted truncate flex-1">{{ tabHost }}</span>
      <span class="text-[10px] text-text-muted/60 group-hover:text-brand transition-colors font-medium shrink-0">
        {{ t('sites.budgetBar.setLimit') }}
      </span>
      <ChevronRight class="w-3 h-3 text-text-muted/30 shrink-0 group-hover:text-brand transition-colors" />
    </button>
  </template>
</template>
