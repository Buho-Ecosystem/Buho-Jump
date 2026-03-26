<script setup>
/**
 * Report dialog — report a user or message for abuse.
 * Shows report type dropdown + optional reason, with block option.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '../../composables/useToast.js'
import { useMessaging } from '../../composables/useMessaging.js'
import { useMuteList } from '../../composables/useMuteList.js'
import { Flag, ShieldX, X, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
const toast = useToast()
const { send } = useMessaging()
const { mute } = useMuteList()

const props = defineProps({
  pubkey: { type: String, required: true },
  messageId: { type: String, default: '' },
})

const emit = defineEmits(['close'])

const reportType = ref('spam')
const reason = ref('')
const alsoBlock = ref(true)
const submitting = ref(false)

const reportTypes = computed(() => [
  { value: 'spam', label: t('chat.reportSpam') },
  { value: 'impersonation', label: t('chat.reportImpersonation') },
  { value: 'nudity', label: t('chat.reportNudity') },
  { value: 'illegal', label: t('chat.reportIllegal') },
  { value: 'other', label: t('chat.reportOther') },
])

async function submit() {
  submitting.value = true
  try {
    await send('REPORT_EVENT', props.messageId || null, props.pubkey, reportType.value, reason.value.trim())

    if (alsoBlock.value) {
      mute(props.pubkey)
    }

    toast.success(t('chat.reportSent'))
    emit('close')
  } catch {
    toast.error(t('chat.reportFailed'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="animate-fade-in-up space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Flag class="w-4 h-4 text-warning" />
        <h3 class="text-sm font-extrabold">{{ t('chat.reportTitle') }}</h3>
      </div>
      <button @click="emit('close')" :aria-label="t('common.close')"
        class="p-1 rounded-md hover:bg-surface-elevated transition-colors">
        <X class="w-4 h-4 text-text-muted" />
      </button>
    </div>

    <!-- Report type -->
    <div class="space-y-1.5">
      <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
        {{ t('chat.reportType') }}
      </label>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="rt in reportTypes" :key="rt.value"
          @click="reportType = rt.value"
          class="px-3 py-2 rounded-xl text-xs font-medium transition-all text-left"
          :class="reportType === rt.value
            ? 'bg-warning/10 border border-warning/30 text-warning'
            : 'bg-surface-card border border-border text-text-secondary hover:border-warning/20'"
        >
          {{ rt.label }}
        </button>
      </div>
    </div>

    <!-- Reason -->
    <div class="space-y-1.5">
      <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
        {{ t('chat.reportReason') }} <span class="normal-case tracking-normal text-text-muted/60">{{ t('common.optional') }}</span>
      </label>
      <textarea v-model="reason" rows="2" maxlength="500"
        :placeholder="t('chat.reportReasonPlaceholder')"
        class="w-full bg-surface-base border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-warning transition-colors resize-none placeholder:text-text-muted/50" />
    </div>

    <!-- Block toggle -->
    <label class="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-card border border-border cursor-pointer">
      <input type="checkbox" v-model="alsoBlock"
        class="w-4 h-4 rounded border-border text-warning accent-[var(--semantic-warning)]" />
      <div>
        <span class="text-xs font-semibold">{{ t('chat.alsoBlock') }}</span>
        <p class="text-[10px] text-text-muted">{{ t('chat.alsoBlockDesc') }}</p>
      </div>
    </label>

    <!-- Actions -->
    <div class="grid grid-cols-2 gap-2">
      <button @click="emit('close')"
        class="py-2.5 text-xs rounded-2xl bg-surface-card border border-border text-text-secondary font-semibold hover:bg-surface-elevated transition-all">
        {{ t('common.cancel') }}
      </button>
      <button @click="submit" :disabled="submitting"
        class="py-2.5 text-xs rounded-2xl bg-warning text-white font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-1.5">
        <Loader2 v-if="submitting" class="w-3 h-3 animate-spin" />
        <ShieldX v-else class="w-3 h-3" />
        {{ t('chat.submitReport') }}
      </button>
    </div>
  </div>
</template>
