<script setup>
/**
 * Preferences page — flat layout combining appearance, notifications, and security.
 * Grouped visually with section headers (Alby-style flat settings page).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../../composables/useTheme.js'
import { useLocale } from '../../composables/useLocale.js'
import { useFiat, CURRENCIES } from '../../composables/useFiat.js'
import { useNotifications } from '../../composables/useNotifications.js'
import { useLock } from '../../composables/useLock.js'
import { useToast } from '../../composables/useToast.js'
import LanguagePicker from '../LanguagePicker.vue'
import {
  Sun, Moon, Check, Languages, Coins, Bell, MessageSquare,
  Wallet, Lock, Clock, Eye, EyeOff, Loader2, KeyRound, MoonStar,
  BadgeCheck,
} from 'lucide-vue-next'

const { t } = useI18n()
const { currentTheme, currentMode, themes, themeIds, setTheme, toggleMode } = useTheme()
const { locale, locales, switchLocale } = useLocale()
const { currency: fiatCurrency, setCurrency: setFiatCurrency } = useFiat()
const {
  settings: notifSettings, loaded: notifLoaded, load: loadNotif,
  toggleDms, togglePayments,
  toggleDnd, toggleQuietHours, setQuietStart, setQuietEnd,
} = useNotifications()
const { lock, changePassword, setAutoLock: saveAutoLock } = useLock()
const toast = useToast()

const showLanguagePicker = ref(false)
const showCurrencyPicker = ref(false)

// Auto-lock
const autoLockMinutes = ref(0)
const brantaEnabled = ref(true)
const autoLockOptions = [1, 5, 15, 30, 0] // 0 = never

// Password change
const showPasswordChange = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')
const changingPassword = ref(false)
const showOldPw = ref(false)
const showNewPw = ref(false)

const newPwStrength = computed(() => {
  const p = newPassword.value
  if (!p || p.length < 12) return { label: t('lock.strengthTooShort'), level: 0, color: 'bg-error' }
  let score = 0
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 1) return { label: t('lock.strengthWeak'), level: 1, color: 'bg-warning' }
  if (score === 2) return { label: t('lock.strengthFair'), level: 2, color: 'bg-brand' }
  return { label: t('lock.strengthStrong'), level: 3, color: 'bg-success' }
})

onMounted(async () => {
  loadNotif()
  try {
    const data = await chrome.storage.local.get(['autoLockMinutes', 'brantaEnabled'])
    autoLockMinutes.value = data.autoLockMinutes ?? 0
    brantaEnabled.value = data.brantaEnabled !== false
  } catch {}
})

async function setAutoLock(minutes) {
  try {
    await saveAutoLock(minutes)
    autoLockMinutes.value = minutes
  } catch {
    toast.error(t('common.error'))
  }
}

async function toggleBranta() {
  brantaEnabled.value = !brantaEnabled.value
  await chrome.storage.local.set({ brantaEnabled: brantaEnabled.value })
}

async function handleChangePassword() {
  if (newPassword.value !== confirmNewPassword.value) return
  if (!oldPassword.value || !newPassword.value) return
  changingPassword.value = true
  try {
    await changePassword(oldPassword.value, newPassword.value)
    toast.success(t('options.passwordChanged'))
    showPasswordChange.value = false
    oldPassword.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
  } catch (err) {
    const message = err.message || ''
    if (message.startsWith('TOO_MANY_ATTEMPTS:')) {
      toast.error(t('lock.tooManyAttempts', { seconds: message.split(':')[1] }))
    } else if (message === 'errors.WRONG_PASSWORD') {
      toast.error(t('lock.wrongPassword'))
    } else {
      toast.error(message || t('common.error'))
    }
  } finally {
    changingPassword.value = false
  }
}

function handleLock() {
  lock()
}
</script>

<template>
  <div class="space-y-8 max-w-lg">
    <!-- Header -->
    <div>
      <h1 class="text-lg font-extrabold">{{ t('options.preferences') }}</h1>
      <p class="text-xs text-text-muted mt-0.5">{{ t('options.preferencesDesc') }}</p>
    </div>

    <!-- ═══ APPEARANCE ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.appearance') }}</h2>

      <!-- Mode toggle -->
      <button @click="toggleMode"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Sun v-if="currentMode === 'dark'" class="w-4 h-4 text-warning" />
          <Moon v-else class="w-4 h-4 text-info" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ currentMode === 'dark' ? t('settings.lightMode') : t('settings.darkMode') }}</span>
          <span class="text-[10px] text-text-muted">{{ currentMode === 'dark' ? t('settings.currentlyDark') : t('settings.currentlyLight') }}</span>
        </div>
      </button>

      <!-- Theme cards -->
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="id in themeIds"
          :key="id"
          @click="setTheme(id)"
          class="flex flex-col items-center gap-2 px-3 py-3 rounded-3xl border shadow-sm transition-all duration-200"
          :class="currentTheme === id
            ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
            : 'border-border bg-surface-card hover:border-brand/20'"
        >
          <div class="flex items-center gap-1">
            <span class="w-5 h-5 rounded-full border border-border/50"
              :style="{ background: themes[id]?.dark?.['brand-primary'] || 'var(--text-muted)' }" />
            <span class="w-5 h-5 rounded-full border border-border/50"
              :style="{ background: themes[id]?.light?.['brand-primary'] || 'var(--text-muted)' }" />
          </div>
          <span class="text-[10px] font-medium text-center leading-tight"
            :class="currentTheme === id ? 'text-brand' : 'text-text-secondary'">
            {{ themes[id]?.label }}
          </span>
          <Check v-if="currentTheme === id" class="w-3 h-3 text-brand" />
        </button>
      </div>
    </section>

    <!-- ═══ PAYMENT SAFETY ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.paymentSafety') }}</h2>
      <div class="flex items-center justify-between px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-[10px] bg-success/10 flex items-center justify-center shrink-0">
            <BadgeCheck class="w-4 h-4 text-success" />
          </div>
          <div class="min-w-0">
            <span class="text-sm font-medium block">{{ t('settings.brantaVerification') }}</span>
            <span class="text-[10px] text-text-muted leading-relaxed block">{{ t('settings.brantaVerificationDesc') }}</span>
          </div>
        </div>
        <button @click="toggleBranta" role="switch" :aria-checked="brantaEnabled"
          class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0 ml-3"
          :class="brantaEnabled ? 'bg-brand' : 'bg-surface-elevated border border-border'">
          <span class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
            :class="brantaEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
        </button>
      </div>
      <p class="text-[10px] text-text-muted px-1">{{ t('settings.brantaPrivacy') }}</p>
    </section>

    <!-- ═══ LANGUAGE ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.language') }}</h2>

      <button @click="showLanguagePicker = !showLanguagePicker"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Languages class="w-4 h-4 text-text-muted" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ locales.find(l => l.code === locale)?.native || 'English' }}</span>
          <span class="text-[10px] text-text-muted">{{ t('settings.language') }}</span>
        </div>
      </button>

      <div v-if="showLanguagePicker" class="bg-surface-card rounded-3xl border border-border shadow-sm p-3">
        <LanguagePicker compact @select="showLanguagePicker = false" />
      </div>
    </section>

    <!-- ═══ CURRENCY ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.currency') }}</h2>

      <button @click="showCurrencyPicker = !showCurrencyPicker"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Coins class="w-4 h-4 text-text-muted" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ CURRENCIES.find(c => c.code === fiatCurrency)?.symbol }} {{ fiatCurrency.toUpperCase() }}</span>
          <span class="text-[10px] text-text-muted">{{ t('settings.currencyDesc') }}</span>
        </div>
      </button>

      <div v-if="showCurrencyPicker" class="bg-surface-card rounded-3xl border border-border shadow-sm p-2 max-h-52 overflow-y-auto">
        <button
          v-for="cur in CURRENCIES"
          :key="cur.code"
          @click="setFiatCurrency(cur.code); showCurrencyPicker = false"
          class="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 text-left"
          :class="fiatCurrency === cur.code ? 'bg-brand/8' : 'hover:bg-surface-elevated'"
        >
          <div class="flex items-center gap-2.5">
            <span class="text-sm font-mono w-6 text-center">{{ cur.symbol }}</span>
            <span class="text-sm" :class="fiatCurrency === cur.code ? 'font-semibold text-brand' : 'text-text-secondary'">
              {{ cur.code.toUpperCase() }}
            </span>
            <span class="text-xs text-text-muted">{{ cur.name }}</span>
          </div>
          <Check v-if="fiatCurrency === cur.code" class="w-3.5 h-3.5 text-brand" />
        </button>
      </div>
    </section>

    <!-- ═══ NOTIFICATIONS ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('notifications.title') }}</h2>
      <p class="text-[10px] text-text-muted px-1">{{ t('notifications.desc') }}</p>

      <div v-if="notifLoaded" class="space-y-4">
        <!-- Categories -->
        <div class="space-y-1.5">
          <h3 class="text-[9px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('notifications.categories') }}</h3>

          <!-- DMs -->
          <div class="flex items-center justify-between px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center">
                <MessageSquare class="w-4 h-4 text-text-muted" />
              </div>
              <div>
                <span class="text-sm font-medium block">{{ t('notifications.dms') }}</span>
                <span class="text-[10px] text-text-muted">{{ t('notifications.dmsDesc') }}</span>
              </div>
            </div>
            <button @click="toggleDms" role="switch" :aria-checked="notifSettings.dms"
              class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
              :class="notifSettings.dms ? 'bg-brand' : 'bg-surface-elevated border border-border'">
              <span class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
                :class="notifSettings.dms ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>

          <!-- Payments -->
          <div class="flex items-center justify-between px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center">
                <Wallet class="w-4 h-4 text-text-muted" />
              </div>
              <div>
                <span class="text-sm font-medium block">{{ t('notifications.payments') }}</span>
                <span class="text-[10px] text-text-muted">{{ t('notifications.paymentsDesc') }}</span>
              </div>
            </div>
            <button @click="togglePayments" role="switch" :aria-checked="notifSettings.payments"
              class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
              :class="notifSettings.payments ? 'bg-brand' : 'bg-surface-elevated border border-border'">
              <span class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
                :class="notifSettings.payments ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>
        </div>

        <!-- Schedule -->
        <div class="space-y-1.5">
          <h3 class="text-[9px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('notifications.schedule') }}</h3>

          <!-- DND -->
          <div class="flex items-center justify-between px-4 py-3 bg-surface-card rounded-3xl border shadow-sm"
            :class="notifSettings.dnd ? 'border-warning/30 bg-warning/5' : 'border-border'">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-[10px] flex items-center justify-center"
                :class="notifSettings.dnd ? 'bg-warning/15' : 'bg-surface-elevated border border-border'">
                <MoonStar class="w-4 h-4" :class="notifSettings.dnd ? 'text-warning' : 'text-text-muted'" />
              </div>
              <div>
                <span class="text-sm font-medium block">{{ t('notifications.dnd') }}</span>
                <span class="text-[10px] text-text-muted">{{ t('notifications.dndDesc') }}</span>
              </div>
            </div>
            <button @click="toggleDnd" role="switch" :aria-checked="notifSettings.dnd"
              class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
              :class="notifSettings.dnd ? 'bg-warning' : 'bg-surface-elevated border border-border'">
              <span class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
                :class="notifSettings.dnd ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>

          <!-- Quiet hours -->
          <div class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden">
            <div class="flex items-center justify-between px-4 py-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center">
                  <Clock class="w-4 h-4 text-text-muted" />
                </div>
                <div>
                  <span class="text-sm font-medium block">{{ t('notifications.quietHours') }}</span>
                  <span class="text-[10px] text-text-muted">{{ t('notifications.quietHoursDesc') }}</span>
                </div>
              </div>
              <button @click="toggleQuietHours" role="switch" :aria-checked="notifSettings.quietHours"
                class="relative w-9 h-5 p-0 rounded-full transition-all duration-200 shrink-0"
                :class="notifSettings.quietHours ? 'bg-brand' : 'bg-surface-elevated border border-border'">
                <span class="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="notifSettings.quietHours ? 'translate-x-4' : 'translate-x-0.5'" />
              </button>
            </div>

            <div v-if="notifSettings.quietHours" class="px-4 pb-3 pt-1 border-t border-border/50">
              <div class="flex items-center gap-3 pl-[52px]">
                <div class="flex-1 space-y-0.5">
                  <label class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('notifications.quietStart') }}</label>
                  <input type="time" :value="notifSettings.quietStart" @change="setQuietStart($event.target.value)"
                    class="w-full bg-surface-elevated border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-brand transition-colors font-mono" />
                </div>
                <span class="text-text-muted text-sm mt-4">—</span>
                <div class="flex-1 space-y-0.5">
                  <label class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('notifications.quietEnd') }}</label>
                  <input type="time" :value="notifSettings.quietEnd" @change="setQuietEnd($event.target.value)"
                    class="w-full bg-surface-elevated border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-brand transition-colors font-mono" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="space-y-1.5">
        <div class="skeleton-shimmer h-14 rounded-3xl" />
        <div class="skeleton-shimmer h-14 rounded-3xl" />
        <div class="skeleton-shimmer h-14 rounded-3xl" />
      </div>

      <div class="flex items-start gap-2 text-[10px] text-text-muted px-1">
        <Bell class="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>{{ t('notifications.hint') }}</span>
      </div>
    </section>

    <!-- ═══ SECURITY ═══ -->
    <section class="space-y-3">
      <h2 class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.security') }}</h2>

      <!-- Auto-lock timer -->
      <div class="px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm space-y-2.5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
            <Clock class="w-4 h-4 text-text-muted" />
          </div>
          <div>
            <span class="text-sm font-medium block">{{ t('options.autoLockTimer') }}</span>
            <span class="text-[10px] text-text-muted">{{ t('options.autoLockDesc') }}</span>
          </div>
        </div>
        <div class="flex gap-1.5 pl-11">
          <button
            v-for="mins in autoLockOptions"
            :key="mins"
            @click="setAutoLock(mins)"
            class="px-3 py-1.5 text-xs rounded-2xl font-medium transition-all duration-200"
            :class="autoLockMinutes === mins
              ? 'bg-brand text-surface-base'
              : 'bg-surface-elevated text-text-muted hover:text-text-secondary'"
          >
            {{ mins === 0 ? t('options.autoLockNever') : t('options.autoLockMins', { n: mins }) }}
          </button>
        </div>
      </div>

      <!-- Change password -->
      <button @click="showPasswordChange = !showPasswordChange"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <KeyRound class="w-4 h-4 text-text-muted" />
        </div>
        <span class="text-sm font-medium">{{ t('options.changePassword') }}</span>
      </button>

      <!-- Password change form -->
      <div v-if="showPasswordChange" class="bg-surface-card rounded-3xl border border-border shadow-sm p-4 space-y-3">
        <div class="relative">
          <input v-model="oldPassword" :type="showOldPw ? 'text' : 'password'"
            autocomplete="current-password"
            :placeholder="t('options.currentPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <button @click="showOldPw = !showOldPw" class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary">
            <EyeOff v-if="showOldPw" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <div class="relative">
          <input v-model="newPassword" :type="showNewPw ? 'text' : 'password'"
            autocomplete="new-password"
            :placeholder="t('options.newPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <button @click="showNewPw = !showNewPw" class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary">
            <EyeOff v-if="showNewPw" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <div v-if="newPassword" class="flex items-center gap-2">
          <div class="flex-1 flex gap-1">
            <div v-for="i in 3" :key="i"
              class="h-1 flex-1 rounded-full transition-colors"
              :class="i <= newPwStrength.level ? newPwStrength.color : 'bg-border'" />
          </div>
          <span class="text-[10px]" :class="newPwStrength.level <= 1 ? 'text-warning' : 'text-text-muted'">
            {{ newPwStrength.label }}
          </span>
        </div>
        <input v-model="confirmNewPassword" type="password"
          autocomplete="new-password"
          :placeholder="t('options.confirmNewPassword')"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
        <p v-if="newPassword && confirmNewPassword && newPassword !== confirmNewPassword"
          class="text-[10px] text-error px-1">{{ t('lock.mismatch') }}</p>
        <button @click="handleChangePassword"
          :disabled="changingPassword || !oldPassword || newPassword.length < 12 || newPassword !== confirmNewPassword"
          class="w-full py-2.5 text-xs rounded-2xl bg-brand text-surface-base hover:bg-brand-hover font-semibold transition-all duration-200 btn-primary disabled:opacity-40 flex items-center justify-center gap-1.5">
          <Loader2 v-if="changingPassword" class="w-3 h-3 animate-spin" />
          {{ t('options.changePassword') }}
        </button>
      </div>

      <!-- Lock now -->
      <button @click="handleLock"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Lock class="w-4 h-4 text-text-muted" />
        </div>
        <div>
          <span class="text-sm font-medium block">{{ t('settings.lockExtension') }}</span>
          <span class="text-[10px] text-text-muted">{{ t('settings.lockDesc') }}</span>
        </div>
      </button>
    </section>
  </div>
</template>
