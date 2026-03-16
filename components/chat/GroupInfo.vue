<script setup>
/**
 * Group info panel — metadata, members, admins, admin actions, leave.
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
  UserPlus, UserMinus, Pencil, Trash2,
  Loader2, AlertTriangle, LogOut,
} from 'lucide-vue-next'

const props = defineProps({
  groupKey: { type: String, required: true },
})

const emit = defineEmits(['back'])
const { t } = useI18n()
const { groups, fetchGroupInfo, leaveGroup, adminAction, inviteUser, currentAccountPubkey } = useGroups()
const { getCachedProfile, fetchProfiles } = useContacts()
const toast = useToast()

const [gId, gRelay] = props.groupKey.split(':')
const group = computed(() => groups.value.find(g => g.id === gId && g.relay === gRelay) || { id: gId, relay: gRelay, name: gId })

const members = ref([])
const admins = ref([])
const loadingInfo = ref(true)
const confirmLeave = ref(false)
const leaving = ref(false)

const isAdmin = computed(() =>
  admins.value.some(a => a.pubkey === currentAccountPubkey.value)
)

onMounted(async () => {
  try {
    const info = await fetchGroupInfo(gId, gRelay)
    members.value = info.members || []
    admins.value = info.admins || []
    // Batch-fetch profiles
    const allPubkeys = [...new Set([...members.value, ...admins.value.map(a => a.pubkey)])]
    const uncached = allPubkeys.filter(pk => !getCachedProfile(pk))
    if (uncached.length > 0) await fetchProfiles(uncached)
  } catch { /* relay error */ }
  finally { loadingInfo.value = false }
})

async function handleLeave() {
  leaving.value = true
  try {
    await leaveGroup(gId, gRelay)
    toast.info(t('group.leaveGroup'))
    emit('back')
  } catch {
    toast.error(t('group.leaveFailed'))
  } finally {
    leaving.value = false
    confirmLeave.value = false
  }
}

function profileName(pubkey) {
  const p = getCachedProfile(pubkey)
  return p?.display_name || p?.name || pubkey.slice(0, 12) + '...'
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
          :style="!group.picture ? { background: getAvatarColor(group.id) } : {}">
          <img v-if="group.picture" :src="group.picture" alt="" class="w-full h-full object-cover" />
          <Users v-else class="w-7 h-7 text-white" />
        </div>
        <h2 class="text-sm font-extrabold">{{ group.name || group.id }}</h2>
        <p v-if="group.about" class="text-xs text-text-muted mt-1 line-clamp-3 leading-relaxed">{{ group.about }}</p>
        <div class="flex items-center justify-center gap-2 mt-2">
          <span class="text-[9px] px-2 py-0.5 rounded-full font-semibold"
            :class="group.isOpen ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'">
            {{ group.isOpen ? t('group.openGroup') : t('group.closedGroup') }}
          </span>
          <span class="text-[9px] px-2 py-0.5 rounded-full font-semibold"
            :class="group.isPublic ? 'bg-info/10 text-info' : 'bg-text-muted/10 text-text-muted'">
            {{ group.isPublic ? t('group.publicGroup') : t('group.privateGroup') }}
          </span>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loadingInfo" class="space-y-2">
        <div v-for="i in 4" :key="i" class="skeleton-shimmer h-10 rounded-2xl" />
      </div>

      <template v-else>
        <!-- Members -->
        <div class="space-y-2">
          <div class="flex items-center gap-1.5 px-1">
            <Users class="w-3.5 h-3.5 text-text-muted" />
            <span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
              {{ t('group.memberList') }} ({{ members.length }})
            </span>
          </div>
          <div class="bg-surface-card rounded-2xl border border-border divide-y divide-border/30 max-h-48 overflow-y-auto">
            <div v-for="pk in members" :key="pk"
              class="flex items-center gap-2.5 px-3 py-2">
              <div class="w-7 h-7 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                :style="{ background: getCachedProfile(pk)?.picture ? '' : getAvatarColor(pk) }">
                <img v-if="getCachedProfile(pk)?.picture" :src="getCachedProfile(pk).picture" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-[9px] font-bold text-white">{{ profileName(pk)[0].toUpperCase() }}</span>
              </div>
              <span class="text-xs font-medium truncate flex-1">{{ profileName(pk) }}</span>
              <Shield v-if="admins.some(a => a.pubkey === pk)" class="w-3 h-3 text-brand shrink-0" />
            </div>
          </div>
        </div>

        <!-- Admins -->
        <div v-if="admins.length > 0" class="space-y-2">
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
                :style="{ background: getCachedProfile(admin.pubkey)?.picture ? '' : getAvatarColor(admin.pubkey) }">
                <img v-if="getCachedProfile(admin.pubkey)?.picture" :src="getCachedProfile(admin.pubkey).picture" alt="" class="w-full h-full object-cover" />
                <span v-else class="text-[9px] font-bold text-white">{{ profileName(admin.pubkey)[0].toUpperCase() }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-xs font-medium truncate block">{{ profileName(admin.pubkey) }}</span>
                <span v-if="admin.permissions.length > 0" class="text-[9px] text-text-muted">
                  {{ admin.permissions.join(', ') }}
                </span>
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
      <template #description>{{ t('group.leaveConfirmDesc') }}</template>
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
  </div>
</template>
