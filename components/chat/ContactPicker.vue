<script setup>
/**
 * Contact picker — unified search for starting new chats.
 *
 * Single input auto-detects format (npub, nprofile, hex, NIP-05, free text).
 * Three result sections in priority order:
 *   1. Follow list contacts (local, instant)
 *   2. Resolved address (npub/NIP-05 → profile card)
 *   3. Nostr relay search (NIP-50, debounced)
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { nip19, nip50 } from 'nostr-core'
import { getPool } from '../../lib/relayPool.js'
import { getPoolRelays, DEFAULT_ACCOUNT_RELAYS } from '../../lib/relays.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import ErrorBanner from '../ErrorBanner.vue'
import {
  ArrowLeft, UserSearch, Loader2, User, RefreshCw,
  AlertCircle, Users, Globe, ChevronRight,
} from 'lucide-vue-next'

const PAGE_SIZE = 20

const { t } = useI18n()
const emit = defineEmits(['back', 'open'])

const { contacts, loading, error: contactsError, loadFollowList, resolveInput, searchContacts, fetchProfile, needsLoad } = useContacts()
const { activeAccount } = useAccounts()

const input = ref('')
const resolving = ref(false)
const resolveError = ref('')
const resolvedProfile = ref(null)
const resolvedPubkey = ref(null)

// NIP-50 relay search
const relaySearchResults = ref([])
const relaySearching = ref(false)
let debounceTimer = null

// Detect input types
function isNostrAddress(val) {
  return val.startsWith('npub1') ||
    val.startsWith('nprofile1') ||
    /^[0-9a-f]{64}$/i.test(val)
}

function isNip05(val) {
  return val.includes('@') && val.length > 3
}

const looksLikeAddress = computed(() => {
  const val = input.value.trim()
  return isNostrAddress(val) || isNip05(val)
})

const contactVisibleCount = ref(PAGE_SIZE)
const filteredContacts = computed(() => searchContacts(input.value))
const paginatedContacts = computed(() => filteredContacts.value.slice(0, contactVisibleCount.value))
const hasMoreContacts = computed(() => contactVisibleCount.value < filteredContacts.value.length)
const hasInput = computed(() => input.value.trim().length > 0)

// Auto-resolve everything on input change — no Enter needed
watch(input, (val) => {
  resolveError.value = ''
  resolvedPubkey.value = null
  resolvedProfile.value = null
  relaySearchResults.value = []
  contactVisibleCount.value = PAGE_SIZE

  if (debounceTimer) clearTimeout(debounceTimer)

  const trimmed = val.trim()
  if (!trimmed) return

  if (isNostrAddress(trimmed)) {
    // npub / nprofile / hex → resolve instantly (no network call)
    handleResolve()
  } else if (isNip05(trimmed)) {
    // NIP-05 → debounce 400ms (HTTP lookup)
    debounceTimer = setTimeout(() => handleResolve(), 400)
  } else if (trimmed.length >= 3) {
    // Free text → debounce relay search 600ms
    debounceTimer = setTimeout(() => searchRelays(), 600)
  }
})

onMounted(() => {
  if (activeAccount.value?.pubkey && needsLoad(activeAccount.value.pubkey)) {
    loadFollowList(activeAccount.value.pubkey)
  }
})

async function handleResolve() {
  const val = input.value.trim()
  if (!val || resolving.value) return

  resolving.value = true
  resolveError.value = ''
  resolvedProfile.value = null
  resolvedPubkey.value = null

  try {
    const pubkey = await resolveInput(val)
    if (!pubkey) {
      resolveError.value = t('chat.resolveNotFound')
      return
    }
    resolvedPubkey.value = pubkey
    const profile = await fetchProfile(pubkey)
    resolvedProfile.value = profile
  } catch (err) {
    resolveError.value = err.message || t('chat.resolveFailed')
  } finally {
    resolving.value = false
  }
}


function openContact(pubkey) {
  emit('open', pubkey)
}

async function searchRelays() {
  const q = input.value.trim()
  if (!q || q.length < 2 || relaySearching.value) return

  relaySearching.value = true
  relaySearchResults.value = []
  try {
    const pool = getPool()
    const relays = activeAccount.value?.pubkey
      ? await getPoolRelays(activeAccount.value.pubkey, 'account').catch(() => DEFAULT_ACCOUNT_RELAYS)
      : DEFAULT_ACCOUNT_RELAYS
    const filter = nip50.buildSearchFilter(q, { kinds: [0], limit: 10 })
    const events = await pool.querySync(relays, filter, { maxWait: 6000 })

    const profiles = []
    const seen = new Set()
    for (const e of events) {
      if (seen.has(e.pubkey)) continue
      seen.add(e.pubkey)
      try {
        profiles.push({ pubkey: e.pubkey, profile: JSON.parse(e.content) })
      } catch { /* malformed */ }
    }
    relaySearchResults.value = profiles
  } catch { /* relay search failed — NIP-50 not supported */ }
  finally { relaySearching.value = false }
}

