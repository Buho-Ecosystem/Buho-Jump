<script setup>
/**
 * Options page — full browser tab settings.
 * Sidebar navigation with deep-link support via ?page= query param.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLock } from '../../composables/useLock.js'
import { useTheme } from '../../composables/useTheme.js'
import { useToast } from '../../composables/useToast.js'
import { useRelays } from '../../composables/useRelays.js'
import LockScreen from '../../components/LockScreen.vue'
import ToastContainer from '../../components/ToastContainer.vue'
import SidebarNav from '../../components/options/SidebarNav.vue'
import ConnectedSitesPage from '../../components/options/ConnectedSitesPage.vue'
import AccountPage from '../../components/options/AccountPage.vue'
import PreferencesPage from '../../components/options/PreferencesPage.vue'
import AboutPage from '../../components/options/AboutPage.vue'
import WalletPage from '../../components/options/WalletPage.vue'
import ActivityPage from '../../components/options/ActivityPage.vue'
import MessagingPage from '../../components/options/MessagingPage.vue'
import RelaySettings from '../../components/RelaySettings.vue'
import { Loader2 } from 'lucide-vue-next'

const { t } = useI18n()
useTheme()
useToast()

const { locked, passwordSet, loading: lockLoading, setup: setupPassword, unlock } = useLock()
const { relayConfig, loadRelays } = useRelays()

// Preload relays when unlocked so RelaySettings has data ready
watch([locked, lockLoading], ([isLocked, isLoading]) => {
  if (!isLoading && !isLocked) {
    loadRelays()
  }
}, { immediate: true })

const accountRelayCount = computed(() => relayConfig.value.account?.length || 0)
const walletRelayCount = computed(() => relayConfig.value.wallet?.length || 0)
const chatRelayCount = computed(() => relayConfig.value.chat?.length || 0)
const totalRelayCount = computed(() => accountRelayCount.value + walletRelayCount.value + chatRelayCount.value)

const lockError = ref('')
const lockBusy = ref(false)

// Deep-link from query param
const urlParams = new URLSearchParams(window.location.search)
const initialPage = urlParams.get('page') || 'sites'
const validPages = ['sites', 'account', 'wallets', 'activity', 'messaging', 'relays', 'preferences', 'about']
const activePage = ref(validPages.includes(initialPage) ? initialPage : 'sites')

function navigate(page) {
  activePage.value = page
  const url = new URL(window.location.href)
  url.searchParams.set('page', page)
  history.replaceState(null, '', url.toString())
}

async function handleSetup(password) {
  lockError.value = ''
  lockBusy.value = true
  try {
    await setupPassword(password)
  } catch (err) {
    lockError.value = err.message || 'Failed to set password'
  } finally {
    lockBusy.value = false
  }
}

async function handleUnlock(password) {
  lockError.value = ''
  lockBusy.value = true
  try {
    await unlock(password)
  } catch (err) {
    const message = err.message || ''
    lockError.value = message.startsWith('TOO_MANY_ATTEMPTS:')
      ? t('lock.tooManyAttempts', { seconds: message.split(':')[1] })
      : message === 'errors.WRONG_PASSWORD' ? t('lock.wrongPassword') : (message || t('lock.wrongPassword'))
  } finally {
    lockBusy.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-surface-base text-text-primary">
    <ToastContainer />

    <!-- Loading -->
    <div v-if="lockLoading" class="flex items-center justify-center min-h-screen">
      <div class="text-center space-y-3 animate-fade-in">
        <Loader2 class="w-8 h-8 text-brand mx-auto animate-spin" />
        <p class="text-sm text-text-muted">{{ t('common.loading') }}</p>
      </div>
    </div>

    <!-- Lock screen -->
    <div v-else-if="locked || !passwordSet" class="flex items-center justify-center min-h-screen">
      <div class="w-full max-w-sm p-4">
        <LockScreen
          :is-setup="!passwordSet"
          :error="lockError"
          :loading="lockBusy"
          @setup="handleSetup"
          @unlock="handleUnlock"
        />
      </div>
    </div>

    <!-- Main layout -->
    <div v-else class="flex flex-col md:flex-row min-h-screen">
      <SidebarNav :active-page="activePage" @navigate="navigate" />

      <!-- Content area -->
      <main class="flex-1 p-6 md:p-10 overflow-y-auto">
        <div class="max-w-3xl mx-auto animate-fade-in-up">
          <ConnectedSitesPage v-if="activePage === 'sites'" />
          <AccountPage v-else-if="activePage === 'account'" />
          <WalletPage v-else-if="activePage === 'wallets'" />
          <ActivityPage v-else-if="activePage === 'activity'" />
          <MessagingPage v-else-if="activePage === 'messaging'" />
          <div v-else-if="activePage === 'relays'" class="max-w-lg">
            <div class="mb-5">
              <h1 class="text-lg font-extrabold">{{ t('options.relays') }}</h1>
              <p class="text-xs text-text-muted mt-0.5">{{ t('options.relaysDesc') }}</p>
            </div>

            <!-- Relay pool summary -->
            <div v-if="totalRelayCount > 0" class="flex items-center gap-3 mb-4 px-1">
              <div class="flex items-center gap-1.5 text-xs text-text-muted">
                <span class="w-1.5 h-1.5 rounded-full bg-brand" />
                <span class="font-medium">{{ accountRelayCount }}</span>
                <span>{{ t('relay.tabAccount') }}</span>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-text-muted">
                <span class="w-1.5 h-1.5 rounded-full bg-warning" />
                <span class="font-medium">{{ walletRelayCount }}</span>
                <span>{{ t('relay.tabWallet') }}</span>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-text-muted">
                <span class="w-1.5 h-1.5 rounded-full bg-info" />
                <span class="font-medium">{{ chatRelayCount }}</span>
                <span>{{ t('relay.tabChat') }}</span>
              </div>
            </div>

            <RelaySettings hide-back />
          </div>
          <PreferencesPage v-else-if="activePage === 'preferences'" />
          <AboutPage v-else-if="activePage === 'about'" />
        </div>
      </main>
    </div>
  </div>
</template>
