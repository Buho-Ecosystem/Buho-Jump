<script setup>
/**
 * Content-shaped loading placeholder.
 * Use instead of spinners when loading data that has a known shape.
 */
defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '16px' },
  rounded: { type: String, default: 'rounded-md' },
})
</script>

<template>
  <div
    class="skeleton-shimmer"
    :class="rounded"
    :style="{ width, height }"
  />
</template>
