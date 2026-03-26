<script setup>
/**
 * BottomSheet — sticky confirmation/action panel pinned to popup bottom.
 *
 * Usage:
 *   <BottomSheet :open="showConfirm" @close="showConfirm = false">
 *     <template #icon><AlertTriangle class="w-5 h-5 text-error" /></template>
 *     <template #title>Delete account?</template>
 *     <template #description>This can't be undone.</template>
 *     <template #actions>
 *       <button @click="...">Cancel</button>
 *       <button @click="...">Delete</button>
 *     </template>
 *   </BottomSheet>
 */
import { computed, onMounted, ref } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  variant: { type: String, default: 'default' }, // 'default' | 'danger' | 'brand'
})

const emit = defineEmits(['close'])

// Focus trap — traps Tab/Shift+Tab inside the sheet when open
const sheetRef = ref(null)
useFocusTrap(sheetRef, { onEscape: () => emit('close') })

// Detect if we're inside the popup or the options page
const isPopup = ref(false)
onMounted(() => {
  isPopup.value = !!document.querySelector('.popup-container')
})
const teleportTarget = computed(() => isPopup.value ? '.popup-container' : 'body')
</script>

<template>
  <Teleport :to="teleportTarget">
    <Transition name="bottom-sheet">
      <div v-if="open" :class="isPopup ? 'sticky bottom-0 left-0 right-0 z-50' : 'fixed inset-0 z-50 flex items-end justify-center'">
        <!-- Full-page backdrop (options page only) -->
        <div v-if="!isPopup" class="absolute inset-0 bg-black/40" @click="emit('close')" />

        <!-- Fade overlay above the sheet (popup only) -->
        <div v-if="isPopup"
          class="absolute inset-x-0 -top-8 h-8 pointer-events-none"
          style="background: linear-gradient(to bottom, transparent, var(--color-surface-base))"
        />

        <div
          ref="sheetRef"
          :class="[
            'border-t px-4 pt-4 pb-5 space-y-3 relative',
            isPopup ? '' : 'w-full max-w-md rounded-t-3xl shadow-lg',
            {
              'bg-surface-base border-border': variant === 'default',
              'bg-error/3 border-error/20': variant === 'danger',
              'bg-brand/3 border-brand/20': variant === 'brand',
            }
          ]"
        >
          <!-- Content row: icon + text -->
          <div class="flex items-start gap-3">
            <div v-if="$slots.icon" class="shrink-0 mt-0.5">
              <slot name="icon" />
            </div>
            <div class="flex-1 min-w-0">
              <p v-if="$slots.title" class="text-sm font-semibold">
                <slot name="title" />
              </p>
              <p v-if="$slots.description" class="text-xs text-text-muted mt-0.5">
                <slot name="description" />
              </p>
            </div>
          </div>

          <!-- Actions slot -->
          <div v-if="$slots.actions" class="grid grid-cols-2 gap-2">
            <slot name="actions" />
          </div>

          <!-- Default slot for fully custom content -->
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bottom-sheet-enter-active {
  transition: transform 0.2s ease-out, opacity 0.15s ease-out;
}
.bottom-sheet-leave-active {
  transition: transform 0.15s ease-in, opacity 0.1s ease-in;
}
.bottom-sheet-enter-from {
  transform: translateY(100%);
  opacity: 0;
}
.bottom-sheet-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
