<script setup>
/**
 * Invitation banner — shows at top of ChatHome when pending group invitations exist.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useToast } from '../../composables/useToast.js'
import { Users, ChevronDown, Check, X, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const { invitations, acceptInvitation, declineInvitation } = useGroups()
const { getCachedProfile } = useContacts()
const toast = useToast()

const expanded = ref(false)
const processing = ref(null) // groupId:relay being processed

function inviterName(pubkey) {
  const p = getCachedProfile(pubkey)
  return p?.display_name || p?.name || pubkey.slice(0, 12) + '...'
}

async function handleAccept(inv) {
  processing.value = `${inv.groupId}:${inv.relay}`
  try {
    await acceptInvitation(inv.groupId, inv.relay)
    toast.success(t('group.accepted'))
  } catch {
    toast.error(t('group.joinFailed'))
  } finally {
    processing.value = null
  }
}

function handleDecline(inv) {
  declineInvitation(inv.groupId, inv.relay)
  toast.info(t('group.declined'))
}
</script>

<template>
  <div v-if="invitations.length > 0" class="mx-3 mb-2">
    <button @click="expanded = !expanded"
      class="w-full flex items-center gap-2 px-3 py-2 rounded-2xl bg-brand/8 border border-brand/15 text-xs font-semibold text-brand hover:bg-brand/12 transition-all">
      <Users class="w-3.5 h-3.5" />
      {{ t('group.invitations', { count: invitations.length }) }}
      <ChevronDown class="w-3 h-3 ml-auto transition-transform duration-200" :class="expanded ? 'rotate-180' : ''" />
    </button>

    <div v-if="expanded" class="mt-1 space-y-1">
      <div v-for="inv in invitations" :key="`${inv.groupId}:${inv.relay}`"
        class="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card border border-border">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-semibold truncate">{{ inv.groupId }}</div>
          <div class="text-[10px] text-text-muted truncate">
            {{ t('group.invitationDesc', { inviter: inviterName(inv.inviterPubkey) }) }}
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button @click="handleAccept(inv)" :disabled="!!processing"
            class="p-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 transition-colors disabled:opacity-50">
            <Loader2 v-if="processing === `${inv.groupId}:${inv.relay}`" class="w-3.5 h-3.5 text-brand animate-spin" />
            <Check v-else class="w-3.5 h-3.5 text-brand" />
          </button>
          <button @click="handleDecline(inv)" :disabled="!!processing"
            class="p-1.5 rounded-lg hover:bg-error/10 transition-colors disabled:opacity-50">
            <X class="w-3.5 h-3.5 text-text-muted" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
