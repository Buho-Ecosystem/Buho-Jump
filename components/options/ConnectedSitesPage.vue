<script setup>
/**
 * Connected Sites page — full-width table of domains with permissions and budgets.
 * Wraps existing SiteDetail for per-site drill-down.
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissions } from '../../composables/usePermissions.js'
import SiteDetail from '../SiteDetail.vue'
import { Globe, ChevronRight, Search, ShieldOff } from 'lucide-vue-next'

const { t } = useI18n()
const { policies, load } = usePermissions()

const selectedSite = ref(null)
const search = ref('')
const loading = ref(true)
const faviconErrors = reactive(new Set())

onMounted(async () => {
  await load()
  loading.value = false
})

const filteredSites = computed(() => {
  const entries = Object.entries(policies.value)
  if (!search.value.trim()) return entries
  const q = search.value.toLowerCase()
  return entries.filter(([host]) => host.toLowerCase().includes(q))
})

function methodCount(methods) {
  return Object.keys(methods).length
}

function allowedCount(methods) {
  return Object.values(methods).filter(m => m.decision === 'allow').length
}

function faviconUrl(host) {
  try { return `https://${host}/favicon.ico` } catch { return '' }
}

function onRevoked() {
  selectedSite.value = null
  load()
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
      @back="selectedSite = null"
      @revoked="onRevoked"
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
      <div v-if="Object.keys(policies).length > 3" class="relative">
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
          <!-- Favicon -->
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
            <img
              v-if="!faviconErrors.has(host)"
              :src="faviconUrl(host)"
              @error="faviconErrors.add(host)"
              class="w-5 h-5"
              alt=""
            />
            <Globe v-else class="w-4 h-4 text-text-muted" />
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate">{{ host }}</div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-[10px] text-text-muted">
                {{ allowedCount(methods) }} {{ t('options.allowed') }}, {{ methodCount(methods) - allowedCount(methods) }} {{ t('options.denied') }}
              </span>
            </div>
          </div>

          <!-- Arrow -->
          <ChevronRight class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200 shrink-0" />
        </button>
      </div>

      <!-- Empty state -->
      <div v-else class="bg-surface-card rounded-3xl border border-border shadow-sm p-10 text-center">
        <ShieldOff class="w-8 h-8 text-text-muted mx-auto mb-3" />
        <p class="text-sm font-medium text-text-secondary">{{ t('account.noSites') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('options.noSitesHint') }}</p>
      </div>
    </template>
  </div>
</template>
