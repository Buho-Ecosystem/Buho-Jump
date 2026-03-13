<script setup>
/**
 * Telegram-style contact picker — pill search, follow list with
 * deterministic avatar colors, and universal npub/hex/nip05 resolve.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { nip19 } from 'nostr-core'
import { getAvatarColor } from '../../lib/avatarColor.js'
import {
  ArrowLeft, Search, Loader2, User,
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

// Clear stale state when user changes input
watch(input, () => {
  resolveError.value = ''
  resolvedPubkey.value = null
  resolvedProfile.value = null
})

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
    const profile = await fetchProfile(pubkey)
    resolvedProfile.value = profile
  } catch (err) {
    resolveError.value = err.message || t('chat.resolveFailed')
  } finally {
    resolving.value = false
  }
}

function openResolved() {
  if (resolvedPubkey.value) emit('open', resolvedPubkey.value)
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
  <div class="animate-slide-in-right">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border">
      <button @click="emit('back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.back')">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>
      <span class="text-[14px] font-semibold">{{ t('chat.newChat') }}</span>
    </div>

    <div class="p-3">
      <!-- Search input (pill) -->
      <div class="relative mb-3">
        <Search class="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          v-model="input"
          :placeholder="t('chat.inputHint')"
          @keydown.enter="handleResolve"
          class="chat-input-pill w-full pl-10 pr-4"
        />
      </div>

      <!-- Resolve button -->
      <button
        v-if="input.trim() && !resolvedPubkey"
        @click="handleResolve"
        :disabled="resolving"
        class="w-full py-2.5 text-xs rounded-full bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 mb-3"
      >
        <Loader2 v-if="resolving" class="w-3.5 h-3.5 animate-spin" />
        {{ resolving ? t('chat.resolving') : t('chat.findUser') }}
      </button>

      <!-- Resolve error -->
      <div v-if="resolveError" class="flex items-center gap-2 p-2.5 rounded-3xl bg-error/10 text-error text-xs mb-3">
        <AlertCircle class="w-4 h-4 shrink-0" />
        <span>{{ resolveError }}</span>
      </div>

      <!-- Resolved profile card -->
      <button
        v-if="resolvedPubkey"
        @click="openResolved"
        class="w-full flex items-center gap-3 px-3 py-3 bg-surface-card rounded-3xl shadow-sm border border-brand/30 hover:border-brand transition-all text-left mb-3"
      >
        <div
          class="w-11 h-11 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
          :style="!resolvedProfile?.picture ? { background: getAvatarColor(resolvedPubkey) } : {}"
        >
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
      <div v-if="showContacts">
        <div class="flex items-center gap-1.5 px-1 mb-2.5">
          <Users class="w-3.5 h-3.5 text-text-muted" />
          <span class="text-[11px] uppercase tracking-widest text-text-muted font-semibold">
            {{ t('chat.contacts') }}
            <span v-if="contacts.length > 0" class="normal-case tracking-normal">({{ contacts.length }})</span>
          </span>
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

        <!-- Contact list -->
        <div v-else-if="filteredContacts.length > 0" class="space-y-0 max-h-72 overflow-y-auto -mx-3">
          <button
            v-for="c in filteredContacts"
            :key="c.pubkey"
            @click="openContact(c.pubkey)"
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-elevated transition-all duration-200 text-left"
          >
            <div
              class="w-[42px] h-[42px] rounded-full shrink-0 overflow-hidden flex items-center justify-center"
              :style="!c.profile?.picture ? { background: getAvatarColor(c.pubkey) } : {}"
            >
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

        <!-- No contacts -->
        <div v-else class="text-center py-8">
          <p class="text-xs text-text-muted">{{ t('chat.noContacts') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
