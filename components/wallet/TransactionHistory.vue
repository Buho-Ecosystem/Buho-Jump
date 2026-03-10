<script setup>
/**
 * Full transaction history — filter tabs (All/Sent/Received),
 * date grouping with collapsible sections, paginated load-more.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWallet } from '../../composables/useWallet.js'

const { t } = useI18n()
import TransactionItem from './TransactionItem.vue'
import { ArrowLeft, Loader2, ChevronDown } from 'lucide-vue-next'

const emit = defineEmits(['back', 'detail'])

const { listTransactions } = useWallet()

const transactions = ref([])
const loading = ref(false)
const hasMore = ref(true)
const PAGE_SIZE = 20
const activeFilter = ref('all') // 'all' | 'incoming' | 'outgoing'

const filters = [
  { id: 'all', label: 'wallet.filterAll' },
  { id: 'incoming', label: 'wallet.filterReceived' },
  { id: 'outgoing', label: 'wallet.filterSent' },
]

const filteredTransactions = computed(() => {
  if (activeFilter.value === 'all') return transactions.value
  return transactions.value.filter(tx => tx.type === activeFilter.value)
})

// Group by date
const collapsedGroups = ref(new Set())

const groupedTransactions = computed(() => {
  const groups = []
  let currentDate = ''

  for (const tx of filteredTransactions.value) {
    const ts = tx.settled_at || tx.created_at
    const date = ts ? new Date(ts * 1000).toLocaleDateString() : t('wallet.statusPending')
    if (date !== currentDate) {
      currentDate = date
      groups.push({ date, label: formatGroupDate(ts), transactions: [] })
    }
    groups[groups.length - 1].transactions.push(tx)
  }
  return groups
})

function formatGroupDate(ts) {
  if (!ts) return t('wallet.statusPending')
  const date = new Date(ts * 1000)
  const now = new Date()
  const diff = now - date
  const days = Math.floor(diff / 86400000)
  if (days === 0) return t('wallet.groupToday')
  if (days === 1) return t('wallet.groupYesterday')
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function toggleGroup(date) {
  if (collapsedGroups.value.has(date)) {
    collapsedGroups.value.delete(date)
  } else {
    collapsedGroups.value.add(date)
  }
}

function setFilter(id) {
  activeFilter.value = id
}

async function load(offset = 0) {
  loading.value = true
  try {
    const result = await listTransactions({ limit: PAGE_SIZE, offset })
    const txs = result?.transactions || []
    if (offset === 0) {
      transactions.value = txs
    } else {
      transactions.value = [...transactions.value, ...txs]
    }
    hasMore.value = txs.length >= PAGE_SIZE
  } catch {
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

function loadMore() {
  load(transactions.value.length)
}

onMounted(() => load())
</script>

<template>
  <div class="animate-fade-in-up">
    <!-- Header -->
    <div class="flex items-center gap-2 mb-3">
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-colors">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('wallet.historyTitle') }}</span>
    </div>

    <!-- Filter tabs -->
    <div class="flex gap-1 mb-3 p-0.5 bg-surface-elevated rounded-lg">
      <button
        v-for="f in filters"
        :key="f.id"
        @click="setFilter(f.id)"
        class="flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-all"
        :class="activeFilter === f.id
          ? 'bg-surface-card text-text-primary shadow-sm'
          : 'text-text-muted hover:text-text-secondary'"
      >
        {{ t(f.label) }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && transactions.length === 0" class="space-y-2">
      <div v-for="i in 6" :key="i" class="skeleton-shimmer h-12 rounded-xl" />
    </div>

    <!-- Grouped list -->
    <div v-else-if="groupedTransactions.length > 0" class="space-y-3">
      <div v-for="group in groupedTransactions" :key="group.date">
        <!-- Date group header -->
        <button
          @click="toggleGroup(group.date)"
          class="w-full flex items-center justify-between px-2 py-1 mb-1"
        >
          <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ group.label }}
          </span>
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-text-muted font-medium">
              {{ group.transactions.length }} tx
            </span>
            <ChevronDown
              class="w-3 h-3 text-text-muted transition-transform duration-200"
              :class="collapsedGroups.has(group.date) ? '-rotate-90' : ''"
            />
          </div>
        </button>

        <!-- Group transactions -->
        <div v-if="!collapsedGroups.has(group.date)" class="space-y-0.5">
          <TransactionItem
            v-for="tx in group.transactions"
            :key="tx.payment_hash"
            :tx="tx"
            @click="emit('detail', tx)"
          />
        </div>
      </div>

      <button
        v-if="hasMore"
        @click="loadMore"
        :disabled="loading"
        class="w-full py-2.5 text-xs text-text-muted hover:text-brand transition-colors font-medium flex items-center justify-center gap-1.5"
      >
        <Loader2 v-if="loading" class="w-3 h-3 animate-spin" />
        {{ loading ? t('common.loading') : t('wallet.loadMore') }}
      </button>
    </div>

    <!-- Empty -->
    <div v-else class="text-center py-12">
      <p class="text-xs text-text-muted">{{ t('wallet.noResults') }}</p>
    </div>
  </div>
</template>
