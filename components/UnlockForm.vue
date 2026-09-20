<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-vue-next'
const props = defineProps({ origin: { type: String, default: '' }, error: { type: String, default: '' }, loading: Boolean, dismissible: Boolean })
const emit = defineEmits(['submit', 'cancel'])
const { t } = useI18n()
const password = ref('')
const visible = ref(false)
const input = ref(null)
onMounted(() => input.value?.focus())
function submit() { if (password.value && !props.loading) emit('submit', password.value) }
</script>
<template>
  <form @submit.prevent="submit" class="unlock-form">
    <div class="unlock-content space-y-4">
      <Lock class="w-8 h-8 text-brand" />
      <h1 class="text-xl font-bold">{{ t('prompt.lockedTitle') }}</h1>
      <p class="text-sm text-text-secondary">{{ t('prompt.lockedDesc') }}</p>
      <p v-if="origin" class="text-sm break-all" dir="ltr">{{ origin }}</p>
      <label class="block text-sm font-semibold">
        {{ t('lock.enterPassword') }}
        <span class="relative block mt-2">
          <input ref="input" v-model="password" :type="visible ? 'text' : 'password'" autocomplete="current-password" :disabled="loading" class="w-full pl-3 pr-12 py-3 rounded-xl bg-surface-card border border-border text-sm" />
          <button type="button" @click="visible = !visible" :aria-label="visible ? t('prompt.hidePassword') : t('prompt.showPassword')" class="absolute right-1 top-1 w-10 h-10 flex items-center justify-center">
            <EyeOff v-if="visible" class="w-4 h-4" /><Eye v-else class="w-4 h-4" />
          </button>
        </span>
      </label>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    </div>
    <footer class="unlock-actions">
      <button type="submit" :disabled="!password || loading" class="unlock-button bg-brand text-surface-base font-semibold disabled:opacity-50">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />{{ t('lock.unlock') }}
      </button>
      <button v-if="dismissible" type="button" @click="emit('cancel')" :disabled="loading" class="unlock-button text-text-secondary">{{ t('common.cancel') }}</button>
    </footer>
  </form>
</template>
<style scoped>
.unlock-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.unlock-content { flex: 1; min-height: 0; overflow-y: auto; padding: 24px; }
.unlock-actions { flex: none; display: grid; gap: 8px; padding: 12px 24px 16px; border-top: 1px solid var(--border); }
.unlock-button { width: 100%; min-height: 44px; padding: 10px 12px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; line-height: 1.3; }
</style>
