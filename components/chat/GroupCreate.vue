<script setup>
/**
 * Create or join a group — three types following 0xchat model:
 *   - Private Group (E2E encrypted, for close friends)
 *   - Community (NIP-29 relay group, for larger groups)
 *   - Open Channel (NIP-28, public for everyone)
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useToast } from '../../composables/useToast.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import {
  ArrowLeft, Lock, Globe, Radio, Plus, Loader2,
  AlertCircle, Users, Check, Link, UserSearch,
} from 'lucide-vue-next'

const emit = defineEmits(['back', 'joined'])
const { t } = useI18n()
const { createPrivateGroup, joinRelayGroup, joinChannel, createChannel, adminAction, gkey, groups } = useGroups()
const { contacts, searchContacts, resolveInput, fetchProfile } = useContacts()
const { activeAccount } = useAccounts()
const toast = useToast()

const step = ref('choose') // 'choose' | 'private' | 'relay-join' | 'relay-create' | 'channel-join' | 'channel-create'
const loading = ref(false)
const error = ref('')

// Private group fields
const privateName = ref('')
const selectedMembers = ref([])
const memberSearch = ref('')

const filteredMemberContacts = computed(() => {
  const results = searchContacts(memberSearch.value)
  return results.filter(c => !selectedMembers.value.includes(c.pubkey))
})

function toggleMember(pubkey) {
  if (selectedMembers.value.includes(pubkey)) {
    selectedMembers.value = selectedMembers.value.filter(pk => pk !== pubkey)
  } else {
    selectedMembers.value = [...selectedMembers.value, pubkey]
  }
}

// Relay / channel fields
const joinLink = ref('')
const createName = ref('')
const createAbout = ref('')
const createServer = ref('')

const isValidServer = computed(() => {
  const s = createServer.value.trim()
  return !s || s.startsWith('wss://') || s.startsWith('ws://')
})

function parseJoinLink() {
  const val = joinLink.value.trim()
  const urlMatch = val.match(/^(wss?:\/\/[^/\s]+)\/(.+)$/)
  if (urlMatch) return { relay: urlMatch[1], id: urlMatch[2] }
  const spaceMatch = val.match(/^(wss?:\/\/[^\s]+)\s+(.+)$/)
  if (spaceMatch) return { relay: spaceMatch[1], id: spaceMatch[2] }
  return null
}

const canJoin = computed(() => !!parseJoinLink())

// ── Actions ──

async function handleCreatePrivate() {
  const name = privateName.value.trim()
  if (!name || selectedMembers.value.length === 0) return

  loading.value = true
  error.value = ''
  try {
    const group = createPrivateGroup(name, '', selectedMembers.value)
    toast.success(t('group.accepted'))
    emit('joined', gkey(group))
  } catch (err) {
    error.value = err.message || t('group.joinFailed')
  } finally {
    loading.value = false
  }
}

async function handleJoinRelay() {
  const parsed = parseJoinLink()
  if (!parsed) return
  loading.value = true
  error.value = ''
  try {
    await joinRelayGroup(parsed.id, parsed.relay)
    toast.success(t('group.accepted'))
    const joinedGroup = groups.value.find(g => g.id === parsed.id && g.relay === parsed.relay)
    if (joinedGroup) emit('joined', gkey(joinedGroup))
  } catch (err) {
    error.value = err.message || t('group.joinFailed')
  } finally {
    loading.value = false
  }
}

async function handleCreateRelay() {
  const server = createServer.value.trim()
  const name = createName.value.trim()
  if (!server || !name) return
  if (!server.startsWith('wss://') && !server.startsWith('ws://')) {
    error.value = t('group.invalidRelay')
    return
  }

  loading.value = true
  error.value = ''
  try {
    const groupId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + Math.random().toString(36).slice(2, 6)
    await joinRelayGroup(groupId, server)
    await adminAction(groupId, server, { type: 'edit-metadata', name, about: createAbout.value.trim() || undefined })
    toast.success(t('group.accepted'))
    const createdGroup = groups.value.find(g => g.id === groupId && g.relay === server)
    if (createdGroup) emit('joined', gkey(createdGroup))
  } catch (err) {
    error.value = err.message || t('group.joinFailed')
  } finally {
    loading.value = false
  }
}

async function handleJoinChannel() {
  const parsed = parseJoinLink()
  if (!parsed) return
  loading.value = true
  error.value = ''
  try {
    await joinChannel(parsed.id, parsed.relay)
    toast.success(t('group.accepted'))
    const joinedChan = groups.value.find(g => g.id === parsed.id)
    if (joinedChan) emit('joined', gkey(joinedChan))
  } catch (err) {
    error.value = err.message || t('group.joinFailed')
  } finally {
    loading.value = false
  }
}

async function handleCreateChannel() {
  const name = createName.value.trim()
  if (!name) return
  loading.value = true
  error.value = ''
  try {
    const relay = createServer.value.trim() || undefined
    const channelId = await createChannel(name, createAbout.value.trim(), relay)
    toast.success(t('group.accepted'))
    const createdChan = groups.value.find(g => g.id === channelId)
    if (createdChan) emit('joined', gkey(createdChan))
  } catch (err) {
    error.value = err.message || t('group.joinFailed')
  } finally {
    loading.value = false
  }
}

function resetFields() {
  error.value = ''
  joinLink.value = ''
  createName.value = ''
  createAbout.value = ''
  createServer.value = ''
  privateName.value = ''
  selectedMembers.value = []
  memberSearch.value = ''
}
</script>

<template>
  <div class="flex flex-col h-full animate-slide-in-right">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
      <button @click="step === 'choose' ? emit('back') : (step = 'choose', resetFields())"
        class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>
      <span class="text-[14px] font-semibold">{{ t('group.title') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">

      <!-- Error -->
      <div v-if="error" class="flex items-center gap-2 p-2.5 rounded-2xl bg-error/10 text-error text-xs">
        <AlertCircle class="w-4 h-4 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- ═══ STEP: CHOOSE TYPE ═══ -->
      <template v-if="step === 'choose'">
        <p class="text-xs text-text-muted text-center px-2">{{ t('group.chooseTypeDesc') }}</p>

        <!-- Private Group -->
        <button @click="step = 'private'"
          class="w-full flex items-center gap-3 px-4 py-3.5 bg-surface-card rounded-2xl border border-border shadow-sm hover:border-brand/30 transition-all text-left">
          <div class="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
            <Lock class="w-4.5 h-4.5 text-brand" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold">{{ t('group.typePrivate') }}</div>
            <p class="text-[11px] text-text-muted leading-relaxed">{{ t('group.typePrivateDesc') }}</p>
          </div>
        </button>

        <!-- Community (Relay Group) -->
        <button @click="step = 'relay-join'"
          class="w-full flex items-center gap-3 px-4 py-3.5 bg-surface-card rounded-2xl border border-border shadow-sm hover:border-brand/30 transition-all text-left">
          <div class="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
            <Users class="w-4.5 h-4.5 text-info" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold">{{ t('group.typeCommunity') }}</div>
            <p class="text-[11px] text-text-muted leading-relaxed">{{ t('group.typeCommunityDesc') }}</p>
          </div>
        </button>

        <!-- Open Channel -->
        <button @click="step = 'channel-join'"
          class="w-full flex items-center gap-3 px-4 py-3.5 bg-surface-card rounded-2xl border border-border shadow-sm hover:border-brand/30 transition-all text-left">
          <div class="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
            <Globe class="w-4.5 h-4.5 text-success" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-semibold">{{ t('group.typeChannel') }}</div>
            <p class="text-[11px] text-text-muted leading-relaxed">{{ t('group.typeChannelDesc') }}</p>
          </div>
        </button>
      </template>

      <!-- ═══ PRIVATE GROUP ═══ -->
      <template v-else-if="step === 'private'">
        <div class="text-center py-2">
          <div class="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-2">
            <Lock class="w-5 h-5 text-brand" />
          </div>
          <p class="text-sm font-semibold">{{ t('group.typePrivate') }}</p>
          <p class="text-[11px] text-text-muted mt-0.5">{{ t('group.privateExplain') }}</p>
        </div>

        <input v-model="privateName" :placeholder="t('group.groupNamePlaceholder')"
          class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />

        <!-- Member picker -->
        <div class="space-y-2">
          <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">
            {{ t('group.addMembers') }} ({{ selectedMembers.length }})
          </span>

          <!-- Selected members chips -->
          <div v-if="selectedMembers.length > 0" class="flex flex-wrap gap-1">
            <span v-for="pk in selectedMembers" :key="pk"
              @click="toggleMember(pk)"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand/10 text-brand text-[10px] font-medium cursor-pointer hover:bg-brand/20 transition-colors">
              {{ contacts.find(c => c.pubkey === pk)?.profile?.name || pk.slice(0, 8) }}
              <span class="text-brand/60">&times;</span>
            </span>
          </div>

          <!-- Search contacts -->
          <div class="relative">
            <UserSearch class="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input v-model="memberSearch" :placeholder="t('group.searchMembers')"
              class="w-full bg-surface-card border border-border rounded-xl pl-9 pr-3 py-2 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          </div>

          <div class="max-h-40 overflow-y-auto space-y-0 -mx-1">
            <button v-for="c in filteredMemberContacts" :key="c.pubkey"
              @click="toggleMember(c.pubkey)"
              class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                :style="!c.profile?.picture ? { background: getAvatarColor(c.pubkey) } : {}">
                <img v-if="c.profile?.picture" :src="c.profile.picture" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-[9px] font-bold text-white">{{ ((c.profile?.name || '?')[0]).toUpperCase() }}</span>
              </div>
              <span class="text-xs font-medium truncate flex-1">{{ c.profile?.display_name || c.profile?.name || c.npub?.slice(0, 12) }}</span>
            </button>
          </div>
        </div>

        <button @click="handleCreatePrivate" :disabled="!privateName.trim() || selectedMembers.length === 0 || loading"
          class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          {{ loading ? t('group.creating') : t('group.createGroup') }}
        </button>
      </template>

      <!-- ═══ RELAY GROUP — JOIN / CREATE toggle ═══ -->
      <template v-else-if="step === 'relay-join' || step === 'relay-create'">
        <div class="flex bg-surface-card rounded-2xl border border-border p-0.5">
          <button @click="step = 'relay-join'; resetFields()"
            class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
            :class="step === 'relay-join' ? 'bg-brand text-surface-base' : 'text-text-muted'">
            {{ t('group.joinExisting') }}
          </button>
          <button @click="step = 'relay-create'; resetFields()"
            class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
            :class="step === 'relay-create' ? 'bg-brand text-surface-base' : 'text-text-muted'">
            {{ t('group.createNew') }}
          </button>
        </div>

        <!-- Join -->
        <template v-if="step === 'relay-join'">
          <div class="text-center py-2">
            <Users class="w-8 h-8 text-info mx-auto mb-1" />
            <p class="text-xs text-text-muted">{{ t('group.joinDesc') }}</p>
          </div>
          <input v-model="joinLink" :placeholder="t('group.joinPlaceholder')"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />
          <p class="text-[9px] text-text-muted px-1">{{ t('group.joinFormatHint') }}</p>
          <button @click="handleJoinRelay" :disabled="!canJoin || loading"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ loading ? t('group.joining') : t('group.joinGroup') }}
          </button>
        </template>

        <!-- Create -->
        <template v-else>
          <input v-model="createName" :placeholder="t('group.groupNamePlaceholder')"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <textarea v-model="createAbout" :placeholder="t('group.groupAboutPlaceholder')" rows="2"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors resize-none placeholder:text-text-muted" />
          <div class="space-y-1">
            <input v-model="createServer" :placeholder="t('group.serverPlaceholder')"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted"
              :class="createServer.trim() && !isValidServer ? 'border-error' : ''" />
            <p v-if="createServer.trim() && !isValidServer" class="text-[9px] text-error px-1">{{ t('group.invalidRelay') }}</p>
            <p v-else class="text-[9px] text-text-muted px-1">{{ t('group.serverHint') }}</p>
          </div>
          <button @click="handleCreateRelay" :disabled="!createServer.trim() || !createName.trim() || !isValidServer || loading"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ loading ? t('group.creating') : t('group.createGroup') }}
          </button>
        </template>
      </template>

      <!-- ═══ OPEN CHANNEL — JOIN / CREATE toggle ═══ -->
      <template v-else-if="step === 'channel-join' || step === 'channel-create'">
        <div class="flex bg-surface-card rounded-2xl border border-border p-0.5">
          <button @click="step = 'channel-join'; resetFields()"
            class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
            :class="step === 'channel-join' ? 'bg-brand text-surface-base' : 'text-text-muted'">
            {{ t('group.joinExisting') }}
          </button>
          <button @click="step = 'channel-create'; resetFields()"
            class="flex-1 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
            :class="step === 'channel-create' ? 'bg-brand text-surface-base' : 'text-text-muted'">
            {{ t('group.createNew') }}
          </button>
        </div>

        <!-- Join channel -->
        <template v-if="step === 'channel-join'">
          <div class="text-center py-2">
            <Globe class="w-8 h-8 text-success mx-auto mb-1" />
            <p class="text-xs text-text-muted">{{ t('group.channelJoinDesc') }}</p>
          </div>
          <input v-model="joinLink" :placeholder="t('group.joinPlaceholder')"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />
          <button @click="handleJoinChannel" :disabled="!canJoin || loading"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ loading ? t('group.joining') : t('group.joinGroup') }}
          </button>
        </template>

        <!-- Create channel -->
        <template v-else>
          <input v-model="createName" :placeholder="t('group.groupNamePlaceholder')"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <textarea v-model="createAbout" :placeholder="t('group.groupAboutPlaceholder')" rows="2"
            class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors resize-none placeholder:text-text-muted" />
          <div class="space-y-1">
            <input v-model="createServer" :placeholder="t('group.serverPlaceholder')"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />
            <p class="text-[9px] text-text-muted px-1">{{ t('group.serverHintOptional') }}</p>
          </div>
          <button @click="handleCreateChannel" :disabled="!createName.trim() || loading"
            class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
            <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
            {{ loading ? t('group.creating') : t('group.createGroup') }}
          </button>
        </template>
      </template>
    </div>
  </div>
</template>
