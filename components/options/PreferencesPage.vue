<script setup>
import ToggleSwitch from '../ToggleSwitch.vue'
import ThemePicker from '../ThemePicker.vue'
/**
 * Preferences page — flat layout combining appearance, notifications, and security.
 * Grouped visually with section headers (Alby-style flat settings page).
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../../composables/useTheme.js'
import { useLocale } from '../../composables/useLocale.js'
import { useFiat, CURRENCIES } from '../../composables/useFiat.js'
import NotificationSettings from '../NotificationSettings.vue'
import { useLock } from '../../composables/useLock.js'
import { useToast } from '../../composables/useToast.js'
import LanguagePicker from '../LanguagePicker.vue'
import {
  Sun, Moon, Check, Languages, Coins, Bell, MessageSquare,
  Wallet, Lock, Clock, Eye, EyeOff, Loader2, KeyRound, MoonStar,
  BadgeCheck,
} from 'lucide-vue-next'

const { t } = useI18n()
const { currentMode, toggleMode } = useTheme()
const { locale, locales, switchLocale } = useLocale()
const { currency: fiatCurrency, setCurrency: setFiatCurrency } = useFiat()
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
      <h2 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.appearance') }}</h2>

      <!-- Mode toggle -->
      <button @click="toggleMode"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Sun v-if="currentMode === 'dark'" class="w-4 h-4 text-warning" />
          <Moon v-else class="w-4 h-4 text-info" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ currentMode === 'dark' ? t('settings.lightMode') : t('settings.darkMode') }}</span>
          <span class="text-xs text-text-muted">{{ currentMode === 'dark' ? t('settings.currentlyDark') : t('settings.currentlyLight') }}</span>
        </div>
      </button>

      <ThemePicker />
    </section>

    <!-- ═══ PAYMENT SAFETY ═══ -->
    <section class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.paymentSafety') }}</h2>
      <div class="flex items-center justify-between px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-[10px] bg-success/10 flex items-center justify-center shrink-0">
            <BadgeCheck class="w-4 h-4 text-success" />
          </div>
          <div class="min-w-0">
            <span class="text-sm font-medium block">{{ t('settings.brantaVerification') }}</span>
            <span class="text-xs text-text-muted leading-relaxed block">{{ t('settings.brantaVerificationDesc') }}</span>
          </div>
        </div>
        <ToggleSwitch :model-value="brantaEnabled" :label="t('settings.brantaVerification')" @update:model-value="toggleBranta" />
      </div>
      <p class="text-xs text-text-muted px-1">{{ t('settings.brantaPrivacy') }}</p>
    </section>

    <!-- ═══ LANGUAGE ═══ -->
    <section class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.language') }}</h2>

      <button @click="showLanguagePicker = !showLanguagePicker"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Languages class="w-4 h-4 text-text-muted" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ locales.find(l => l.code === locale)?.native || 'English' }}</span>
          <span class="text-xs text-text-muted">{{ t('settings.language') }}</span>
        </div>
      </button>

      <div v-if="showLanguagePicker" class="bg-surface-card rounded-3xl border border-border shadow-sm p-3">
        <LanguagePicker compact @select="showLanguagePicker = false" />
      </div>
    </section>

    <!-- ═══ CURRENCY ═══ -->
    <section class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.currency') }}</h2>

      <button @click="showCurrencyPicker = !showCurrencyPicker"
        class="w-full flex items-center gap-3 px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 text-left">
        <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
          <Coins class="w-4 h-4 text-text-muted" />
        </div>
        <div class="flex-1">
          <span class="text-sm font-medium block">{{ CURRENCIES.find(c => c.code === fiatCurrency)?.symbol }} {{ fiatCurrency.toUpperCase() }}</span>
          <span class="text-xs text-text-muted">{{ t('settings.currencyDesc') }}</span>
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

    <NotificationSettings hide-back />

    <!-- ═══ SECURITY ═══ -->
    <section class="space-y-3">
      <h2 class="text-xs uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('settings.security') }}</h2>

      <!-- Auto-lock timer -->
      <div class="px-4 py-3 bg-surface-card rounded-3xl border border-border shadow-sm space-y-2.5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-[10px] bg-surface-elevated flex items-center justify-center">
            <Clock class="w-4 h-4 text-text-muted" />
          </div>
          <div>
            <span class="text-sm font-medium block">{{ t('options.autoLockTimer') }}</span>
            <span class="text-xs text-text-muted">{{ t('options.autoLockDesc') }}</span>
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
          <label class="flex flex-col gap-1 min-w-0 text-sm text-text-secondary">
            <span>{{ t('options.currentPassword') }}</span>
            <input v-model="oldPassword" :type="showOldPw ? 'text' : 'password'"
            autocomplete="current-password"
            :placeholder="t('options.currentPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          </label>
          <button @click="showOldPw = !showOldPw" :aria-label="showOldPw ? t('prompt.hidePassword') : t('prompt.showPassword')" :aria-pressed="showOldPw" class="absolute right-3 bottom-1 p-0.5 text-text-muted hover:text-text-secondary min-w-8 min-h-8">
            <EyeOff v-if="showOldPw" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <div class="relative">
          <label class="flex flex-col gap-1 min-w-0 text-sm text-text-secondary">
            <span>{{ t('options.newPassword') }}</span>
            <input v-model="newPassword" :type="showNewPw ? 'text' : 'password'"
            autocomplete="new-password"
            :placeholder="t('options.newPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          </label>
          <button @click="showNewPw = !showNewPw" :aria-label="showNewPw ? t('prompt.hidePassword') : t('prompt.showPassword')" :aria-pressed="showNewPw" class="absolute right-3 bottom-1 p-0.5 text-text-muted hover:text-text-secondary min-w-8 min-h-8">
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
          <span class="text-xs" :class="newPwStrength.level <= 1 ? 'text-warning' : 'text-text-muted'">
            {{ newPwStrength.label }}
          </span>
        </div>
        <label class="flex flex-col gap-1 min-w-0 text-sm text-text-secondary">
          <span>{{ t('options.confirmNewPassword') }}</span>
          <input v-model="confirmNewPassword" type="password"
          autocomplete="new-password"
          :placeholder="t('options.confirmNewPassword')"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
        </label>
        <p v-if="newPassword && confirmNewPassword && newPassword !== confirmNewPassword"
          class="text-xs text-error px-1">{{ t('lock.mismatch') }}</p>
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
          <span class="text-xs text-text-muted">{{ t('settings.lockDesc') }}</span>
        </div>
      </button>
    </section>
  </div>
</template>
