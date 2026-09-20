<script setup>
import ToggleSwitch from './ToggleSwitch.vue'
import BackButton from './BackButton.vue'
/**
 * Notification Settings — full-page overlay with per-category toggles,
 * DND toggle, and quiet hours configuration.
 */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotifications } from '../composables/useNotifications.js'
import { ArrowLeft, Bell, MessageSquare, Wallet, MoonStar, Clock } from 'lucide-vue-next'

defineProps({ hideBack: Boolean })
const emit = defineEmits(['back'])

const { t } = useI18n()
const {
  settings, loaded, load,
  toggleDms, togglePayments,
  toggleDnd, toggleQuietHours,
  setQuietStart, setQuietEnd,
} = useNotifications()

onMounted(() => { load() })
</script>

<template>
  <div class="space-y-3 animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-2">
      <BackButton v-if="!hideBack" @click="emit('back')" />
      <span class="text-sm font-semibold">{{ t('notifications.title') }}</span>
    </div>

    <!-- Description -->
    <div class="px-1">
      <p class="text-xs text-text-muted leading-relaxed">{{ t('notifications.desc') }}</p>
    </div>

    <!-- Toggle list -->
    <div v-if="loaded" class="space-y-3">

      <!-- ── Categories ── -->
      <div class="space-y-1.5">
        <h3 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('notifications.categories') }}</h3>

        <!-- DMs toggle -->
        <div class="flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-3xl border border-border shadow-sm">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0">
              <MessageSquare class="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div class="min-w-0">
              <span class="text-xs font-medium block">{{ t('notifications.dms') }}</span>
              <span class="text-xs text-text-muted">{{ t('notifications.dmsDesc') }}</span>
            </div>
          </div>
          <ToggleSwitch :model-value="settings.dms" :label="t('notifications.dms')" @update:model-value="toggleDms" />
        </div>

        <!-- Payments toggle -->
        <div class="flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-3xl border border-border shadow-sm">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0">
              <Wallet class="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div class="min-w-0">
              <span class="text-xs font-medium block">{{ t('notifications.payments') }}</span>
              <span class="text-xs text-text-muted">{{ t('notifications.paymentsDesc') }}</span>
            </div>
          </div>
          <ToggleSwitch :model-value="settings.payments" :label="t('notifications.payments')" @update:model-value="togglePayments" />
        </div>
      </div>

      <!-- ── Schedule ── -->
      <div class="space-y-1.5">
        <h3 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('notifications.schedule') }}</h3>

        <!-- DND toggle -->
        <div class="flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-3xl border shadow-sm"
          :class="settings.dnd ? 'border-warning/30 bg-warning/5' : 'border-border'">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              :class="settings.dnd ? 'bg-warning/15' : 'bg-surface-elevated border border-border'">
              <MoonStar class="w-3.5 h-3.5" :class="settings.dnd ? 'text-warning' : 'text-text-muted'" />
            </div>
            <div class="min-w-0">
              <span class="text-xs font-medium block">{{ t('notifications.dnd') }}</span>
              <span class="text-xs text-text-muted">{{ t('notifications.dndDesc') }}</span>
            </div>
          </div>
          <ToggleSwitch :model-value="settings.dnd" :label="t('notifications.dnd')" @update:model-value="toggleDnd" />
        </div>

        <!-- Quiet hours toggle + time pickers -->
        <div class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden">
          <div class="flex items-center justify-between px-3 py-2.5">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div class="w-8 h-8 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0">
                <Clock class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div class="min-w-0">
                <span class="text-xs font-medium block">{{ t('notifications.quietHours') }}</span>
                <span class="text-xs text-text-muted">{{ t('notifications.quietHoursDesc') }}</span>
              </div>
            </div>
            <ToggleSwitch :model-value="settings.quietHours" :label="t('notifications.quietHours')" @update:model-value="toggleQuietHours" />
          </div>

          <!-- Time range picker — only visible when quiet hours enabled -->
          <div v-if="settings.quietHours" class="px-3 pb-3 pt-1 border-t border-border/50">
            <div class="flex items-center gap-2">
              <div class="flex-1 space-y-0.5">
                <label class="text-xs uppercase tracking-widest text-text-muted font-semibold">{{ t('notifications.quietStart') }}</label>
                <input :aria-label="t('notifications.quietStart')" type="time" :value="settings.quietStart" @change="setQuietStart($event.target.value)"
                  class="w-full bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand transition-colors font-mono" />
              </div>
              <span class="text-text-muted text-xs mt-3">—</span>
              <div class="flex-1 space-y-0.5">
                <label class="text-xs uppercase tracking-widest text-text-muted font-semibold">{{ t('notifications.quietEnd') }}</label>
                <input :aria-label="t('notifications.quietEnd')" type="time" :value="settings.quietEnd" @change="setQuietEnd($event.target.value)"
                  class="w-full bg-surface-elevated border border-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-brand transition-colors font-mono" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else class="space-y-1.5">
      <div class="skeleton-shimmer h-14 rounded-3xl" />
      <div class="skeleton-shimmer h-14 rounded-3xl" />
      <div class="skeleton-shimmer h-14 rounded-3xl" />
    </div>

    <!-- Info footer -->
    <div class="px-1 pt-1">
      <div class="flex items-start gap-2 text-xs text-text-muted leading-relaxed">
        <Bell class="w-3 h-3 shrink-0 mt-0.5" />
        <span>{{ t('notifications.hint') }}</span>
      </div>
    </div>
  </div>
</template>
