<script setup>
/**
 * Contact picker — universal input (npub/hex/nip05) + follow list.
 * Resolves any input format to a pubkey and opens the chat thread.
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { nip19 } from 'nostr-core'
import {
  ArrowLeft, Search, Loader2, AtSign, User,
  AlertCircle, Users,
} from 'lucide-vue-next'

const { t } = useI18n()
const emit = defineEmits(['back', 'open'])

const { contacts, loading, loadFollowList, resolveInput, searchContacts, fetchProfile, needsLoad } = useContacts()
const { activeAccount } = useAccounts()

const input = ref('')
const resolving = ref(false)
const resolveError = ref('')
const resolvedProfile = ref(null)
const resolvedPubkey = ref(null)

const filteredContacts = computed(() => searchContacts(input.value))
const showContacts = computed(() => !resolvedPubkey.value && !resolving.value)

// Load follow list on mount (or reload if account changed)
onMounted(() => {
  if (activeAccount.value?.pubkey && needsLoad(activeAccount.value.pubkey)) {
    loadFollowList(activeAccount.value.pubkey)
  }
})

async function handleResolve() {
  const val = input.value.trim()
  if (!val) return

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

    // Try to fetch profile
    const profile = await fetchProfile(pubkey)
    resolvedProfile.value = profile
  } catch (err) {
    resolveError.value = err.message || t('chat.resolveFailed')
  } finally {
    resolving.value = false
  }
}

function openResolved() {
  if (resolvedPubkey.value) {
    emit('open', resolvedPubkey.value)
  }
}

function openContact(pubkey) {
  emit('open', pubkey)
}

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
  <div class="animate-fade-in-up">
    <!-- Header -->
    <div class="flex items-center gap-2 mb-3">
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-colors" aria-label="Back">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('chat.newChat') }}</span>
    </div>

    <!-- Universal input -->
    <div class="space-y-2 mb-4">
      <div class="relative">
        <Search class="w-3 h-3 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          v-model="input"
          :placeholder="t('chat.inputHint')"
          @keydown.enter="handleResolve"
          class="w-full bg-surface-base border border-border rounded-lg pl-8 pr-3 py-2.5 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted"
        />
      </div>

      <!-- Resolve button (for manual npub/nip05 entry) -->
      <button
        v-if="input.trim() && !resolvedPubkey"
        @click="handleResolve"
        :disabled="resolving"
        class="w-full py-2 text-xs rounded-lg bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-colors font-semibold flex items-center justify-center gap-1.5 btn-primary"
      >
        <Loader2 v-if="resolving" class="w-3 h-3 animate-spin" />
        {{ resolving ? t('chat.resolving') : t('chat.findUser') }}
      </button>

      <!-- Resolve error -->
      <div v-if="resolveError" class="flex items-center gap-2 p-2 rounded-lg bg-error/10 text-error text-xs">
        <AlertCircle class="w-3.5 h-3.5 shrink-0" />
        <span>{{ resolveError }}</span>
      </div>

      <!-- Resolved profile card -->
      <button
        v-if="resolvedPubkey"
        @click="openResolved"
        class="w-full flex items-center gap-3 px-3 py-3 bg-surface-card rounded-xl border border-brand/30 hover:border-brand transition-all text-left"
      >
        <div class="w-10 h-10 rounded-full shrink-0 overflow-hidden"
          :class="resolvedProfile?.picture ? '' : 'bg-brand/15 flex items-center justify-center'">
          <img v-if="resolvedProfile?.picture" :src="resolvedProfile.picture" alt="" class="w-full h-full object-cover" @error="resolvedProfile.picture = null" />
          <User v-else class="w-5 h-5 text-brand" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold truncate">
            {{ resolvedProfile?.display_name || resolvedProfile?.name || truncateNpub(resolvedPubkey) }}
          </div>
          <div v-if="resolvedProfile?.nip05" class="text-[9px] text-brand truncate">{{ resolvedProfile.nip05 }}</div>
          <div v-else class="text-[9px] text-text-muted truncate">{{ truncateNpub(resolvedPubkey) }}</div>
        </div>
        <span class="text-[9px] text-brand font-semibold shrink-0">{{ t('chat.openChat') }}</span>
      </button>
    </div>

    <!-- Follow list -->
    <div v-if="showContacts">
      <div class="flex items-center gap-1.5 px-1 mb-2">
        <Users class="w-3 h-3 text-text-muted" />
        <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {{ t('chat.contacts') }}
          <span v-if="contacts.length > 0" class="normal-case tracking-normal">({{ contacts.length }})</span>
        </span>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="space-y-2">
        <div v-for="i in 5" :key="i" class="skeleton-shimmer h-12 rounded-xl" />
      </div>

      <!-- Contact list -->
      <div v-else-if="filteredContacts.length > 0" class="space-y-0.5 max-h-72 overflow-y-auto">
        <button
          v-for="c in filteredContacts"
          :key="c.pubkey"
          @click="openContact(c.pubkey)"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-card transition-colors text-left"
        >
          <div class="w-8 h-8 rounded-full shrink-0 overflow-hidden"
            :class="c.profile?.picture ? '' : 'bg-brand/15 flex items-center justify-center'">
            <img v-if="c.profile?.picture" :src="c.profile.picture" alt="" class="w-full h-full object-cover" @error="c.profile.picture = null" />
            <span v-else class="text-[9px] font-bold text-brand">{{ ((c.profile?.name || '?')[0]).toUpperCase() }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium truncate">{{ c.profile?.display_name || c.profile?.name || truncateNpub(c.pubkey) }}</div>
            <div v-if="c.profile?.nip05" class="text-[8px] text-brand truncate">{{ c.profile.nip05 }}</div>
            <div v-else class="text-[8px] text-text-muted truncate">{{ truncateNpub(c.pubkey) }}</div>
          </div>
        </button>
      </div>

      <!-- No contacts -->
      <div v-else class="text-center py-6">
        <p class="text-[10px] text-text-muted">{{ t('chat.noContacts') }}</p>
      </div>
    </div>
  </div>
</template>
