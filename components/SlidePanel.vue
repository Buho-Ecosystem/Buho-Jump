<script setup>
/**
 * SlidePanel — full-height slide-up panel for flows (send, receive).
 * Slides up from bottom, covers the entire popup.
 * Content scrolls inside the panel.
 */
defineProps({
  open: { type: Boolean, default: false },
})

defineEmits(['close'])
</script>

<template>
  <Teleport to=".popup-container">
    <Transition name="slide-panel">
      <div v-if="open" class="absolute inset-0 z-50 flex flex-col bg-surface-base overflow-y-auto">
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.slide-panel-enter-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-panel-leave-active {
  transition: transform 0.2s ease-in;
}
.slide-panel-enter-from,
.slide-panel-leave-to {
  transform: translateY(100%);
}
</style>
