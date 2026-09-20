<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { User } from 'lucide-vue-next'
import { accountProfile } from '../lib/accountProfile.js'
import { truncateKey } from '../lib/utils.js'

const props = defineProps({ account: { type: Object, required: true } })
const { t } = useI18n()
const failed = ref(false)
const profile = computed(() => accountProfile(props.account.profile))
const name = computed(() => profile.value?.display_name || profile.value?.name || props.account.name || t('prompt.yourAccount'))
watch(() => profile.value?.picture, () => { failed.value = false })
</script>

<template>
  <div class="flex items-center gap-3 min-w-0 text-left">
    <div class="w-10 h-10 rounded-full bg-surface-elevated flex items-center justify-center overflow-hidden shrink-0">
      <img v-if="profile?.picture && !failed" :src="profile.picture" @error="failed = true" referrerpolicy="no-referrer" alt="" class="w-full h-full object-cover" />
      <span v-else-if="profile?.name || profile?.display_name || account.name" class="text-sm font-bold">{{ Array.from(name)[0].toUpperCase() }}</span>
      <User v-else class="w-5 h-5 text-text-secondary" />
    </div>
    <div class="min-w-0">
      <p class="text-sm font-semibold truncate">{{ name }}</p>
      <p v-if="profile?.nip05" class="text-xs text-text-secondary truncate">{{ profile.nip05 }}</p>
      <p v-if="account.npub" class="text-xs text-text-secondary font-mono" :title="account.npub">{{ truncateKey(account.npub, 12, 8) }}</p>
      <p v-if="account.mode === 'nip46'" class="text-xs text-text-secondary">{{ t('account.externalSigner') }}</p>
    </div>
  </div>
</template>
