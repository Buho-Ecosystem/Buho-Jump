<script setup>
/**
 * Reusable error/warning/info banner with optional retry action.
 *
 * Usage:
 *   <ErrorBanner type="error" :message="t('wallet.disconnected')" @retry="reconnect" />
 *   <ErrorBanner type="warning" :message="msg" dismissable @dismiss="clearError" />
 */
import { AlertTriangle, Info, XCircle, X, RefreshCw } from 'lucide-vue-next'

const props = defineProps({
  type: { type: String, default: 'error', validator: v => ['error', 'warning', 'info'].includes(v) },
  message: { type: String, required: true },
  dismissable: { type: Boolean, default: false },
  retryLabel: { type: String, default: '' },
})

defineEmits(['dismiss', 'retry'])

const styles = {
  error:   'bg-error/10 border-error/20 text-error',
  warning: 'bg-warning/10 border-warning/20 text-warning',
  info:    'bg-brand/8 border-brand/15 text-brand',
}

const icons = { error: XCircle, warning: AlertTriangle, info: Info }
</script>

<template>
  <div
    :class="['flex items-center gap-2 px-3 py-2 rounded-2xl border text-[11px] animate-fade-in-up', styles[type]]"
    role="alert"
  >
    <component :is="icons[type]" class="w-3.5 h-3.5 shrink-0" />
    <span class="flex-1 min-w-0">{{ message }}</span>
    <button
      v-if="retryLabel"
      @click="$emit('retry')"
      class="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-white/10 transition-colors font-medium"
    >
      <RefreshCw class="w-3 h-3" />
      {{ retryLabel }}
    </button>
    <button
      v-if="dismissable"
      @click="$emit('dismiss')"
      class="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
      :aria-label="'Dismiss'"
    >
      <X class="w-3 h-3" />
    </button>
  </div>
</template>
