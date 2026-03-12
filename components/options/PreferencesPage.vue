<script setup>
/**
 * Preferences page — flat layout combining appearance, notifications, and security.
 * Grouped visually with section headers (Alby-style flat settings page).
 */
import { ref, onMounted } from 'vue'
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
  Wallet, Lock, Clock, Eye, EyeOff, Loader2, KeyRound,
} from 'lucide-vue-next'

const { t } = useI18n()
const { currentTheme, currentMode, themes, themeIds, setTheme, toggleMode } = useTheme()
const { locale, locales, switchLocale } = useLocale()
const { currency: fiatCurrency, setCurrency: setFiatCurrency } = useFiat()
const { settings: notifSettings, loaded: notifLoaded, load: loadNotif, toggleDms, togglePayments } = useNotifications()
const { lock, changePassword } = useLock()
const toast = useToast()

const showLanguagePicker = ref(false)
const showCurrencyPicker = ref(false)

// Auto-lock
const autoLockMinutes = ref(5)
const autoLockOptions = [1, 5, 15, 30, 0] // 0 = never

// Password change
const showPasswordChange = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')
const changingPassword = ref(false)
const showOldPw = ref(false)
const showNewPw = ref(false)

onMounted(async () => {
  loadNotif()
  try {
    const data = await chrome.storage.local.get('autoLockMinutes')
    autoLockMinutes.value = data.autoLockMinutes ?? 5
  } catch {}
})

async function setAutoLock(minutes) {
  autoLockMinutes.value = minutes
  await chrome.storage.local.set({ autoLockMinutes: minutes })
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
    toast.error(err.message || t('common.error'))
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
              :style="{ background: themes[id]?.dark?.['brand-primary'] || '#888' }" />
            <span class="w-5 h-5 rounded-full border border-border/50"
              :style="{ background: themes[id]?.light?.['brand-primary'] || '#888' }" />
          </div>
          <span class="text-[10px] font-medium text-center leading-tight"
            :class="currentTheme === id ? 'text-brand' : 'text-text-secondary'">
            {{ themes[id]?.label }}
          </span>
          <Check v-if="currentTheme === id" class="w-3 h-3 text-brand" />
        </button>
      </div>
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

      <div v-if="notifLoaded" class="space-y-1.5">
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

      <div v-else class="space-y-1.5">
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
            :placeholder="t('options.currentPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <button @click="showOldPw = !showOldPw" class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary">
            <EyeOff v-if="showOldPw" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <div class="relative">
          <input v-model="newPassword" :type="showNewPw ? 'text' : 'password'"
            :placeholder="t('options.newPassword')"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
          <button @click="showNewPw = !showNewPw" class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-secondary">
            <EyeOff v-if="showNewPw" class="w-4 h-4" />
            <Eye v-else class="w-4 h-4" />
          </button>
        </div>
        <input v-model="confirmNewPassword" type="password"
          :placeholder="t('options.confirmNewPassword')"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted" />
        <p v-if="newPassword && confirmNewPassword && newPassword !== confirmNewPassword"
          class="text-[10px] text-error px-1">{{ t('lock.mismatch') }}</p>
        <button @click="handleChangePassword"
          :disabled="changingPassword || !oldPassword || !newPassword || newPassword !== confirmNewPassword"
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
