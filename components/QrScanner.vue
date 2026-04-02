<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, X, AlertTriangle, Upload } from 'lucide-vue-next'

const { t } = useI18n()

const emit = defineEmits(['scan', 'close'])

const readerId = 'qr-reader-' + Math.random().toString(36).slice(2, 8)
const scanning = ref(false)
const error = ref('')
const cameraUnavailable = ref(false)
// Extension popups cannot access getUserMedia — skip camera entirely
const isExtensionPopup = typeof chrome !== 'undefined' && !!chrome.runtime?.id
let scanner = null

async function startScanning() {
  if (isExtensionPopup) {
    cameraUnavailable.value = true
    return
  }

  error.value = ''

  try {
    // Check if camera is available before attempting
    const devices = await Html5Qrcode.getCameras()
    if (!devices || devices.length === 0) {
      cameraUnavailable.value = true
      return
    }

    scanner = new Html5Qrcode(readerId)
    scanning.value = true

    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (text) => {
        stopScanning()
        emit('scan', text)
      },
      () => {} // ignore partial results
    )
  } catch (err) {
    scanning.value = false
    const msg = err.toString()
    if (msg.includes('NotAllowed') || msg.includes('Permission')) {
      cameraUnavailable.value = true
      error.value = t('qr.cameraBlocked')
    } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
      cameraUnavailable.value = true
      error.value = t('qr.cameraBlocked')
    } else {
      error.value = t('qr.cameraFailed')
    }
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  error.value = ''

  try {
    const fileScanner = new Html5Qrcode(readerId + '-file')
    const result = await fileScanner.scanFile(file, true)
    fileScanner.clear()
    emit('scan', result)
  } catch {
    error.value = t('qr.noQrFound')
  }
}

function stopScanning() {
  if (scanner) {
    scanner.stop().catch(() => {})
    scanner.clear()
    scanner = null
  }
  scanning.value = false
}

function close() {
  stopScanning()
  emit('close')
}

onMounted(() => {
  startScanning()
})

onBeforeUnmount(() => {
  stopScanning()
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
        <Camera class="w-3.5 h-3.5" />
        {{ t('qr.scanTitle') }}
      </div>
      <button @click="close" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200">
        <X class="w-3.5 h-3.5 text-text-muted" />
      </button>
    </div>

    <!-- Camera scanner viewport -->
    <div v-if="!cameraUnavailable" class="relative rounded-3xl overflow-hidden bg-black" style="min-height: 240px">
      <div :id="readerId" class="w-full" />
      <div v-if="!scanning && !error"
        class="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
        {{ t('qr.startingCamera') }}
      </div>
    </div>

    <!-- File upload (primary when camera unavailable, alternative otherwise) -->
    <label
      class="flex flex-col items-center gap-2.5 rounded-3xl border border-dashed cursor-pointer transition-all duration-200"
      :class="cameraUnavailable
        ? 'p-6 bg-surface-card border-brand/30 hover:border-brand hover:bg-brand/5'
        : 'p-4 border-border hover:border-brand'">
      <div v-if="cameraUnavailable" class="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
        <Upload class="w-5 h-5 text-brand" />
      </div>
      <Upload v-else class="w-5 h-5 text-text-muted" />
      <div class="text-center">
        <span class="text-xs font-medium" :class="cameraUnavailable ? 'text-text-primary' : 'text-text-muted'">
          {{ cameraUnavailable ? t('qr.uploadImage') : t('qr.orUpload') }}
        </span>
        <p v-if="cameraUnavailable && isExtensionPopup" class="text-[10px] text-text-muted mt-1">
          {{ t('qr.extensionHint') }}
        </p>
      </div>
      <input type="file" accept="image/*" class="hidden" @change="handleFileUpload" />
    </label>

    <!-- Hidden div for file scanning -->
    <div :id="readerId + '-file'" class="hidden" />

    <!-- Error -->
    <div v-if="error" class="flex items-start gap-2 p-2.5 rounded-2xl bg-error/10 text-error text-xs">
      <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <p v-if="!cameraUnavailable" class="text-[10px] text-text-muted text-center">
      {{ t('qr.pointCamera') }}
    </p>
  </div>
</template>
