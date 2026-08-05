<script setup>
/**
 * Reusable empty state card with icon, message, and optional action.
 */
defineProps({
  icon: { type: [Object, Function], default: null },
  illustration: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  actionLabel: { type: String, default: '' },
})

defineEmits(['action'])
</script>

<template>
  <div class="bg-surface-card rounded-3xl shadow-sm p-8 border border-border text-center space-y-3 animate-fade-in-up">
    <img v-if="illustration" :src="illustration" alt="" class="w-36 h-28 object-contain mx-auto -my-2" />
    <div v-else-if="icon" class="w-10 h-10 rounded-[10px] bg-brand/8 flex items-center justify-center mx-auto">
      <component :is="icon" class="w-5.5 h-5.5 text-brand/60" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-semibold text-text-secondary">{{ title }}</p>
      <p v-if="description" class="text-xs text-text-muted leading-relaxed max-w-[240px] mx-auto">
        {{ description }}
      </p>
    </div>
    <button
      v-if="actionLabel"
      @click="$emit('action')"
      class="inline-flex items-center gap-1 px-4 py-2 text-xs rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold btn-primary"
    >
      {{ actionLabel }}
    </button>
    <slot />
  </div>
</template>
