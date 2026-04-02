<script setup>
/**
 * BottomSheet — versatile bottom sheet panel.
 *
 * Two modes:
 *   1. Confirmation: icon + title + description + actions (original slots)
 *   2. Content: title + free-form #content slot (for wallets, lists, etc.)
 *
 * Usage (confirmation):
 *   <BottomSheet :open="showConfirm" @close="showConfirm = false">
 *     <template #icon><AlertTriangle class="w-5 h-5 text-error" /></template>
 *     <template #title>Delete account?</template>
 *     <template #description>This can't be undone.</template>
 *     <template #actions>
 *       <button @click="...">Cancel</button>
 *       <button @click="...">Delete</button>
 *     </template>
 *   </BottomSheet>
 *
 * Usage (content):
 *   <BottomSheet :open="showPicker" @close="showPicker = false">
 *     <template #title>Select wallet</template>
 *     <template #content>
 *       <div>...free-form content...</div>
 *     </template>
 *   </BottomSheet>
 */
import { ref } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { X } from 'lucide-vue-next'

const props = defineProps({
  open: { type: Boolean, default: false },
  variant: { type: String, default: 'default' }, // 'default' | 'danger' | 'brand'
})

const emit = defineEmits(['close'])

const sheetRef = ref(null)
useFocusTrap(sheetRef, { onEscape: () => emit('close') })
</script>

<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-end justify-center">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40" @click="emit('close')" />

        <div
          ref="sheetRef"
          :class="[
            'relative w-full max-w-[360px] rounded-t-3xl border-t shadow-2xl',
            {
              'bg-surface-card border-border': variant === 'default',
              'bg-error/3 border-error/20': variant === 'danger',
              'bg-brand/3 border-brand/20': variant === 'brand',
            }
          ]"
        >
          <!-- Drag handle -->
          <div class="flex justify-center pt-2.5 pb-1">
            <div class="w-8 h-1 rounded-full bg-border" />
          </div>

          <!-- Content mode: title bar + free-form content -->
          <template v-if="$slots.content">
            <div class="flex items-center justify-between px-5 pb-2 border-b border-border">
              <h3 v-if="$slots.title" class="text-sm font-bold">
                <slot name="title" />
              </h3>
              <button @click="emit('close')"
                class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200">
                <X class="w-4 h-4 text-text-muted" />
              </button>
            </div>
            <div class="max-h-[55vh] overflow-y-auto p-3">
              <slot name="content" />
            </div>
          </template>

          <!-- Confirmation mode: icon + title + description + actions -->
          <template v-else>
            <div class="px-4 pt-2 pb-4 space-y-3">
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

              <div v-if="$slots.actions" class="grid grid-cols-2 gap-2">
                <slot name="actions" />
              </div>

              <!-- Default slot for fully custom content -->
              <slot />
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bottom-sheet-enter-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease-out;
}
.bottom-sheet-leave-active {
  transition: transform 0.2s ease-in, opacity 0.1s ease-in;
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
