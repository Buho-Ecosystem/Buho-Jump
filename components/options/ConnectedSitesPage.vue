<script setup>
/**
 * Connected Sites page — full-width table of domains with permissions and budgets.
 * Wraps existing SiteDetail for per-site drill-down.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../../composables/usePermissions.js'
import { useAllowanceSync } from '../../composables/useAllowanceSync.js'
import { formatSats } from '../../lib/utils.js'
import SiteDetail from '../SiteDetail.vue'
import { ChevronRight, Search } from 'lucide-vue-next'

const { t } = useI18n()
const { policies, sessionGrants, load } = usePermissions()
const { getForHost } = useAllowanceSync()

const selectedSite = ref(null)
const search = ref('')
const loading = ref(true)

onMounted(async () => {
  await load()
  loading.value = false
})

const filteredSites = computed(() => {
  const origins = new Set([
    ...Object.keys(policies.value),
    ...sessionGrants.value.map(grant => grant.origin).filter(Boolean),
  ])
  let entries = [...origins].map(origin => [origin, policies.value[origin] || {}])
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    entries = entries.filter(([host]) => host.toLowerCase().includes(q))
  }
  // Sort: sites with recent budget activity first, then alphabetical
  return entries.sort(([a], [b]) => {
    const aa = getForHost(a)
    const bb = getForHost(b)
    const ta = aa?.updated_at || 0
    const tb = bb?.updated_at || 0
    if (ta !== tb) return tb - ta // most recent first
    return a.localeCompare(b)
  })
})

function methodCount(methods) {
  return Object.keys(methods).length
}

function allowedCount(methods) {
  return Object.values(methods).filter(m => m.decision === 'allow').length
}

function grantsFor(origin) {
  return sessionGrants.value.filter(grant => grant.origin === origin)
}

function siteInitial(origin) {
  try { return new URL(origin).hostname.charAt(0).toUpperCase() || '?' } catch { return '?' }
}

function siteColor(origin) {
  let hash = 0
  for (const character of origin) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`
}

function budgetInfo(host) {
  const a = getForHost(host)
  if (!a) return null
  if (a.enabled === false) return { label: `${a.budget.toLocaleString()} sats`, color: 'bg-surface-elevated text-text-muted', paused: true }
  const ratio = a.spent / a.budget
  const color = ratio > 0.9 ? 'bg-error/10 text-error' : ratio > 0.7 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
  return { label: `${formatSats(a.spent)} / ${formatSats(a.budget)} sats`, color, paused: false }
}

function onRevoked() {
  selectedSite.value = null
  load()
}

async function onChanged() {
  await load()
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div>
      <h1 class="text-lg font-extrabold">{{ t('options.sites') }}</h1>
      <p class="text-xs text-text-muted mt-0.5">{{ t('options.sitesDesc') }}</p>
    </div>

    <!-- Site detail drill-down -->
    <SiteDetail
      v-if="selectedSite"
      :host="selectedSite"
      :methods="policies[selectedSite] || {}"
      :session-grants="grantsFor(selectedSite)"
      @back="selectedSite = null"
      @revoked="onRevoked"
      @changed="onChanged"
    />

    <!-- Loading -->
    <div v-else-if="loading" class="space-y-1.5">
      <div class="skeleton-shimmer h-16 rounded-3xl" />
      <div class="skeleton-shimmer h-16 rounded-3xl" />
      <div class="skeleton-shimmer h-16 rounded-3xl" />
    </div>

    <!-- Sites list -->
    <template v-else>
      <!-- Search -->
      <div v-if="filteredSites.length > 3 || search" class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <input
          v-model="search"
          :placeholder="t('options.searchSites')"
          class="w-full pl-9 pr-3 py-2 bg-surface-card border border-border rounded-3xl text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
        />
      </div>

      <!-- Table -->
      <div v-if="filteredSites.length > 0" class="space-y-1.5">
        <button
          v-for="[host, methods] in filteredSites"
          :key="host"
          @click="selectedSite = host"
          class="w-full flex items-center gap-4 px-4 py-3.5 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 group text-left"
        >
          <!-- Local site mark: never leaks the connected-site list to a favicon service. -->
          <div class="w-10 h-10 rounded-[10px] border border-border flex items-center justify-center shrink-0 text-white font-extrabold"
            :style="{ backgroundColor: siteColor(host) }">
            {{ siteInitial(host) }}
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate">{{ host }}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-text-muted">
                {{ allowedCount(methods) }} {{ t('options.allowed') }}, {{ methodCount(methods) - allowedCount(methods) }} {{ t('options.denied') }}
              </span>
              <span v-if="grantsFor(host).length" class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-brand/10 text-brand">
                {{ grantsFor(host).length }} {{ t('sites.thisVisit') }}
              </span>
              <span v-if="budgetInfo(host)" class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                :class="budgetInfo(host).color">
                {{ budgetInfo(host).paused ? t('sites.budgetPaused') : budgetInfo(host).label }}
              </span>
            </div>
          </div>

          <!-- Arrow -->
          <ChevronRight class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200 shrink-0" />
        </button>
      </div>

      <!-- Empty state -->
      <div v-else class="bg-surface-card rounded-3xl border border-border shadow-sm p-10 text-center">
        <img src="/Onboarding%20wizard/storyset-software-integration-bro.svg" alt="" class="w-44 h-32 object-contain mx-auto -mt-4 mb-1" />
        <p class="text-sm font-medium text-text-secondary">{{ t('account.noSites') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('options.noSitesHint') }}</p>
      </div>
    </template>
  </div>
</template>
