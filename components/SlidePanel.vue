<script setup>
/**
 * SlidePanel — bottom sheet panel for flows (send, receive).
 * Slides up from bottom with a backdrop overlay.
 * Content scrolls inside the panel.
 */
import { ref } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap.js'

defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const panelRef = ref(null)
useFocusTrap(panelRef, { onEscape: () => emit('close') })
</script>

<template>
  <Teleport to=".popup-container">
    <Transition name="slide-panel-backdrop">
      <div v-if="open" class="absolute inset-0 z-40 bg-black/40" @click="emit('close')" />
    </Transition>
    <Transition name="slide-panel">
      <div v-if="open" ref="panelRef"
        class="absolute inset-x-0 bottom-0 z-50 flex flex-col bg-surface-card rounded-t-3xl shadow-2xl border-t border-border overflow-hidden"
        style="max-height: 92vh">
        <!-- Drag handle -->
        <div class="flex justify-center pt-2.5 pb-1 shrink-0">
          <div class="w-8 h-1 rounded-full bg-border" />
        </div>
        <div class="flex-1 overflow-y-auto">
          <slot />
        </div>
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

.slide-panel-backdrop-enter-active {
  transition: opacity 0.25s ease-out;
}
.slide-panel-backdrop-leave-active {
  transition: opacity 0.2s ease-in;
}
.slide-panel-backdrop-enter-from,
.slide-panel-backdrop-leave-to {
  opacity: 0;
}
</style>
