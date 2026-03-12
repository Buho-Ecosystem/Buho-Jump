<script setup>
/**
 * Relay Info Bottom Sheet — NIP-11 metadata display.
 * Shows relay name, description, supported NIPs, capabilities, and technical details.
 */
import { ref, onMounted, computed } from 'vue'
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
  setTimeout(() => (copiedField.value = ''), 1500)
}

onMounted(async () => {
  try {
    info.value = await getRelayInfo(props.url)
  } catch { /* no info available */ }
  loading.value = false
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" @click.self="emit('close')">
    <div class="w-full max-w-[400px] max-h-[85vh] bg-surface-base rounded-t-3xl shadow-lg border-t border-x border-border overflow-y-auto animate-slide-up">

      <!-- Header -->
      <div class="sticky top-0 bg-surface-base z-10 flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="text-sm font-semibold">{{ t('relay.infoTitle') }}</span>
        <button @click="emit('close')" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200">
          <X class="w-4 h-4 text-text-muted" />
        </button>
      </div>

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
              <p v-if="info?.description" class="text-[10px] text-text-muted mt-0.5 line-clamp-2">{{ info.description }}</p>
            </div>
          </div>
          <!-- Connection status -->
          <div class="flex items-center gap-1.5 mt-2">
            <span class="w-1.5 h-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-text-muted'" />
            <span class="text-[10px] font-medium" :class="connected ? 'text-success' : 'text-text-muted'">
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
          <div v-if="info.supported_nips?.length" class="bg-surface-card rounded-3xl border border-border shadow-sm p-3">
            <p class="text-[9px] uppercase tracking-widest text-text-muted font-semibold mb-2">{{ t('relay.infoSupportedNips') }}</p>
            <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              <span
                v-for="nip in info.supported_nips"
                :key="nip"
                class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border"
                :class="KEY_NIPS[nip]
                  ? 'bg-brand/8 text-brand border-brand/20'
                  : 'bg-surface-elevated text-text-secondary border-border'"
                :title="KEY_NIPS[nip] || `NIP-${nip}`"
              >
                {{ nip }}
              </span>
            </div>
          </div>

          <!-- Capabilities -->
          <div v-if="capabilities.length" class="bg-surface-card rounded-3xl border border-border shadow-sm divide-y divide-border overflow-hidden">
            <div class="px-3 py-2 bg-surface-elevated/50">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('relay.infoCapabilities') }}</span>
            </div>
            <div v-for="cap in capabilities" :key="cap.label" class="flex items-center justify-between px-4 py-2.5">
              <span class="text-xs text-text-secondary">{{ cap.label }}</span>
              <span class="text-xs font-medium">{{ cap.value }}</span>
            </div>
          </div>

          <!-- Technical details toggle -->
          <div v-if="info.software || info.pubkey || info.contact">
            <button
              @click="showTechnical = !showTechnical"
              class="flex items-center gap-1.5 text-[10px] font-medium px-1 mb-1.5 transition-all duration-200"
              :class="showTechnical ? 'text-brand' : 'text-text-muted hover:text-text-secondary'"
            >
              <Code class="w-3 h-3" />
              <span>{{ showTechnical ? t('wallet.technicalDetails') : t('wallet.technicalDetails') }}</span>
            </button>

            <div v-if="showTechnical" class="bg-surface-card rounded-3xl border border-border shadow-sm divide-y divide-border overflow-hidden animate-fade-in-up">
              <!-- Software -->
              <div v-if="info.software" class="px-4 py-2.5">
                <div class="text-[9px] text-text-muted font-semibold uppercase tracking-wider mb-0.5">{{ t('relay.infoSoftware') }}</div>
                <p class="text-xs text-text-primary">
                  {{ info.software }}{{ info.version ? ` v${info.version}` : '' }}
                </p>
              </div>

              <!-- Operator -->
              <div v-if="info.pubkey" class="px-4 py-2.5">
                <div class="flex items-center justify-between mb-0.5">
                  <span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('relay.infoOperator') }}</span>
                  <button @click="copy(info.pubkey, 'operator')" class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200">
                    <Check v-if="copiedField === 'operator'" class="w-3 h-3 text-success" />
                    <Copy v-else class="w-3 h-3 text-text-muted" />
                  </button>
                </div>
                <code class="text-[10px] font-mono text-text-secondary break-all">{{ info.pubkey }}</code>
              </div>

              <!-- Contact -->
              <div v-if="info.contact" class="px-4 py-2.5">
                <div class="flex items-center justify-between mb-0.5">
                  <span class="text-[9px] text-text-muted font-semibold uppercase tracking-wider">{{ t('relay.infoContact') }}</span>
                  <button @click="copy(info.contact, 'contact')" class="p-0.5 rounded hover:bg-surface-elevated transition-all duration-200">
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
    </div>
  </div>
</template>

<style scoped>
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 0.25s ease-out;
}
</style>
