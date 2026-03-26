<script setup>
/**
 * Message action bar — floating above a bubble on long-press.
 *
 * Shows a row of quick reactions + an action menu (reply, delete, report).
 * Telegram-style: appears above the bubble, closes on outside click.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Reply, Trash2, Flag, Forward, Copy, Check } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps({
  message: { type: Object, required: true },
  isSent: { type: Boolean, default: false },
})

const emit = defineEmits(['react', 'reply', 'delete', 'report', 'forward', 'copy', 'close'])

const copied = ref(false)

const quickReactions = [
  { emoji: '❤️', label: 'Love' },
  { emoji: '👍', label: 'Like' },
  { emoji: '👎', label: 'Dislike' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '⚡', label: 'Zap' },
]

function handleReact(emoji) {
  emit('react', emoji)
  emit('close')
}

function handleCopy() {
  navigator.clipboard.writeText(props.message.content || '')
  copied.value = true
  setTimeout(() => { copied.value = false; emit('close') }, 800)
}

function handleAction(action) {
  emit(action, props.message)
  emit('close')
}

function onClickOutside(e) {
  if (!e.target.closest('.message-actions')) {
    emit('close')
  }
}

onMounted(() => {
  setTimeout(() => document.addEventListener('click', onClickOutside, true), 50)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside, true)
})
</script>

<template>
  <div class="message-actions absolute z-30 animate-scale-in origin-bottom"
    :class="isSent ? 'right-0' : 'left-0'"
    style="bottom: calc(100% + 4px);"
  >
    <!-- Quick reaction row -->
    <div class="flex items-center gap-0.5 bg-surface-card rounded-2xl shadow-lg border border-border px-1.5 py-1 mb-1">
      <button
        v-for="r in quickReactions" :key="r.emoji"
        @click.stop="handleReact(r.emoji)"
        :title="r.label"
        :aria-label="r.label"
        class="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-surface-elevated transition-colors text-lg"
      >
        {{ r.emoji }}
      </button>
    </div>

    <!-- Action menu -->
    <div class="bg-surface-card rounded-2xl shadow-lg border border-border py-1 min-w-[160px]">
      <button @click.stop="handleAction('reply')"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-elevated transition-colors text-left">
        <Reply class="w-3.5 h-3.5 text-text-muted" />
        {{ t('chat.reply') }}
      </button>

      <button @click.stop="handleAction('forward')"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-elevated transition-colors text-left">
        <Forward class="w-3.5 h-3.5 text-text-muted" />
        {{ t('chat.forward') }}
      </button>

      <button @click.stop="handleCopy"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-text-secondary hover:bg-surface-elevated transition-colors text-left">
        <component :is="copied ? Check : Copy" class="w-3.5 h-3.5" :class="copied ? 'text-success' : 'text-text-muted'" />
        {{ copied ? t('common.copied') : t('chat.copyMessage') }}
      </button>

      <div v-if="isSent" class="border-t border-border my-0.5" />

      <button v-if="isSent" @click.stop="handleAction('delete')"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-error hover:bg-error/8 transition-colors text-left">
        <Trash2 class="w-3.5 h-3.5" />
        {{ t('chat.deleteMessage') }}
      </button>

      <div v-if="!isSent" class="border-t border-border my-0.5" />

      <button v-if="!isSent" @click.stop="handleAction('report')"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-warning hover:bg-warning/8 transition-colors text-left">
        <Flag class="w-3.5 h-3.5" />
        {{ t('chat.reportMessage') }}
      </button>
    </div>
  </div>
</template>
