<script setup>
/**
 * Join or create a NIP-29 group.
 * Two modes: "Join Existing" (relay + group ID) / "Create New" (relay + metadata).
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useToast } from '../../composables/useToast.js'
import { ArrowLeft, Link, Plus, Loader2, Globe, Users } from 'lucide-vue-next'

const emit = defineEmits(['back', 'joined'])
const { t } = useI18n()
const { joinGroup, adminAction } = useGroups()
const toast = useToast()

const mode = ref('join') // 'join' | 'create'
const loading = ref(false)

// Join fields
const joinRelay = ref('')
const joinGroupId = ref('')

// Create fields
const createRelay = ref('')
const createName = ref('')
const createAbout = ref('')
const createOpen = ref(true)

async function handleJoin() {
  const relay = joinRelay.value.trim()
  const groupId = joinGroupId.value.trim()
  if (!relay || !groupId) return

  loading.value = true
  try {
    await joinGroup(groupId, relay)
    toast.success(t('group.accepted'))
    emit('joined', `${groupId}:${relay}`)
  } catch (err) {
    toast.error(err.message || t('group.joinFailed'))
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  const relay = createRelay.value.trim()
  const name = createName.value.trim()
  if (!relay || !name) return

  loading.value = true
  try {
    // NIP-29: to create a group, we send a kind 9002 (edit-metadata) to the relay.
    // The relay creates the group if it doesn't exist (relay-dependent behavior).
    // First join (which fetches metadata — will be empty for new group), then set metadata.
    const groupId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 48)
    await joinGroup(groupId, relay)
    await adminAction(groupId, relay, {
      type: 'edit-metadata',
      name,
      about: createAbout.value.trim() || undefined,
    })
    toast.success(t('group.accepted'))
    emit('joined', `${groupId}:${relay}`)
  } catch (err) {
    toast.error(err.message || t('group.joinFailed'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full animate-slide-in-right">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 border-b border-border shrink-0">
      <button @click="emit('back')" class="p-1 rounded-full hover:bg-surface-elevated transition-all duration-200">
        <ArrowLeft class="w-5 h-5 text-text-secondary" />
      </button>
      <span class="text-[14px] font-semibold">{{ t('group.title') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">

      <!-- Mode toggle -->
      <div class="flex bg-surface-card rounded-2xl border border-border p-0.5">
        <button
          @click="mode = 'join'"
          class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
          :class="mode === 'join' ? 'bg-brand text-surface-base' : 'text-text-muted hover:text-text-secondary'"
        >
          <Link class="w-3.5 h-3.5" />
          {{ t('group.joinExisting') }}
        </button>
        <button
          @click="mode = 'create'"
          class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
          :class="mode === 'create' ? 'bg-brand text-surface-base' : 'text-text-muted hover:text-text-secondary'"
        >
          <Plus class="w-3.5 h-3.5" />
          {{ t('group.createNew') }}
        </button>
      </div>

      <!-- Join existing -->
      <template v-if="mode === 'join'">
        <div class="flex flex-col items-center gap-2 py-2">
          <Users class="w-10 h-10 text-brand" />
          <p class="text-xs text-text-muted text-center">{{ t('group.noGroupsDesc') }}</p>
        </div>

        <div class="space-y-3">
          <div class="space-y-1">
            <label class="text-[10px] text-text-muted font-semibold uppercase tracking-wider px-1">{{ t('group.groupRelay') }}</label>
            <input v-model="joinRelay" placeholder="wss://groups.example.com"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />
            <p class="text-[9px] text-text-muted px-1">{{ t('group.groupRelayHint') }}</p>
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-text-muted font-semibold uppercase tracking-wider px-1">{{ t('group.groupId') }}</label>
            <input v-model="joinGroupId" :placeholder="t('group.groupId')"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
            <p class="text-[9px] text-text-muted px-1">{{ t('group.groupIdHint') }}</p>
          </div>
        </div>

        <button @click="handleJoin" :disabled="!joinRelay.trim() || !joinGroupId.trim() || loading"
          class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <Globe v-else class="w-4 h-4" />
          {{ loading ? t('group.joining') : t('group.joinGroup') }}
        </button>
      </template>

      <!-- Create new -->
      <template v-else>
        <div class="space-y-3">
          <div class="space-y-1">
            <label class="text-[10px] text-text-muted font-semibold uppercase tracking-wider px-1">{{ t('group.groupRelay') }}</label>
            <input v-model="createRelay" placeholder="wss://groups.example.com"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors font-mono placeholder:text-text-muted" />
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-text-muted font-semibold uppercase tracking-wider px-1">{{ t('group.groupName') }}</label>
            <input v-model="createName" :placeholder="t('group.groupName')"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-text-muted font-semibold uppercase tracking-wider px-1">{{ t('group.groupAbout') }}</label>
            <textarea v-model="createAbout" :placeholder="t('group.groupAbout')" rows="2"
              class="w-full bg-surface-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors resize-none placeholder:text-text-muted" />
          </div>
        </div>

        <button @click="handleCreate" :disabled="!createRelay.trim() || !createName.trim() || loading"
          class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-brand text-surface-base text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-all btn-primary">
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <Plus v-else class="w-4 h-4" />
          {{ loading ? t('group.creating') : t('group.createGroup') }}
        </button>
      </template>
    </div>
  </div>
</template>
