<script setup>
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
const { t } = useI18n()
</script>
<template>
  <button type="button" :aria-label="t('common.back')" class="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-elevated active:bg-surface-hover">
    <ArrowLeft class="w-4 h-4" />
  </button>
</template>