function handleRetryContacts() {
  if (activeAccount.value?.pubkey) {
    loadFollowList(activeAccount.value.pubkey)
  }
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function truncateNpub(pubkey) {
  try {
    const npub = nip19.npubEncode(pubkey)
    return npub.slice(0, 12) + '...' + npub.slice(-6)
  } catch {
    return pubkey.slice(0, 12) + '...'
  }
}
</script>

<template>
  <div class="animate-slide-in-right flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
      <button @click="emit('back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.back')">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>
      <span class="text-[14px] font-semibold">{{ t('chat.newChat') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <!-- Find user input -->
      <div class="relative mb-3">
        <UserSearch class="w-4 h-4 text-brand absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          v-model="input"
          :placeholder="t('chat.inputHint')"
          class="chat-input-pill w-full pl-10 pr-4"
          autofocus
        />
      </div>

      <!-- Resolving spinner -->
      <div v-if="resolving" class="flex items-center justify-center gap-2 py-3 text-xs text-text-muted mb-3">
        <Loader2 class="w-3.5 h-3.5 animate-spin text-brand" />
        {{ t('chat.resolving') }}
      </div>

      <!-- Resolve error -->
      <div v-if="resolveError" class="flex items-center gap-2 p-2.5 rounded-2xl bg-error/10 text-error text-xs mb-3">
        <AlertCircle class="w-4 h-4 shrink-0" />
        <span>{{ resolveError }}</span>
      </div>

      <!-- Resolved profile card -->
      <button
        v-if="resolvedPubkey"
        @click="openContact(resolvedPubkey)"
        class="w-full flex items-center gap-3 px-3 py-3 bg-surface-card rounded-2xl shadow-sm border border-brand/30 hover:border-brand transition-all text-left mb-3"
      >
        <div class="w-11 h-11 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
          :style="!resolvedProfile?.picture ? { background: getAvatarColor(resolvedPubkey) } : {}">
          <img v-if="resolvedProfile?.picture" :src="resolvedProfile.picture" alt="" class="w-full h-full object-cover" @error="resolvedProfile.picture = null" />
          <User v-else class="w-5 h-5 text-white" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold truncate">
            {{ resolvedProfile?.display_name || resolvedProfile?.name || truncateNpub(resolvedPubkey) }}
          </div>
          <div v-if="resolvedProfile?.nip05" class="text-[11px] text-brand truncate">{{ resolvedProfile.nip05 }}</div>
          <div v-else class="text-[11px] text-text-muted truncate">{{ truncateNpub(resolvedPubkey) }}</div>
        </div>
        <span class="text-[11px] text-brand font-semibold shrink-0">{{ t('chat.openChat') }}</span>
      </button>

      <!-- Follow list -->
      <div v-if="!resolving && !resolvedPubkey">
        <div class="flex items-center justify-between px-1 mb-2">
          <div class="flex items-center gap-1.5">
            <Users class="w-3.5 h-3.5 text-text-muted" />
            <span class="text-[11px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('chat.contacts') }}
              <span v-if="contacts.length > 0" class="normal-case tracking-normal">({{ contacts.length }})</span>
            </span>
          </div>
          <button v-if="!loading" @click="handleRetryContacts"
            class="p-1 rounded-lg hover:bg-surface-elevated transition-colors" :title="t('wallet.failedRefresh')">
            <RefreshCw class="w-3 h-3 text-text-muted" />
          </button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-1">
          <div v-for="i in 5" :key="i" class="flex items-center gap-3 py-2">
            <div class="w-[42px] h-[42px] rounded-full skeleton-shimmer shrink-0" />
            <div class="flex-1 space-y-1.5">
              <div class="skeleton-shimmer h-3.5 rounded w-28" />
              <div class="skeleton-shimmer h-2.5 rounded w-36" />
            </div>
          </div>
        </div>

        <!-- Contacts load error -->
        <ErrorBanner
          v-else-if="contactsError"
          type="warning"
          :message="t(contactsError)"
          :retry-label="t('common.retry')"
          @retry="handleRetryContacts"
          class="mb-2"
        />

        <!-- Contact list -->
        <div v-else-if="filteredContacts.length > 0" class="space-y-0 -mx-3">
          <button
            v-for="c in paginatedContacts"
            :key="c.pubkey"
            @click="openContact(c.pubkey)"
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-elevated transition-all duration-200 text-left"
          >
            <div class="w-[42px] h-[42px] rounded-full shrink-0 overflow-hidden flex items-center justify-center"
              :style="!c.profile?.picture ? { background: getAvatarColor(c.pubkey) } : {}">
              <img v-if="c.profile?.picture" :src="c.profile.picture" alt="" class="w-full h-full object-cover" @error="c.profile.picture = null" />
              <span v-else class="text-sm font-semibold text-white">{{ ((c.profile?.name || '?')[0]).toUpperCase() }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium truncate">{{ c.profile?.display_name || c.profile?.name || truncateNpub(c.pubkey) }}</div>
              <div v-if="c.profile?.nip05" class="text-[11px] text-brand truncate">{{ c.profile.nip05 }}</div>
              <div v-else class="text-[11px] text-text-muted truncate">{{ truncateNpub(c.pubkey) }}</div>
            </div>
          </button>
        </div>

        <!-- Show more contacts -->
        <button v-if="hasMoreContacts" @click="contactVisibleCount += PAGE_SIZE"
          class="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-text-muted hover:text-brand font-semibold transition-all duration-200">
          <span>{{ t('common.showMore') }}</span>
          <span class="text-[10px] opacity-60">({{ t('common.showingOf', { shown: paginatedContacts.length, total: filteredContacts.length }) }})</span>
          <ChevronRight class="w-3 h-3" />
        </button>

        <!-- No contacts + no search -->
        <div v-else-if="!hasInput" class="text-center py-6 space-y-2">
          <Users class="w-6 h-6 text-text-muted mx-auto" />
          <p class="text-xs text-text-muted leading-relaxed px-4">
            {{ t('chat.noContactsGuide') }}
          </p>
          <p class="text-[10px] text-text-muted px-4">
            {{ t('chat.noContactsFormats') }}
          </p>
        </div>

        <!-- Search matched nothing in contacts -->
        <div v-else class="text-center py-4">
          <p class="text-xs text-text-muted">{{ t('chat.noContactsMatch') }}</p>
        </div>
      </div>

      <!-- NIP-50 relay search results -->
      <div v-if="relaySearchResults.length > 0 && !resolvedPubkey" class="mt-3 pt-3 border-t border-border">
        <div class="flex items-center gap-1.5 px-1 mb-2">
          <Globe class="w-3 h-3 text-text-muted" />
          <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
            {{ t('chat.nostrResults') }} ({{ relaySearchResults.length }})
          </span>
        </div>
        <div class="space-y-0 -mx-3">
          <button
            v-for="r in relaySearchResults"
            :key="r.pubkey"
            @click="openContact(r.pubkey)"
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-elevated transition-all duration-200 text-left"
          >
            <div class="w-[42px] h-[42px] rounded-full shrink-0 overflow-hidden flex items-center justify-center"
              :style="!r.profile?.picture ? { background: getAvatarColor(r.pubkey) } : {}">
              <img v-if="r.profile?.picture" :src="r.profile.picture" alt="" class="w-full h-full object-cover" @error="r.profile.picture = null" />
              <span v-else class="text-sm font-semibold text-white">{{ ((r.profile?.name || '?')[0]).toUpperCase() }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[13px] font-medium truncate">{{ r.profile?.display_name || r.profile?.name || truncateNpub(r.pubkey) }}</div>
              <div v-if="r.profile?.nip05" class="text-[11px] text-brand truncate">{{ r.profile.nip05 }}</div>
              <div v-else class="text-[11px] text-text-muted truncate">{{ truncateNpub(r.pubkey) }}</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Relay search in progress -->
      <div v-if="relaySearching" class="flex items-center justify-center gap-2 py-4 text-xs text-text-muted mt-2">
        <Loader2 class="w-3.5 h-3.5 animate-spin text-brand" />
        {{ t('chat.searchingNostr') }}
      </div>

    </div>
  </div>
</template>
