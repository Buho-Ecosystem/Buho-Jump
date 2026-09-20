<script setup>
import { useTheme } from '../composables/useTheme.js'
import { Check } from 'lucide-vue-next'
const { currentTheme, themes, themeIds, setTheme } = useTheme()
</script>
<template>
      <!-- Theme cards -->
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="id in themeIds"
          :key="id"
          @click="setTheme(id)" :aria-pressed="currentTheme === id"
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
          <span class="text-xs font-medium text-center leading-tight"
            :class="currentTheme === id ? 'text-brand' : 'text-text-secondary'">
            {{ themes[id]?.label }}
          </span>
          <Check v-if="currentTheme === id" class="w-3 h-3 text-brand" />
        </button>
      </div>
</template>
