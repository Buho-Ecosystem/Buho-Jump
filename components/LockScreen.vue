<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../composables/useLocale.js'
import { Eye, EyeOff, AlertTriangle, Check, Globe, X } from 'lucide-vue-next'

const { t } = useI18n()
const { locale, locales, switchLocale } = useLocale()
const showLangGrid = ref(false)

const emit = defineEmits(['unlock', 'setup'])
const props = defineProps({
  isSetup: { type: Boolean, default: false },
  error: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  lastUnlockedAt: { type: Number, default: 0 },
})

const lastUnlockedLabel = computed(() => {
  if (!props.lastUnlockedAt || props.isSetup) return ''
  const d = new Date(props.lastUnlockedAt)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
})

const currentLangNative = computed(() => {
  const found = locales.find(l => l.code === locale.value)
  return found?.native || 'English'
})

function pickLang(code) {
  switchLocale(code)
}

const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const passwordInput = ref(null)

const canSubmit = computed(() => {
  if (props.loading) return false
  if (props.isSetup) {
    return password.value.length >= 8 && password.value === confirmPassword.value
  }
  return password.value.length > 0
})

const passwordStrength = computed(() => {
  const p = password.value
  if (p.length < 8) return { label: t('lock.strengthTooShort'), level: 0 }
  let score = 0
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 1) return { label: t('lock.strengthWeak'), level: 1 }
  if (score === 2) return { label: t('lock.strengthFair'), level: 2 }
  return { label: t('lock.strengthStrong'), level: 3 }
})

const strengthColor = computed(() => {
  const l = passwordStrength.value.level
  if (l === 0) return 'bg-error'
  if (l === 1) return 'bg-warning'
  if (l === 2) return 'bg-brand'
  return 'bg-success'
})

const strengthTextColor = computed(() => {
  const l = passwordStrength.value.level
  if (l === 0) return 'text-error'
  if (l === 1) return 'text-warning'
  if (l === 2) return 'text-brand'
  return 'text-success'
})

const mismatch = computed(() => {
  return props.isSetup && confirmPassword.value.length > 0 && password.value !== confirmPassword.value
})

function submit() {
  if (!canSubmit.value) return
  if (props.isSetup) {
    emit('setup', password.value)
  } else {
    emit('unlock', password.value)
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && canSubmit.value) submit()
}

onMounted(() => {
  nextTick(() => passwordInput.value?.focus())
})
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[460px] px-6 py-8">

    <!-- Icon + branding area -->
    <div class="animate-scale-in mb-6">
      <img src="/logo/logo.svg" alt="Buho Jump" class="w-12 h-12" />
    </div>

    <!-- Title -->
    <div class="text-center space-y-1.5 mb-6 animate-fade-in-up stagger-1">
      <h1 class="text-lg font-extrabold tracking-tight">
        {{ isSetup ? t('lock.createTitle') : t('lock.unlockTitle') }}
      </h1>
      <p class="text-xs text-text-muted leading-relaxed max-w-[260px] mx-auto">
        {{ isSetup
          ? t('lock.createDesc')
          : t('lock.unlockDesc')
        }}
      </p>
      <p v-if="lastUnlockedLabel" class="text-[10px] text-text-muted/60 mt-1">
        {{ t('lock.lastSession', { time: lastUnlockedLabel }) }}
      </p>
    </div>

    <!-- Form -->
    <div class="w-full space-y-3 animate-fade-in-up stagger-2" @keydown="handleKeydown">
      <!-- Password field -->
      <div class="space-y-1.5">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {{ isSetup ? t('lock.newPassword') : t('lock.password') }}
        </label>
        <div class="relative">
          <input
            ref="passwordInput"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="isSetup ? t('lock.minChars') : t('lock.enterPassword')"
            autocomplete="off"
            class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 pr-10 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
          />
          <button
            @click="showPassword = !showPassword"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary transition-all duration-200"
            tabindex="-1"
          >
            <EyeOff v-if="showPassword" class="w-3.5 h-3.5" />
            <Eye v-else class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Strength indicator (setup only) -->
        <div v-if="isSetup && password.length > 0" class="space-y-1">
          <div class="flex gap-1">
            <div
              v-for="i in 3" :key="i"
              class="h-1 flex-1 rounded-full transition-all duration-300"
              :class="i <= passwordStrength.level ? strengthColor : 'bg-border'"
            />
          </div>
          <p class="text-[10px] transition-colors" :class="strengthTextColor">{{ passwordStrength.label }}</p>
        </div>
      </div>

      <!-- Confirm field (setup only) -->
      <div v-if="isSetup" class="space-y-1.5">
        <label class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {{ t('lock.confirmPassword') }}
        </label>
        <input
          v-model="confirmPassword"
          :type="showPassword ? 'text' : 'password'"
          :placeholder="t('lock.repeatPassword')"
          autocomplete="off"
          class="w-full bg-surface-base border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-brand transition-colors placeholder:text-text-muted"
          :class="mismatch ? 'border-error/50' : ''"
        />
        <p v-if="mismatch" class="text-[10px] text-error flex items-center gap-1">
          <AlertTriangle class="w-2.5 h-2.5" /> {{ t('lock.mismatch') }}
        </p>
      </div>

      <!-- Error -->
      <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-2xl bg-error/10 text-error text-xs animate-scale-in">
        <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- Submit -->
      <button
        @click="submit"
        :disabled="!canSubmit"
        class="w-full py-2.5 text-sm rounded-2xl bg-brand text-surface-base hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 font-semibold btn-primary"
      >
        {{ loading ? t('common.working') : isSetup ? t('lock.setPassword') : t('lock.unlock') }}
      </button>
    </div>

    <!-- Language trigger (setup only) -->
    <button v-if="isSetup"
      @click="showLangGrid = true"
      class="mt-6 flex items-center justify-center gap-2 py-2 text-xs text-text-muted hover:text-text-secondary transition-all duration-200 animate-fade-in-up stagger-3"
    >
      <Globe class="w-3.5 h-3.5" />
      <span class="font-medium">{{ currentLangNative }}</span>
    </button>

    <!-- Language bottom sheet -->
    <Teleport to="body">
      <div v-if="showLangGrid" class="fixed inset-0 z-[100] flex items-end justify-center">
        <div class="absolute inset-0 bg-black/40" @click="showLangGrid = false" />
        <div class="relative w-full max-w-[360px] max-h-[65vh] bg-surface-card rounded-t-3xl border border-border shadow-2xl animate-fade-in-up overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border">
            <h3 class="text-sm font-bold">{{ t('settings.language') }}</h3>
            <button @click="showLangGrid = false"
              class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200">
              <X class="w-4 h-4 text-text-muted" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="lang in locales"
                :key="lang.code"
                @click="pickLang(lang.code); showLangGrid = false"
                class="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition-all duration-200"
                :class="locale === lang.code
                  ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
                  : 'text-text-secondary hover:bg-surface-elevated border border-transparent'"
              >
                <span>{{ lang.native }}</span>
                <Check v-if="locale === lang.code" class="w-3 h-3 text-brand shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
