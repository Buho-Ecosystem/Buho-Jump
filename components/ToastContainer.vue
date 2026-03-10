<script setup>
/**
 * Toast notification container — renders at the top of the popup.
 * Toasts animate in/out with slide + fade transitions.
 */
import { useToast } from '../composables/useToast.js'
import { Check, AlertTriangle, Info, X } from 'lucide-vue-next'

const { toasts, dismiss } = useToast()

const iconMap = {
  success: Check,
  error: AlertTriangle,
  info: Info,
}

const colorMap = {
  success: 'bg-success/15 text-success border-success/20',
  error: 'bg-error/15 text-error border-error/20',
  info: 'bg-brand/15 text-brand border-brand/20',
}
</script>

<template>
  <div class="fixed top-2 left-2 right-2 z-50 space-y-1.5 pointer-events-none">
    <TransitionGroup
      enter-active-class="transition-all duration-300 ease-out"
      leave-active-class="transition-all duration-200 ease-in"
      enter-from-class="opacity-0 -translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 -translate-y-2 scale-95"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-lg border text-xs font-medium shadow-md backdrop-blur-sm"
        :class="[colorMap[t.type], t.visible ? '' : 'opacity-0']"
      >
        <component :is="iconMap[t.type]" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span class="flex-1">{{ t.message }}</span>
        <button @click="dismiss(t.id)" class="shrink-0 p-0.5 opacity-60 hover:opacity-100 transition-opacity">
          <X class="w-3 h-3" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
