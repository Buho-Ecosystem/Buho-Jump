<script setup>
/**
 * Relay Info Bottom Sheet — NIP-11 metadata display.
 * Shows relay name, description, supported NIPs, capabilities, and technical details.
 */
import { ref, onMounted, computed } from 'vue'
import BottomSheet from './BottomSheet.vue'
import { useI18n } from 'vue-i18n'
import { useRelays } from '../composables/useRelays.js'
import {
  X, Globe, Copy, Check, Code,
} from 'lucide-vue-next'

const props = defineProps({
  url: { type: String, required: true },
  connected: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const { getRelayInfo } = useRelays()

const info = ref(null)
const loading = ref(true)
const showTechnical = ref(false)
const copiedField = ref('')

// Key NIPs with descriptions and highlight
const KEY_NIPS = {
  1: 'Basic protocol',
  4: 'Encrypted DMs (legacy)',
  11: 'Relay info',
  17: 'Gift-wrapped DMs',
  42: 'Authentication',
  44: 'Encryption v2',
  65: 'Relay list metadata',
}

const hostname = computed(() => {
  try { return new URL(props.url).hostname } catch { return props.url }
})

const capabilities = computed(() => {
  if (!info.value?.limitation) return []
  const lim = info.value.limitation
  const caps = []
  if (lim.auth_required !== undefined) {
    caps.push({ label: t('relay.infoAuthRequired'), value: lim.auth_required ? t('relay.infoYes') : t('relay.infoNo') })
  }
  if (lim.payment_required !== undefined) {
    caps.push({ label: t('relay.infoPaymentRequired'), value: lim.payment_required ? t('relay.infoYes') : t('relay.infoNo') })
  }
  if (lim.max_message_length) {
    const kb = Math.round(lim.max_message_length / 1024)
    caps.push({ label: t('relay.infoMaxMessageLength'), value: `${kb} KB` })
  }
  if (lim.max_subscriptions) {
    caps.push({ label: t('relay.infoMaxSubscriptions'), value: String(lim.max_subscriptions) })
  }
  return caps
})

function copy(text, field) {
  navigator.clipboard.writeText(text)
  copiedField.value = field
  setTimeout(() => (copiedField.value = ''), 2500)
}

onMounted(async () => {
  try {
    info.value = await getRelayInfo(props.url)
  } catch { /* no info available */ }
  loading.value = false
})
</script>

<template>
  <BottomSheet :open="true" @close="emit('close')">
    <template #title>{{ t('relay.infoTitle') }}</template>
    <template #content>
      <!-- Loading skeleton -->
      <div v-if="loading" class="p-4 space-y-4">
        <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-4 space-y-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-[10px] skeleton-shimmer" />
            <div class="flex-1 space-y-2">
              <div class="skeleton-shimmer h-4 w-32 rounded" />
              <div class="skeleton-shimmer h-3 w-48 rounded" />
            </div>
          </div>
        </div>
        <div class="skeleton-shimmer h-20 rounded-3xl" />
        <div class="skeleton-shimmer h-16 rounded-3xl" />
      </div>

      <!-- Content -->
      <div v-else class="p-4 space-y-3">

        <!-- Relay identity card -->
        <div class="bg-surface-card rounded-3xl border border-border shadow-sm p-4">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
              <img v-if="info?.icon" :src="info.icon" alt="" class="w-full h-full object-cover" @error="info.icon = null" />
              <Globe v-else class="w-5 h-5 text-text-muted" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-extrabold truncate">{{ info?.name || hostname }}</div>
              <p v-if="info?.description" class="text-xs text-text-muted mt-0.5 line-clamp-2">{{ info.description }}</p>
            </div>
          </div>
          <!-- Connection status -->
          <div class="flex items-center gap-1.5 mt-2">
            <span class="w-1.5 h-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-text-muted'" />
            <span class="text-xs font-medium" :class="connected ? 'text-success' : 'text-text-muted'">
              {{ connected ? t('relay.connected') : t('relay.disconnected') }}
            </span>
          </div>
        </div>

        <!-- No metadata fallback -->
        <div v-if="!info" class="bg-surface-card rounded-3xl border border-border shadow-sm p-4 text-center">
          <p class="text-xs text-text-muted">{{ t('relay.infoNoMetadata') }}</p>
        </div>

        <template v-if="info">

          <!-- Supported NIPs -->
          <details v-if="info.supported_nips?.length" class="bg-surface-card rounded-3xl border border-border shadow-sm p-3">
            <summary class="text-sm text-text-secondary font-semibold min-h-8 cursor-pointer">{{ t('prompt.details') }}</summary>
            <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              <span
                v-for="nip in info.supported_nips"
                :key="nip"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border"
                :class="KEY_NIPS[nip]
                  ? 'bg-brand/8 text-brand border-brand/20'
                  : 'bg-surface-elevated text-text-secondary border-border'"
                :title="KEY_NIPS[nip] || `NIP-${nip}`"
              >
                {{ KEY_NIPS[nip] || `NIP-${nip}` }}
              </span>
            </div>
          </details>

          <!-- Capabilities -->
          <div v-if="capabilities.length" class="bg-surface-card rounded-3xl border border-border shadow-sm divide-y divide-border overflow-hidden">
            <div class="px-3 py-2 bg-surface-elevated/50">
              <span class="text-xs uppercase tracking-widest text-text-muted font-semibold">{{ t('relay.infoCapabilities') }}</span>
            </div>
            <div v-for="cap in capabilities" :key="cap.label" class="flex items-center justify-between px-4 py-2.5">
              <span class="text-xs text-text-secondary">{{ cap.label }}</span>
              <span class="text-xs font-medium">{{ cap.value }}</span>
            </div>
          </div>

          <!-- Technical details toggle -->
          <div v-if="info.software || info.pubkey || info.contact">
            <button
              @click="showTechnical = !showTechnical" :aria-expanded="showTechnical"
              class="flex items-center gap-1.5 text-xs font-medium px-1 mb-1.5 transition-all duration-200"
              :class="showTechnical ? 'text-brand' : 'text-text-muted hover:text-text-secondary'"
            >
              <Code class="w-3 h-3" />
              <span>{{ t('wallet.technicalDetails') }}</span>
            </button>

            <div v-if="showTechnical" class="bg-surface-card rounded-3xl border border-border shadow-sm divide-y divide-border overflow-hidden animate-fade-in-up">
              <!-- Software -->
              <div v-if="info.software" class="px-4 py-2.5">
                <div class="text-xs text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('relay.infoSoftware') }}</div>
                <p class="text-xs text-text-primary">
                  {{ info.software }}{{ info.version ? ` v${info.version}` : '' }}
                </p>
              </div>

              <!-- Operator -->
              <div v-if="info.pubkey" class="px-4 py-2.5">
                <div class="flex items-center justify-between mb-0.5">
                  <span class="text-xs text-text-muted font-semibold uppercase tracking-wider">{{ t('relay.infoOperator') }}</span>
                  <button @click="copy(info.pubkey, 'operator')" :aria-label="t('common.copy') + ': ' + t('relay.infoOperator')" class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200 min-w-8 min-h-8">
                    <Check v-if="copiedField === 'operator'" class="w-3 h-3 text-success" />
                    <Copy v-else class="w-3 h-3 text-text-muted" />
                  </button>
                </div>
                <code class="text-xs font-mono text-text-secondary break-all">{{ info.pubkey }}</code>
              </div>

              <!-- Contact -->
              <div v-if="info.contact" class="px-4 py-2.5">
                <div class="flex items-center justify-between mb-0.5">
                  <span class="text-xs text-text-muted font-semibold uppercase tracking-wider">{{ t('relay.infoContact') }}</span>
                  <button @click="copy(info.contact, 'contact')" :aria-label="t('common.copy') + ': ' + t('relay.infoContact')" class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200 min-w-8 min-h-8">
                    <Check v-if="copiedField === 'contact'" class="w-3 h-3 text-success" />
                    <Copy v-else class="w-3 h-3 text-text-muted" />
                  </button>
                </div>
                <p class="text-xs text-text-primary">{{ info.contact }}</p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </BottomSheet>
</template>
