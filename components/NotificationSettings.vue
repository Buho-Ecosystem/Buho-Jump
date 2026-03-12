<script setup>
/**
 * Notification Settings — full-page overlay with per-category toggles.
 * Follows the same overlay pattern as RelaySettings.
 */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotifications } from '../composables/useNotifications.js'
import { ArrowLeft, Bell, MessageSquare, Wallet } from 'lucide-vue-next'

const emit = defineEmits(['back'])

const { t } = useI18n()
const { settings, loaded, load, toggleDms, togglePayments } = useNotifications()

onMounted(() => { load() })
</script>

<template>
  <div class="space-y-3 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2">
      <button @click="emit('back')" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200" :aria-label="t('common.back')">
        <ArrowLeft class="w-4 h-4 text-text-muted" />
      </button>
      <span class="text-sm font-semibold">{{ t('notifications.title') }}</span>
    </div>

    <!-- Description -->
    <div class="px-1">
      <p class="text-[10px] text-text-muted leading-relaxed">{{ t('notifications.desc') }}</p>
    </div>

    <!-- Toggle list -->
    <div v-if="loaded" class="space-y-1.5">

      <!-- DMs toggle -->
      <div class="flex items-center justify-between px-3 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0">
            <MessageSquare class="w-3.5 h-3.5 text-text-muted" />
          </div>
          <div class="min-w-0">
            <span class="text-xs font-medium block">{{ t('notifications.dms') }}</span>
            <span class="text-[9px] text-text-muted">{{ t('notifications.dmsDesc') }}</span>
          </div>
        </div>
        <button
          @click="toggleDms"
          role="switch"
          :aria-checked="settings.dms"
          :aria-label="t('notifications.dms')"
          class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
          :class="settings.dms ? 'bg-brand' : 'bg-surface-elevated border border-border'"
        >
          <span
            class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
            :class="settings.dms ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </button>
      </div>

      <!-- Payments toggle -->
      <div class="flex items-center justify-between px-3 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0">
            <Wallet class="w-3.5 h-3.5 text-text-muted" />
          </div>
          <div class="min-w-0">
            <span class="text-xs font-medium block">{{ t('notifications.payments') }}</span>
            <span class="text-[9px] text-text-muted">{{ t('notifications.paymentsDesc') }}</span>
          </div>
        </div>
        <button
          @click="togglePayments"
          role="switch"
          :aria-checked="settings.payments"
          :aria-label="t('notifications.payments')"
          class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
          :class="settings.payments ? 'bg-brand' : 'bg-surface-elevated border border-border'"
        >
          <span
            class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
            :class="settings.payments ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </button>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else class="space-y-1.5">
      <div class="skeleton-shimmer h-14 rounded-3xl" />
      <div class="skeleton-shimmer h-14 rounded-3xl" />
    </div>

    <!-- Info footer -->
    <div class="px-1 pt-1">
      <div class="flex items-start gap-2 text-[9px] text-text-muted leading-relaxed">
        <Bell class="w-3 h-3 shrink-0 mt-0.5" />
        <span>{{ t('notifications.hint') }}</span>
      </div>
    </div>
  </div>
</template>
