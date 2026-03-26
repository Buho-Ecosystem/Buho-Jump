<script setup>
/**
 * About page — version, credits, and links.
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const creators = [
  {
    name: 'DoktorShift',
    avatar: 'https://avatars.githubusercontent.com/u/106493492?v=4',
    url: 'https://drshift.dev',
  },
  {
    name: 'Pratik227',
    avatar: 'https://avatars.githubusercontent.com/u/34883558?v=4',
    url: 'https://pratik-patel.netlify.app/',
  },
]
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <!-- Header -->
    <div>
      <h1 class="text-lg font-extrabold">{{ t('options.about') }}</h1>
    </div>

    <!-- App identity -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-6 flex items-center gap-5">
      <img src="/logo/logo.svg" alt="Buho Jump" class="w-14 h-14 rounded-2xl shrink-0 shadow-md" />
      <div>
        <h2 class="text-base font-extrabold tracking-tight">Buho Jump</h2>
        <p class="text-xs text-text-muted mt-0.5">{{ t('options.version', { version: '1.0.0' }) }}</p>
        <p class="text-[10px] text-text-muted mt-1">{{ t('options.tagline') }}</p>
      </div>
    </div>

    <!-- Credits -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ t('options.creators') }}</h3>
      <div class="space-y-2">
        <a
          v-for="creator in creators"
          :key="creator.name"
          :href="creator.url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-lg hover:bg-surface-elevated transition-all duration-200 group"
        >
          <img :src="creator.avatar" :alt="creator.name" class="w-8 h-8 rounded-full object-cover" />
          <span class="text-sm font-medium group-hover:text-brand transition-all duration-200">{{ creator.name }}</span>
        </a>
      </div>
    </div>

    <!-- Built with -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ t('options.builtWith') }}</h3>
      <div class="flex flex-wrap gap-2">
        <span class="px-2.5 py-1 text-xs rounded-lg bg-surface-elevated text-text-secondary font-medium">WXT</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-surface-elevated text-text-secondary font-medium">Vue 3</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-surface-elevated text-text-secondary font-medium">Tailwind CSS</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-surface-elevated text-text-secondary font-medium">nostr-core</span>
      </div>
    </div>

    <!-- Protocols -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ t('options.protocols') }}</h3>
      <div class="flex flex-wrap gap-2">
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">NIP-07</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">NIP-46</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">NIP-17</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">NWC</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">WebLN</span>
        <span class="px-2.5 py-1 text-xs rounded-lg bg-brand/8 text-brand font-medium">LNURL</span>
      </div>
    </div>

    <!-- Ecosystem links -->
    <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-text-muted">{{ t('options.ecosystem') }}</h3>
      <a
        href="https://badgebox.rinbal.de"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-3 px-2 py-2 -mx-2 rounded-lg hover:bg-surface-elevated transition-all duration-200 group"
      >
        <div class="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
          <span class="text-brand text-sm font-bold">B</span>
        </div>
        <div>
          <span class="text-sm font-medium group-hover:text-brand transition-colors">BadgeBox</span>
          <p class="text-[10px] text-text-muted">{{ t('options.badgeboxDesc') }}</p>
        </div>
      </a>
    </div>
  </div>
</template>
