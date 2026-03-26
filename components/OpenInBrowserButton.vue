<script setup>
/**
 * Small "open in full tab" icon button.
 * Opens the options page with optional deep-link to a specific section.
 */
import { ExternalLink } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps({ page: { type: String, default: '' } })

function openOptions() {
  const url = chrome.runtime.getURL(`options.html${props.page ? '?page=' + props.page : ''}`)
  chrome.tabs.create({ url })
}
</script>

<template>
  <button
    @click.stop="openOptions"
    class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200"
    :title="t('options.openInTab')"
    :aria-label="t('options.openInTab')"
  >
    <ExternalLink class="w-3 h-3 text-text-muted hover:text-brand transition-all duration-200" />
  </button>
</template>
