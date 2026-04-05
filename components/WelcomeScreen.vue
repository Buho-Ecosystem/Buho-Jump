<script setup>
/**
 * Welcome screen — two-step intro shown on first run, before password setup.
 * Auto-detects browser language so non-English speakers feel at home immediately.
 * Step 1: Meet Buho — warm intro + what you'll do here
 * Step 2: Why a password matters — leads into LockScreen
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../composables/useLocale.js'
import { Fingerprint, ShieldCheck, Wallet, Lock, Check, ArrowRight, Globe } from 'lucide-vue-next'

const { t } = useI18n()
const { locale, locales, switchLocale } = useLocale()
const emit = defineEmits(['complete'])

const step = ref(1)
const showLangPicker = ref(false)
const langDetected = ref(false)

onMounted(async () => {
  // Auto-detect browser language on first launch
  const browserLang = (navigator.language || '').split('-')[0].toLowerCase()
  const match = locales.find(l => l.code === browserLang)
  if (match && match.code !== locale.value) {
    await switchLocale(match.code)
    langDetected.value = true
  }
})

async function pickLang(code) {
  await switchLocale(code)
  showLangPicker.value = false
}

function next() {
  if (step.value === 1) {
    step.value = 2
  } else {
    chrome.storage.local.set({ welcomeCompleted: true })
    emit('complete')
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-between min-h-[500px] px-6 pt-12 pb-6">

    <!-- ═══ STEP 1: Meet Buho ═══ -->
    <template v-if="step === 1">
      <div class="flex-1 flex flex-col items-center">
        <!-- Logo + name -->
        <div class="flex flex-col items-center mb-8 animate-fade-in">
          <img src="/logo/logo.svg" alt="Buho Jump" class="w-14 h-14 mb-3" />
          <span class="text-[10px] font-semibold text-text-muted tracking-widest uppercase">Buho Jump</span>
        </div>

        <!-- Greeting — warm, personal -->
        <div class="text-center mb-8 animate-fade-in-up stagger-1">
          <h1 class="text-[22px] font-extrabold tracking-tight leading-tight">
            {{ t('welcome.headline') }}
          </h1>
          <p class="text-[13px] text-text-muted mt-3 max-w-[280px] mx-auto leading-relaxed">
            {{ t('welcome.subline') }}
          </p>
        </div>

        <!-- What you'll do -->
        <div class="w-full max-w-[300px] bg-surface-card rounded-2xl border border-border divide-y divide-border animate-fade-in-up stagger-2">
          <div class="flex items-center gap-3.5 px-4 py-3.5">
            <div class="w-8 h-8 rounded-xl bg-brand/8 flex items-center justify-center shrink-0">
              <Fingerprint class="w-[18px] h-[18px] text-brand" />
            </div>
            <p class="text-[12px] text-text-secondary leading-snug">{{ t('welcome.verb1Full') }}</p>
          </div>
          <div class="flex items-center gap-3.5 px-4 py-3.5">
            <div class="w-8 h-8 rounded-xl bg-brand/8 flex items-center justify-center shrink-0">
              <ShieldCheck class="w-[18px] h-[18px] text-brand" />
            </div>
            <p class="text-[12px] text-text-secondary leading-snug">{{ t('welcome.verb2Full') }}</p>
          </div>
          <div class="flex items-center gap-3.5 px-4 py-3.5">
            <div class="w-8 h-8 rounded-xl bg-brand/8 flex items-center justify-center shrink-0">
              <Wallet class="w-[18px] h-[18px] text-brand" />
            </div>
            <p class="text-[12px] text-text-secondary leading-snug">{{ t('welcome.verb3Full') }}</p>
          </div>
        </div>
      </div>

      <!-- Footer: CTA + language -->
      <div class="w-full max-w-[300px] mt-6 space-y-3">
        <button
          @click="next"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand text-surface-base font-semibold text-sm hover:bg-brand-hover transition-colors duration-200 btn-primary"
        >
          {{ t('welcome.continue') }}
          <ArrowRight class="w-4 h-4" />
        </button>

        <!-- Language selector — always visible so non-English speakers can switch -->
        <button
          @click="showLangPicker = !showLangPicker"
          class="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-text-muted hover:text-brand transition-colors"
        >
          <Globe class="w-3.5 h-3.5" />
          {{ locales.find(l => l.code === locale)?.native || 'English' }}
        </button>

        <!-- Language grid -->
        <div v-if="showLangPicker" class="bg-surface-card rounded-2xl border border-border p-2 grid grid-cols-2 gap-0.5 animate-fade-in-up">
          <button
            v-for="lang in locales"
            :key="lang.code"
            @click="pickLang(lang.code)"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] transition-colors text-left"
            :class="locale === lang.code ? 'bg-brand/10 text-brand font-semibold' : 'text-text-secondary hover:bg-surface-elevated'"
          >
            {{ lang.native }}
            <Check v-if="locale === lang.code" class="w-3 h-3 ml-auto shrink-0" />
          </button>
        </div>
      </div>
    </template>

    <!-- ═══ STEP 2: Your password protects everything ═══ -->
    <template v-else>
      <div class="flex-1 flex flex-col items-center">
        <!-- Icon in a card -->
        <div class="w-14 h-14 rounded-2xl bg-surface-card border border-border flex items-center justify-center mb-6 animate-fade-in">
          <Lock class="w-7 h-7 text-brand" />
        </div>

        <!-- Copy -->
        <div class="text-center mb-8 animate-fade-in-up stagger-1">
          <h1 class="text-[20px] font-extrabold tracking-tight leading-snug">
            {{ t('welcome.securityTitle') }}
          </h1>
          <p class="text-[13px] text-text-muted mt-3 max-w-[280px] mx-auto leading-relaxed">
            {{ t('welcome.securityDesc') }}
          </p>
        </div>

        <!-- What the password protects -->
        <div class="w-full max-w-[300px] bg-surface-card rounded-2xl border border-border p-4 space-y-3 animate-fade-in-up stagger-2">
          <div class="flex items-center gap-3">
            <Check class="w-4 h-4 text-success shrink-0" />
            <span class="text-[12px] text-text-secondary">{{ t('welcome.protects1') }}</span>
          </div>
          <div class="flex items-center gap-3">
            <Check class="w-4 h-4 text-success shrink-0" />
            <span class="text-[12px] text-text-secondary">{{ t('welcome.protects2') }}</span>
          </div>
          <div class="flex items-center gap-3">
            <Check class="w-4 h-4 text-success shrink-0" />
            <span class="text-[12px] text-text-secondary">{{ t('welcome.protects3') }}</span>
          </div>
        </div>

        <p class="text-[10px] text-text-muted/60 mt-4 text-center animate-fade-in-up stagger-3">
          {{ t('welcome.noReset') }}
        </p>
      </div>

      <!-- Footer -->
      <div class="w-full max-w-[300px] mt-6">
        <button
          @click="next"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand text-surface-base font-semibold text-sm hover:bg-brand-hover transition-colors duration-200 btn-primary"
        >
          {{ t('welcome.createPassword') }}
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>
    </template>

    <!-- Step dots -->
    <div class="flex items-center gap-2 mt-5">
      <div class="h-1.5 rounded-full transition-all duration-300"
        :class="step === 1 ? 'bg-brand w-5' : 'bg-border w-1.5'" />
      <div class="h-1.5 rounded-full transition-all duration-300"
        :class="step === 2 ? 'bg-brand w-5' : 'bg-border w-1.5'" />
    </div>
  </div>
</template>
