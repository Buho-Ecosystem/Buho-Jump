<script setup>
/**
 * Group info panel — metadata, members, admins, admin actions, leave.
 * Adapts to group type: private (local members), relay (NIP-29), channel (NIP-28).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useToast } from '../../composables/useToast.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import BottomSheet from '../BottomSheet.vue'
import {
  ArrowLeft, Users, Shield, Globe, Lock,
  UserPlus, UserMinus, Pencil, RefreshCw,
  Loader2, AlertTriangle, LogOut, AlertCircle,
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
const { getCachedProfile, fetchProfiles, resolveInput } = useContacts()
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

// Remove member state
const removingMember = ref(null)

const isAdmin = computed(() =>
  admins.value.some(a => a.pubkey === currentAccountPubkey.value)
)

const isSoleAdmin = computed(() =>
  isAdmin.value && admins.value.length === 1
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

async function handleInvite() {
  const val = inviteInput.value.trim()
  if (!val) return
  inviting.value = true
  try {
    const g = group.value
    if (g.type === 'private') {
      const pubkey = await resolveInput(val)
      if (!pubkey) { toast.error(t('chat.resolveNotFound')); return }
      addMemberToPrivateGroup(g.id, pubkey)
      members.value = [...(g.members || [])]
      toast.success(t('group.userInvited'))
    } else if (g.type === 'relay') {
      const pubkey = await resolveInput(val)
      if (!pubkey) { toast.error(t('chat.resolveNotFound')); return }
      await inviteUser(g.id, g.relay, pubkey)
      toast.success(t('group.userInvited'))
    }
    inviteInput.value = ''
    showInvite.value = false
  } catch (err) {
    toast.error(err.message || t('group.joinFailed'))
  } finally {
    inviting.value = false
  }
}

async function handleRemoveMember() {
  if (!removingMember.value) return
  const g = group.value
  try {
    if (g.type === 'private') {
      removeMemberFromPrivateGroup(g.id, removingMember.value)
      members.value = members.value.filter(pk => pk !== removingMember.value)
    } else if (g.type === 'relay') {
      await adminAction(g.id, g.relay, { type: 'remove-user', pubkey: removingMember.value })
    }
    toast.success(t('group.userRemoved'))
  } catch (err) {
    toast.error(err.message || t('group.leaveFailed'))
  } finally {
    removingMember.value = null
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

        <!-- Badges for relay groups -->
        <div v-if="group.type === 'relay'" class="flex items-center justify-center gap-2 mt-2">
          <span class="text-[9px] px-2 py-0.5 rounded-full font-semibold"
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

          <!-- Invite input -->
          <div v-else class="bg-surface-card rounded-2xl border border-border p-3 space-y-2">
            <p class="text-[10px] text-text-muted">{{ t('group.inviteUserDesc') }}</p>
            <input v-model="inviteInput"
              :placeholder="t('chat.inputHint')"
              class="w-full bg-surface-base border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
            <div class="flex gap-2">
              <button @click="showInvite = false; inviteInput = ''"
                class="flex-1 py-2 text-xs rounded-xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all font-semibold">
                {{ t('common.cancel') }}
              </button>
              <button @click="handleInvite" :disabled="!inviteInput.trim() || inviting"
                class="flex-1 py-2 text-xs rounded-xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 transition-all font-semibold btn-primary flex items-center justify-center gap-1">
                <Loader2 v-if="inviting" class="w-3 h-3 animate-spin" />
                {{ t('group.inviteUser') }}
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
        <button @click="handleRemoveMember"
          class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all font-semibold">
          {{ t('group.removeUser') }}
        </button>
      </template>
    </BottomSheet>
  </div>
</template>
