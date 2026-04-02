<script setup>
/**
 * Quick-select preset amount buttons.
 *
 * Renders a row of pill buttons for common sats amounts.
 * Supports min/max constraints (e.g. from LNURL params) —
 * buttons outside the range are hidden.
 *
 * When inputMode is 'fiat', emits the sats value but the parent
 * handles conversion. The parent should always bind v-model to
 * the sats amount string.
 */
import { computed } from 'vue'
import { formatSats } from '../../lib/utils.js'

const PRESETS = [1000, 5000, 10000, 21000, 50000, 100000]

const props = defineProps({
  /** Currently active sats amount (string, to match input v-model) */
  modelValue: { type: String, default: '' },
  /** Minimum allowed sats (inclusive). Buttons below this are hidden. */
  min: { type: Number, default: 1 },
  /** Maximum allowed sats (inclusive). Buttons above this are hidden. */
  max: { type: Number, default: Infinity },
})

const emit = defineEmits(['update:modelValue'])

const visiblePresets = computed(() =>
  PRESETS.filter(v => v >= props.min && v <= props.max)
)

const activeValue = computed(() => parseInt(props.modelValue) || 0)

function select(value) {
  emit('update:modelValue', String(value))
}
</script>

<template>
  <div v-if="visiblePresets.length > 0" class="flex flex-wrap gap-1.5">
    <button
      v-for="preset in visiblePresets"
      :key="preset"
      type="button"
      @click="select(preset)"
      class="px-2.5 py-1 rounded-full text-[10px] font-semibold tabular-nums transition-all duration-150 border select-none"
      :class="activeValue === preset
        ? 'bg-brand text-white border-brand shadow-sm'
        : 'bg-surface-base text-text-secondary border-border hover:border-brand hover:text-brand'"
    >
      {{ formatSats(preset) }}
    </button>
  </div>
</template>
