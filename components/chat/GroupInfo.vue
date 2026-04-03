<script setup>
/**
 * Group info panel — metadata, members, admins, admin actions, leave.
 * Adapts to group type: private (local members), relay (NIP-29), channel (NIP-28).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { useToast } from '../../composables/useToast.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import BottomSheet from '../BottomSheet.vue'
import {
  ArrowLeft, Users, Shield, Globe, Lock,
  UserPlus, UserMinus, Pencil, RefreshCw,
  Loader2, AlertTriangle, LogOut, AlertCircle,
  Copy, Check, Link2, VolumeX, Volume2, UserSearch,
} from 'lucide-vue-next'

const props = defineProps({
  groupKey: { type: String, required: true },
})

const emit = defineEmits(['back'])
const { t } = useI18n()
const {
  groups, fetchRelayGroupInfo, leaveGroup, adminAction, inviteUser,
  addMemberToPrivateGroup, removeMemberFromPrivateGroup,
  currentAccountPubkey, gkey,
} = useGroups()
const { getCachedProfile, fetchProfiles, resolveInput, searchContacts, contacts } = useContacts()
const { isGroupMuted, muteGroup, unmuteGroup } = useMuteList()
const toast = useToast()

const group = computed(() =>
  groups.value.find(g => gkey(g) === props.groupKey) || { id: props.groupKey, name: props.groupKey, type: 'relay' }
)

const members = ref([])
const admins = ref([])
const loadingInfo = ref(true)
const loadError = ref(false)
const confirmLeave = ref(false)
const leaving = ref(false)

// Invite member state
const showInvite = ref(false)
const inviteInput = ref('')
const inviting = ref(false)
const inviteSearch = ref('')
const selectedInvites = ref([]) // pubkeys selected for bulk invite

// Remove member state
const removingMember = ref(null)

// Invite link
const linkCopied = ref(false)

function copyInviteLink() {
  const g = group.value
  let link = ''
  if (g.type === 'relay' && g.relay) {
    link = `${g.relay}/${g.id}`
  } else if (g.type === 'channel' && g.relay) {
    link = `${g.relay}/${g.id}`
  } else if (g.type === 'private') {
    link = `Private group: ${g.name} (${g.id})`
  }
  if (!link) return
  navigator.clipboard.writeText(link)
  linkCopied.value = true
  toast.success(t('group.linkCopied'))
  setTimeout(() => (linkCopied.value = false), 2500)
}

const groupMuted = computed(() => isGroupMuted(props.groupKey))

async function toggleGroupMute() {
  if (groupMuted.value) {
    await unmuteGroup(currentAccountPubkey.value, props.groupKey)
    toast.info(t('group.unmuted'))
  } else {
    await muteGroup(currentAccountPubkey.value, props.groupKey)
    toast.info(t('group.muted'))
  }
}

const isAdmin = computed(() =>
  admins.value.some(a => a.pubkey === currentAccountPubkey.value)
)

const isSoleAdmin = computed(() =>
  isAdmin.value && admins.value.length === 1
)

// Owner: for private groups, the account that holds the group privkey
const isOwner = computed(() =>
  group.value.type === 'private' && !!group.value.groupPrivkeyEncrypted
)

const typeLabel = computed(() => {
  if (group.value.type === 'private') return t('group.typePrivate')
  if (group.value.type === 'channel') return t('group.typeChannel')
  return t('group.typeCommunity')
})

const typeIcon = computed(() => {
  if (group.value.type === 'private') return Lock
  if (group.value.type === 'channel') return Globe
  return Users
})

const typeColor = computed(() => {
  if (group.value.type === 'private') return 'text-brand bg-brand/10'
  if (group.value.type === 'channel') return 'text-success bg-success/10'
  return 'text-info bg-info/10'
})

onMounted(async () => {
  const g = group.value
  if (g.type === 'private') {
    members.value = g.members || []
    const uncached = members.value.filter(pk => !getCachedProfile(pk))
    if (uncached.length > 0) await fetchProfiles(uncached)
    loadingInfo.value = false
    return
  }
  if (g.type === 'relay' && g.relay) {
    try {
      const info = await fetchRelayGroupInfo(g.id, g.relay)
      members.value = info.members || []
      admins.value = info.admins || []
      const allPubkeys = [...new Set([...members.value, ...admins.value.map(a => a.pubkey)])]
      const uncached = allPubkeys.filter(pk => !getCachedProfile(pk))
      if (uncached.length > 0) await fetchProfiles(uncached)
    } catch {
      loadError.value = true
    }
  }
  loadingInfo.value = false
})

async function retryLoad() {
  loadError.value = false
  loadingInfo.value = true
  const g = group.value
  try {
    const info = await fetchRelayGroupInfo(g.id, g.relay)
    members.value = info.members || []
    admins.value = info.admins || []
    const allPubkeys = [...new Set([...members.value, ...admins.value.map(a => a.pubkey)])]
    const uncached = allPubkeys.filter(pk => !getCachedProfile(pk))
    if (uncached.length > 0) await fetchProfiles(uncached)
  } catch {
    loadError.value = true
    toast.error(t('group.joinFailed'))
  } finally {
    loadingInfo.value = false
  }
}

async function handleLeave() {
  const g = group.value
  leaving.value = true
  try {
    leaveGroup(g.id, g.type, g.relay)
    toast.info(t('group.leaveGroup'))
    emit('back')
  } catch {
    toast.error(t('group.leaveFailed'))
  } finally {
    leaving.value = false
    confirmLeave.value = false
  }
}

// Filtered contacts for invite search (exclude existing members)
const filteredInviteContacts = computed(() => {
  const results = searchContacts(inviteSearch.value)
  const memberSet = new Set(members.value)
  return results.filter(c => !memberSet.has(c.pubkey) && !selectedInvites.value.includes(c.pubkey))
})

function toggleInviteSelect(pubkey) {
  if (selectedInvites.value.includes(pubkey)) {
    selectedInvites.value = selectedInvites.value.filter(pk => pk !== pubkey)
  } else {
    selectedInvites.value = [...selectedInvites.value, pubkey]
  }
}

async function handleInvite() {
  // Collect pubkeys: from selected contacts + manual input
  const pubkeys = [...selectedInvites.value]
  const manualVal = inviteInput.value.trim()

  if (manualVal) {
    const resolved = await resolveInput(manualVal)
    if (!resolved) { toast.error(t('chat.resolveNotFound')); return }
    if (!pubkeys.includes(resolved)) pubkeys.push(resolved)
  }

  if (pubkeys.length === 0) return

  inviting.value = true
  try {
    const g = group.value
    let added = 0
    for (const pubkey of pubkeys) {
      if (g.type === 'private') {
        addMemberToPrivateGroup(g.id, pubkey)
      } else if (g.type === 'relay') {
        await inviteUser(g.id, g.relay, pubkey)
      }
      added++
    }
    if (g.type === 'private') members.value = [...(g.members || [])]
    toast.success(added === 1 ? t('group.userInvited') : t('group.usersInvited', { count: added }))
    inviteInput.value = ''
    inviteSearch.value = ''
    selectedInvites.value = []
    showInvite.value = false
  } catch (err) {
    toast.error(err.message || t('group.joinFailed'))
  } finally {
    inviting.value = false
  }
}

const removingLoading = ref(false)

async function handleRemoveMember() {
  if (!removingMember.value) return
  const g = group.value
  removingLoading.value = true
  try {
    if (g.type === 'private') {
      await removeMemberFromPrivateGroup(g.id, removingMember.value)
      members.value = members.value.filter(pk => pk !== removingMember.value)
      toast.success(t('group.memberRemovedSecure'))
    } else if (g.type === 'relay') {
      await adminAction(g.id, g.relay, { type: 'remove-user', pubkey: removingMember.value })
      toast.success(t('group.userRemoved'))
    }
  } catch (err) {
    toast.error(err.message || t('group.leaveFailed'))
  } finally {
    removingMember.value = null
    removingLoading.value = false
  }
}

function profileName(pubkey) {
  const p = getCachedProfile(pubkey)
  return p?.display_name || p?.name || pubkey.slice(0, 12) + '...'
}

const permissionLabels = {
  'add-user': () => t('group.permCanInvite'),
  'remove-user': () => t('group.permCanRemove'),
  'edit-metadata': () => t('group.permCanEdit'),
  'delete-event': () => t('group.permCanDelete'),
}

function humanPermissions(perms) {
  if (!perms || perms.length === 0) return t('group.permAdmin')
  return perms.map(p => permissionLabels[p]?.() || p).join(', ')
}
</script>

<template>
  <div class="flex flex-col h-full animate-slide-in-right">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
      <button @click="emit('back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>
      <span class="text-[14px] font-semibold">{{ t('group.groupInfo') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">

      <!-- Group card -->
      <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 text-center">
        <div class="w-16 h-16 rounded-full mx-auto mb-3 overflow-hidden flex items-center justify-center"
          :class="typeColor">
          <img v-if="group.picture" :src="group.picture" alt="" class="w-full h-full object-cover" />
          <component v-else :is="typeIcon" class="w-7 h-7" />
        </div>
        <h2 class="text-sm font-extrabold">{{ group.name || group.id }}</h2>
        <p class="text-[10px] text-text-muted mt-0.5">{{ typeLabel }}</p>
        <p v-if="group.about" class="text-xs text-text-muted mt-1.5 line-clamp-3 leading-relaxed">{{ group.about }}</p>

        <!-- Badges -->
        <div class="flex items-center justify-center gap-2 mt-2 flex-wrap">
          <span v-if="isOwner" class="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-brand/10 text-brand">
            {{ t('group.owner') }}
          </span>
          <span v-if="group.type === 'private' && group.currentEpoch != null"
            class="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-success/10 text-success inline-flex items-center gap-1">
            <Lock class="w-2.5 h-2.5" />
            {{ t('group.encrypted') }}
          </span>
          <span v-if="group.type === 'relay'"
            class="text-[9px] px-2 py-0.5 rounded-full font-semibold"
            :class="group.isOpen ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'">
            {{ group.isOpen ? t('group.openGroup') : t('group.closedGroup') }}
          </span>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loadingInfo" class="space-y-2">
        <div v-for="i in 4" :key="i" class="skeleton-shimmer h-10 rounded-2xl" />
      </div>

      <!-- Load error -->
      <div v-else-if="loadError" class="bg-surface-card rounded-2xl border border-border p-6 text-center space-y-3">
        <AlertCircle class="w-5 h-5 text-text-muted mx-auto" />
        <p class="text-xs text-text-muted">{{ t('group.joinFailed') }}</p>
        <button @click="retryLoad"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated text-xs font-medium text-text-secondary hover:text-brand transition-colors">
          <RefreshCw class="w-3 h-3" />
          {{ t('common.retry') || 'Retry' }}
        </button>
      </div>

      <template v-else>

        <!-- Admin actions (for private group owners or relay group admins) -->
        <div v-if="group.type === 'private' || isAdmin" class="space-y-2">
          <div class="flex items-center gap-1.5 px-1">
            <Shield class="w-3.5 h-3.5 text-brand" />
            <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('group.adminActions') }}
            </span>
          </div>

          <!-- Invite member -->
          <button v-if="!showInvite" @click="showInvite = true"
            class="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-card rounded-2xl border border-border hover:border-brand/20 transition-all text-left">
            <div class="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
              <UserPlus class="w-3.5 h-3.5 text-brand" />
            </div>
            <span class="text-xs font-medium">{{ t('group.inviteUser') }}</span>
          </button>

          <!-- Invite form -->
          <div v-else class="bg-surface-card rounded-2xl border border-border p-3 space-y-2.5">
            <p class="text-[10px] text-text-muted">{{ t('group.inviteUserDesc') }}</p>

            <!-- Selected chips -->
            <div v-if="selectedInvites.length > 0" class="flex flex-wrap gap-1">
              <span v-for="pk in selectedInvites" :key="pk"
                @click="toggleInviteSelect(pk)"
                class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand/10 text-brand text-[10px] font-medium cursor-pointer hover:bg-brand/20 transition-colors">
                {{ profileName(pk) }}
                <span class="text-brand/60">&times;</span>
              </span>
            </div>

            <!-- Contact search -->
            <div class="relative">
              <UserSearch class="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input v-model="inviteSearch" :placeholder="t('group.searchMembers')"
                class="w-full bg-surface-base border border-border rounded-xl pl-9 pr-3 py-2 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
            </div>

            <!-- Contact list -->
            <div v-if="filteredInviteContacts.length > 0" class="max-h-32 overflow-y-auto space-y-0 -mx-1">
              <button v-for="c in filteredInviteContacts" :key="c.pubkey"
                @click="toggleInviteSelect(c.pubkey)"
                class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-elevated transition-colors text-left">
                <div class="w-6 h-6 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                  :style="!c.profile?.picture ? { background: getAvatarColor(c.pubkey) } : {}">
                  <img v-if="c.profile?.picture" :src="c.profile.picture" alt="" class="w-full h-full object-cover" />
                  <span v-else class="text-[8px] font-bold text-white">{{ ((c.profile?.name || '?')[0]).toUpperCase() }}</span>
                </div>
                <span class="text-xs font-medium truncate flex-1">{{ c.profile?.display_name || c.profile?.name || c.npub?.slice(0, 12) }}</span>
              </button>
            </div>

            <!-- Manual input (npub, nip05, hex) -->
            <input v-model="inviteInput"
              :placeholder="t('group.inviteManualPlaceholder')"
              class="w-full bg-surface-base border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />

            <div class="flex gap-2">
              <button @click="showInvite = false; inviteInput = ''; inviteSearch = ''; selectedInvites = []"
                class="flex-1 py-2 text-xs rounded-xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all font-semibold">
                {{ t('common.cancel') }}
              </button>
              <button @click="handleInvite" :disabled="(selectedInvites.length === 0 && !inviteInput.trim()) || inviting"
                class="flex-1 py-2 text-xs rounded-xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all font-semibold btn-primary flex items-center justify-center gap-1">
                <Loader2 v-if="inviting" class="w-3 h-3 animate-spin" />
                {{ selectedInvites.length > 1 ? t('group.inviteCount', { count: selectedInvites.length }) : t('group.inviteUser') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Members -->
        <div v-if="members.length > 0" class="space-y-2">
          <div class="flex items-center gap-1.5 px-1">
            <Users class="w-3.5 h-3.5 text-text-muted" />
            <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('group.memberList') }} ({{ members.length }})
            </span>
          </div>
          <div class="bg-surface-card rounded-2xl border border-border divide-y divide-border/30 max-h-48 overflow-y-auto">
            <div v-for="pk in members" :key="pk"
              class="flex items-center gap-2.5 px-3 py-2 group">
              <div class="w-7 h-7 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                :style="!getCachedProfile(pk)?.picture ? { background: getAvatarColor(pk) } : {}">
                <img v-if="getCachedProfile(pk)?.picture" :src="getCachedProfile(pk).picture" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-[9px] font-bold text-white">{{ (profileName(pk)[0] || '?').toUpperCase() }}</span>
              </div>
              <span class="text-xs font-medium truncate flex-1">{{ profileName(pk) }}</span>
              <Shield v-if="admins.some(a => a.pubkey === pk)" class="w-3 h-3 text-brand shrink-0" />
              <!-- Remove button (admin only, not self) -->
              <button
                v-if="(group.type === 'private' || isAdmin) && pk !== currentAccountPubkey"
                @click="removingMember = pk"
                class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all shrink-0">
                <UserMinus class="w-3 h-3 text-text-muted hover:text-error" />
              </button>
            </div>
          </div>
        </div>

        <!-- Admins (relay groups only) -->
        <div v-if="admins.length > 0 && group.type === 'relay'" class="space-y-2">
          <div class="flex items-center gap-1.5 px-1">
            <Shield class="w-3.5 h-3.5 text-brand" />
            <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('group.admins') }} ({{ admins.length }})
            </span>
          </div>
          <div class="bg-surface-card rounded-2xl border border-border divide-y divide-border/30">
            <div v-for="admin in admins" :key="admin.pubkey"
              class="flex items-center gap-2.5 px-3 py-2">
              <div class="w-7 h-7 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                :style="!getCachedProfile(admin.pubkey)?.picture ? { background: getAvatarColor(admin.pubkey) } : {}">
                <img v-if="getCachedProfile(admin.pubkey)?.picture" :src="getCachedProfile(admin.pubkey).picture" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-[9px] font-bold text-white">{{ (profileName(admin.pubkey)[0] || '?').toUpperCase() }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-xs font-medium truncate block">{{ profileName(admin.pubkey) }}</span>
                <span class="text-[9px] text-text-muted">{{ humanPermissions(admin.permissions) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Invite link -->
      <button v-if="group.type !== 'private' && group.relay"
        @click="copyInviteLink"
        class="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-2xl border border-border hover:border-brand/30 hover:bg-brand/5 transition-all font-medium"
        :class="linkCopied ? 'text-success border-success/30 bg-success/5' : 'text-text-secondary'"
      >
        <component :is="linkCopied ? Check : Link2" class="w-3.5 h-3.5" />
        {{ linkCopied ? t('common.copied') : t('group.copyInviteLink') }}
      </button>

      <!-- Mute / Unmute -->
      <button @click="toggleGroupMute"
        class="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-2xl transition-colors font-medium"
        :class="groupMuted ? 'text-success hover:bg-success/5' : 'text-text-muted hover:bg-surface-elevated'">
        <Volume2 v-if="groupMuted" class="w-3.5 h-3.5" />
        <VolumeX v-else class="w-3.5 h-3.5" />
        {{ groupMuted ? t('group.unmuteGroup') : t('group.muteGroup') }}
      </button>

      <!-- Leave group -->
      <button @click="confirmLeave = true"
        class="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-error hover:bg-error/5 rounded-2xl transition-colors font-medium">
        <LogOut class="w-3.5 h-3.5" />
        {{ t('group.leaveGroup') }}
      </button>
    </div>

    <!-- Leave confirmation -->
    <BottomSheet :open="confirmLeave" variant="danger" @close="confirmLeave = false">
      <template #icon><AlertTriangle class="w-4 h-4 text-warning" /></template>
      <template #title>{{ t('group.leaveConfirm') }}</template>
      <template #description>
        <span v-if="isSoleAdmin" class="text-warning font-semibold block mb-1">{{ t('group.soleAdminWarning') }}</span>
        {{ t('group.leaveConfirmDesc') }}
      </template>
      <template #actions>
        <button @click="confirmLeave = false"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleLeave" :disabled="leaving"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
          <Loader2 v-if="leaving" class="w-3 h-3 animate-spin" />
          {{ t('group.leaveGroup') }}
        </button>
      </template>
    </BottomSheet>

    <!-- Remove member confirmation -->
    <BottomSheet :open="!!removingMember" variant="danger" @close="removingMember = null">
      <template #icon><UserMinus class="w-4 h-4 text-error" /></template>
      <template #title>{{ t('group.removeUser') }}</template>
      <template #description>
        <span v-if="removingMember" class="font-semibold">{{ profileName(removingMember) }}</span>
      </template>
      <template #actions>
        <button @click="removingMember = null"
          class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all font-semibold">
          {{ t('common.cancel') }}
        </button>
        <button @click="handleRemoveMember" :disabled="removingLoading"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all font-semibold disabled:opacity-60 flex items-center justify-center gap-1.5">
          <Loader2 v-if="removingLoading" class="w-3 h-3 animate-spin" />
          {{ removingLoading ? t('group.rotatingKeys') : t('group.removeUser') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
