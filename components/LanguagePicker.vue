<script setup>
/**
 * Language picker — grid of language buttons.
 * Used in first-launch screen and settings dropdown.
 */
import { useLocale } from '../composables/useLocale.js'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'

const props = defineProps({
  /** Compact mode for settings dropdown */
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])
const { locale, locales, switchLocale } = useLocale()
const { t } = useI18n()

async function pick(code) {
  await switchLocale(code)
  emit('select', code)
}
</script>

<template>
  <div :class="compact ? 'space-y-0.5' : 'space-y-3'">
    <p v-if="!compact" class="text-xs text-text-muted text-center">
      {{ t('settings.language') }}
    </p>

    <div :class="compact
      ? 'max-h-[260px] overflow-y-auto space-y-0.5'
      : 'grid grid-cols-2 gap-1.5'"
    >
      <button
        v-for="lang in locales"
        :key="lang.code"
        @click="pick(lang.code)"
        class="flex items-center gap-2 text-left transition-colors rounded-lg"
        :class="[
          compact
            ? 'px-3 py-2 text-xs hover:bg-surface-elevated w-full'
            : 'px-3 py-2.5 text-sm hover:bg-surface-elevated border border-transparent',
          locale === lang.code
            ? 'bg-brand/10 text-brand font-semibold border-brand/20'
            : 'text-text-secondary'
        ]"
      >
        <span class="flex-1">{{ lang.native }}</span>
        <Check
          v-if="locale === lang.code"
          class="w-3.5 h-3.5 text-brand shrink-0"
        />
      </button>
    </div>
  </div>
</template>
