<script setup>
/** A compact switch with a full 44px pointer target and a spoken state. */
defineProps({ modelValue: Boolean, label: { type: String, required: true } })
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <button type="button" role="switch" :aria-checked="modelValue" :aria-label="label"
    class="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg"
    @click="emit('update:modelValue', !modelValue)">
    <span class="relative w-9 h-5 rounded-full border transition-colors"
      :class="modelValue ? 'bg-brand border-brand' : 'bg-surface-elevated border-text-muted'">
      <span class="absolute top-px left-px w-4 h-4 rounded-full bg-white shadow-sm transition-transform"
        :class="{ 'translate-x-4': modelValue }" />
    </span>
  </button>
</template>
