<script setup>
/**
 * QR display for wallet payloads.
 *
 * Small values render as one static QR image. Values too large for one
 * clean QR switch to animated frames (NUT-16, UR encoding via bc-ur) that
 * other Cashu wallets scan part by part. Callers that know better than the
 * length heuristic (for example: token proof count, per NUT-16) can force
 * a mode explicitly.
 */
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { QrCode } from 'lucide-vue-next'

const props = defineProps({
  value: { type: String, required: true },
  /** 'auto' | 'static' | 'animated' */
  mode: { type: String, default: 'auto' },
  size: { type: Number, default: 176 },
})

const { t } = useI18n()

// Frame parameters follow the cashu.me reference wallet (fragment length
// 50-150, interval 150-250 ms); middle values scan reliably on most phones.
const FRAGMENT_LENGTH = 100
const FRAME_INTERVAL_MS = 200
// A single QR beyond this many characters gets too dense to scan at popup size.
const STATIC_LIMIT = 800

const qrDataUrl = ref('')
const partNumber = ref(0)
const totalParts = ref(0)
const failed = ref(false)

let encoder = null
let frameTimer = null
let renderToken = 0

const isAnimated = computed(() =>
  props.mode === 'animated' || (props.mode === 'auto' && props.value.length > STATIC_LIMIT)
)

async function toDataUrl(content) {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(content, {
    width: 220,
    margin: 2,
    // The QR always sits on a white card, so the modules must stay black.
    // Theme text colors would render white-on-white in dark mode.
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })
}

async function render() {
  const token = ++renderToken
  stopAnimation()
  qrDataUrl.value = ''
  failed.value = false
  partNumber.value = 0
  totalParts.value = 0
  if (!props.value) return

  try {
    if (!isAnimated.value) {
      const url = await toDataUrl(props.value)
      if (token === renderToken) qrDataUrl.value = url
      return
    }

    const { UR, UREncoder } = await import('@gandlaf21/bc-ur')
    encoder = new UREncoder(UR.from(props.value), FRAGMENT_LENGTH, 0)
    if (token !== renderToken) return
    totalParts.value = encoder.fragmentsLength
    await showNextFrame(token)
    frameTimer = setInterval(() => { showNextFrame(token) }, FRAME_INTERVAL_MS)
  } catch {
    if (token === renderToken) failed.value = true
  }
}

async function showNextFrame(token) {
  if (!encoder) return
  // Uppercase keeps frames in QR alphanumeric mode; UR strings allow it.
  const part = encoder.nextPart().toUpperCase()
  const nextNumber = (partNumber.value % totalParts.value) + 1
  try {
    const url = await toDataUrl(part)
    if (token !== renderToken) return
    qrDataUrl.value = url
    partNumber.value = nextNumber
  } catch {
    if (token === renderToken) failed.value = true
    stopAnimation()
  }
}

function stopAnimation() {
  if (frameTimer) { clearInterval(frameTimer); frameTimer = null }
  encoder = null
}

watch(() => [props.value, props.mode], render)
onMounted(render)
onBeforeUnmount(() => {
  renderToken++
  stopAnimation()
})
</script>

<template>
  <div class="flex flex-col items-center">
    <div v-if="qrDataUrl" class="bg-white p-2.5 rounded-2xl shadow-sm">
      <img :src="qrDataUrl" alt="QR code" :style="{ width: `${size}px`, height: `${size}px` }" />
    </div>
    <div
      v-else
      class="bg-surface-elevated rounded-2xl flex items-center justify-center"
      :style="{ width: `${size + 20}px`, height: `${size + 20}px` }"
    >
      <QrCode class="w-8 h-8 text-text-muted" :class="failed ? '' : 'animate-pulse'" />
    </div>
    <p v-if="totalParts > 1" class="text-[10px] text-text-muted mt-2 font-medium tabular-nums">
      {{ t('qr.animatedPart', { current: partNumber || 1, total: totalParts }) }}
    </p>
    <p v-if="failed" class="text-[10px] text-error mt-2">{{ t('wallet.qrFailed') }}</p>
  </div>
</template>
