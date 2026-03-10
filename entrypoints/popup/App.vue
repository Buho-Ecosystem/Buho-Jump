<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLock } from '../../composables/useLock.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useWallet } from '../../composables/useWallet.js'
import { usePermissions } from '../../composables/usePermissions.js'
import { useTheme } from '../../composables/useTheme.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat, CURRENCIES } from '../../composables/useFiat.js'
import { useLocale } from '../../composables/useLocale.js'
import { truncateKey } from '../../lib/utils.js'
import LockScreen from '../../components/LockScreen.vue'
import IdentityWizard from '../../components/IdentityWizard.vue'
import LanguagePicker from '../../components/LanguagePicker.vue'
import ToastContainer from '../../components/ToastContainer.vue'
import SkeletonLoader from '../../components/SkeletonLoader.vue'
import EmptyState from '../../components/EmptyState.vue'
import SiteDetail from '../../components/SiteDetail.vue'
import BottomSheet from '../../components/BottomSheet.vue'
import SlidePanel from '../../components/SlidePanel.vue'
// Chat sub-views
import ChatHome from '../../components/chat/ChatHome.vue'
import ChatThread from '../../components/chat/ChatThread.vue'
import ContactPicker from '../../components/chat/ContactPicker.vue'
import { useChat } from '../../composables/useChat.js'
import { useContacts } from '../../composables/useContacts.js'
import { useRelays } from '../../composables/useRelays.js'
// Wallet sub-views
import WalletConnect from '../../components/wallet/WalletConnect.vue'
import WalletHome from '../../components/wallet/WalletHome.vue'
import SendFlow from '../../components/wallet/SendFlow.vue'
import ReceiveFlow from '../../components/wallet/ReceiveFlow.vue'
import TransactionHistory from '../../components/wallet/TransactionHistory.vue'
import TransactionDetail from '../../components/wallet/TransactionDetail.vue'
import RelaySettings from '../../components/RelaySettings.vue'
import NotificationSettings from '../../components/NotificationSettings.vue'
import {
  Wallet, Plus, ArrowLeft, Globe, Coins,
  Copy, Check, Trash2, User, Zap, Sun, Moon, Palette,
  Lock, ShieldCheck, ChevronDown, AlertTriangle, AtSign, ExternalLink,
  Settings, X, Loader2, CheckCircle, Languages, MessageSquare, Radio, Bell,
} from 'lucide-vue-next'

const { t } = useI18n()
const { locale, locales, switchLocale } = useLocale()

const activeTab = ref('wallet')
const showLanguagePicker = ref(false)
const showWizard = ref(false)
const copied = ref(false)
const dataLoaded = ref(false)
const lockError = ref('')
const lockBusy = ref(false)

// Wallet sub-view state
const walletView = ref('home')
const walletViewBefore = ref('home')
const showSendPanel = ref(false)
const showReceivePanel = ref(false)

// Chat sub-view state
const chatView = ref('home') // 'home' | 'thread' | 'new'
const chatPubkey = ref(null)
const selectedTx = ref(null)

// Delete confirmation state
const confirmingDelete = ref(null)

// Site detail view
const selectedSite = ref(null)

// Settings menu
const showSettings = ref(false)
const settingsRef = ref(null)

// Loading states for async actions
const switchingAccount = ref(null) // account id being switched to
const confirmSwitchId = ref(null) // account id pending switch confirmation
const deletingAccount = ref(false)
const revokingDomain = ref(null) // domain being revoked
const confirmRevokeDomain = ref(null) // domain pending confirmation

// Permissions popup
const showPermissionsPopup = ref(false)

// Profile data fetched from relays
const profileData = ref(null)
const profileLoading = ref(false)

const { locked, passwordSet, loading: lockLoading, setup: setupPassword, unlock, lock } = useLock()
const { accounts, activeAccount, load: loadAccounts, switchTo, remove, fetchProfile } = useAccounts()
const { status: walletStatus, loadStatus: loadWallet, disconnect: disconnectWallet } = useWallet()
const { policies: permissions, load: loadPermissions, revokeDomain } = usePermissions()
const { currentTheme, currentMode, themes, themeIds, setTheme, toggleMode } = useTheme()
const toast = useToast()
const { currency: fiatCurrency, setCurrency: setFiatCurrency } = useFiat()
const { switchAccount: switchChatAccount, unreadTotal: chatUnreadTotal } = useChat()
const { resetContacts } = useContacts()
const { loadRelays } = useRelays()
const showCurrencyPicker = ref(false)
const showRelaySettings = ref(false)
const showNotificationSettings = ref(false)

function toggleIdentity() {
  activeTab.value = activeTab.value === 'identity' ? 'wallet' : 'identity'
}

const permissionCount = computed(() => Object.keys(permissions.value).length)

// Reset sub-views when switching tabs
watch(activeTab, () => {
  walletView.value = 'home'
  selectedTx.value = null
  selectedSite.value = null
  showPermissionsPopup.value = false
  chatView.value = 'home'
  chatPubkey.value = null
  showSendPanel.value = false
  showReceivePanel.value = false
})

// Fetch profile from relays when active account changes
watch(() => activeAccount.value?.pubkey, async (pubkey) => {
  if (!pubkey) {
    profileData.value = null
    return
  }
  profileLoading.value = true
  try {
    const profile = await fetchProfile(pubkey)
    profileData.value = profile
  } catch {
    profileData.value = null
  } finally {
    profileLoading.value = false
  }
}, { immediate: false })

// Reset all account-scoped state when active account changes
watch(() => activeAccount.value?.pubkey, (newPubkey, oldPubkey) => {
  if (oldPubkey && newPubkey !== oldPubkey) {
    // Close any open overlays — they show account-scoped data
    showRelaySettings.value = false
    showNotificationSettings.value = false
    showPermissionsPopup.value = false
    selectedSite.value = null

    // Reset wallet sub-views (wallet is global but clear navigation state)
    walletView.value = 'home'
    selectedTx.value = null
    showSendPanel.value = false
    showReceivePanel.value = false

    // Reset chat state & subscriptions
    chatView.value = 'home'
    chatPubkey.value = null
    resetContacts()
    switchChatAccount()

    // Reload account-scoped relay config
    loadRelays()
  }
})

// Display name: profile.display_name > profile.name > account.name
const displayName = computed(() => {
  return profileData.value?.display_name || profileData.value?.name || activeAccount.value?.name || '?'
})

// Close settings on click outside
function onClickOutside(e) {
  if (showSettings.value && settingsRef.value && !settingsRef.value.contains(e.target)) {
    showSettings.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutside, true))
onUnmounted(() => document.removeEventListener('click', onClickOutside, true))

function copyPubkey() {
  if (!activeAccount.value?.npub) return
  navigator.clipboard.writeText(activeAccount.value.npub)
  copied.value = true
  toast.success(t('common.copiedToClipboard'))
  setTimeout(() => (copied.value = false), 1500)
}

function requestSwitchAccount(accId) {
  confirmSwitchId.value = accId
}

function cancelSwitch() {
  confirmSwitchId.value = null
}

async function confirmSwitch() {
  const accId = confirmSwitchId.value
  if (!accId || switchingAccount.value) return
  confirmSwitchId.value = null
  switchingAccount.value = accId
  try {
    const acc = accounts.value.find(a => a.id === accId)
    await switchTo(accId)
    await loadPermissions()
    profileData.value = null
    if (acc?.pubkey) {
      profileLoading.value = true
      try {
        profileData.value = await fetchProfile(acc.pubkey)
      } catch { profileData.value = null }
      finally { profileLoading.value = false }
    }
    toast.success(t('toast.switchedTo', { name: acc?.name || t('tabs.account') }))
  } catch (err) {
    toast.error(t('toast.failedSwitch'))
  } finally {
    switchingAccount.value = null
  }
}

function requestDelete(accId) {
  confirmingDelete.value = accId
}

function cancelDelete() {
  confirmingDelete.value = null
}

async function confirmDelete() {
  if (!confirmingDelete.value || deletingAccount.value) return
  deletingAccount.value = true
  try {
    const acc = accounts.value.find(a => a.id === confirmingDelete.value)
    await remove(confirmingDelete.value)
    await loadPermissions()
    confirmingDelete.value = null
    toast.info(t('toast.accountRemoved', { name: acc?.name || t('tabs.account') }))
  } catch (err) {
    toast.error(t('toast.failedRemove'))
  } finally {
    deletingAccount.value = false
  }
}

function requestRevoke(host) {
  confirmRevokeDomain.value = host
}

function cancelRevoke() {
  confirmRevokeDomain.value = null
}

async function handleRevokeDomain(host) {
  revokingDomain.value = host
  try {
    await revokeDomain(host)
    confirmRevokeDomain.value = null
    toast.info(t('toast.revokedAccess', { host }))
  } catch (err) {
    toast.error(t('toast.failedRevoke'))
  } finally {
    revokingDomain.value = null
  }
}

async function handleDisconnectWallet() {
  await disconnectWallet()
  walletView.value = 'home'
  toast.info(t('toast.walletDisconnected'))
}

function onWizardComplete() {
  showWizard.value = false
  loadAccounts()
  toast.success(t('toast.accountReady'))
}

async function handleSetup(password) {
  lockError.value = ''
  lockBusy.value = true
  try {
    await setupPassword(password)
    await loadData()
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
    await loadData()
  } catch (err) {
    lockError.value = err.message || 'Wrong password'
  } finally {
    lockBusy.value = false
  }
}

async function loadData() {
  await Promise.all([loadAccounts(), loadWallet(), loadPermissions()])
  dataLoaded.value = true
  if (accounts.value.length === 0) {
    showWizard.value = true
  } else if (activeAccount.value?.pubkey) {
    profileLoading.value = true
    fetchProfile(activeAccount.value.pubkey)
      .then(p => { profileData.value = p })
      .catch(() => { profileData.value = null })
      .finally(() => { profileLoading.value = false })
  }
}

function showTxDetail(tx) {
  walletViewBefore.value = walletView.value
  selectedTx.value = tx
  walletView.value = 'detail'
}

function closeTxDetail() {
  walletView.value = walletViewBefore.value || 'home'
  selectedTx.value = null
}

function handleLock() {
  showSettings.value = false
  lock()
}

// Handle ?tab= query param from notification clicks
const urlParams = new URLSearchParams(window.location.search)
const targetTab = urlParams.get('tab')
if (targetTab === 'chat') activeTab.value = 'chat'
else if (targetTab === 'wallet') activeTab.value = 'wallet'

function onLanguageSelected() {
  showLanguagePicker.value = false
}

// Load data when unlocked
watch([locked, lockLoading], async ([isLocked, isLoading]) => {
  if (!isLoading && !isLocked && !dataLoaded.value) {
    try {
      await loadData()
    } catch (err) {
      console.warn('[app] loadData failed:', err)
      dataLoaded.value = true
    }
  }
})
</script>

<template>
  <div class="popup-container bg-surface-base text-text-primary">
    <ToastContainer />

    <!-- Loading state -->
    <div v-if="lockLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-3 animate-fade-in">
        <Zap class="w-8 h-8 text-brand mx-auto animate-pulse" />
        <p class="text-xs text-text-muted">{{ t('common.loading') }}</p>
      </div>
    </div>

    <!-- Lock screen / Password setup -->
    <template v-else-if="locked || !passwordSet">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-2">
          <Zap class="w-5 h-5 text-brand" />
          <span class="font-semibold text-sm tracking-tight">Buho Jump</span>
        </div>
        <!-- Minimal settings on lock screen -->
        <div class="relative" ref="settingsRef">
          <button @click.stop="showSettings = !showSettings"
            class="p-1.5 rounded-lg hover:bg-surface-elevated transition-colors"
            title="Settings">
            <Settings class="w-4 h-4 text-text-muted" />
          </button>

          <!-- Lock screen settings dropdown (theme only) -->
          <div v-if="showSettings"
            class="absolute right-0 top-full mt-1.5 w-56 bg-surface-card rounded-xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-right">
            <!-- Mode toggle -->
            <button @click="toggleMode"
              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors text-left">
              <Sun v-if="currentMode === 'dark'" class="w-4 h-4 text-text-muted" />
              <Moon v-else class="w-4 h-4 text-text-muted" />
              <span class="text-xs font-medium">{{ currentMode === 'dark' ? t('settings.switchToLight') : t('settings.switchToDark') }}</span>
            </button>
            <div class="h-px bg-border" />
            <!-- Theme list -->
            <div class="px-3 py-2">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.theme') }}</span>
            </div>
            <button v-for="id in themeIds" :key="id"
              @click="setTheme(id)"
              class="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-elevated transition-colors text-left">
              <span class="text-xs" :class="currentTheme === id ? 'font-semibold text-brand' : 'text-text-secondary'">
                {{ themes[id]?.label }}
              </span>
              <CheckCircle v-if="currentTheme === id" class="w-3.5 h-3.5 text-brand" />
            </button>
          </div>
        </div>
      </header>

      <LockScreen
        :is-setup="!passwordSet"
        :error="lockError"
        :loading="lockBusy"
        @setup="handleSetup"
        @unlock="handleUnlock"
      />
    </template>

    <!-- Main UI (after unlock) -->
    <template v-else>

      <!-- ═══ Profile Header ═══ -->
      <header class="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <!-- Profile area (tappable to expand identity) -->
        <button
          v-if="activeAccount"
          @click="toggleIdentity"
          class="flex items-center gap-2.5 flex-1 min-w-0 text-left transition-colors rounded-lg -ml-1 pl-1 py-0.5"
          :class="activeTab === 'identity' ? 'bg-surface-elevated/50' : 'hover:bg-surface-elevated/30'"
        >
          <!-- Avatar -->
          <div class="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-border shadow-sm"
            :class="profileData?.picture ? '' : 'bg-brand flex items-center justify-center'">
            <img v-if="profileData?.picture" :src="profileData.picture" alt="" class="w-full h-full object-cover" @error="profileData.picture = null" />
            <div v-else-if="profileLoading && !profileData" class="w-full h-full skeleton-shimmer" />
            <span v-else class="text-surface-base text-xs font-bold">{{ displayName[0]?.toUpperCase() }}</span>
          </div>
          <!-- Name + npub -->
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-bold truncate leading-tight">{{ displayName }}</div>
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] text-text-muted truncate font-mono">{{ activeAccount.npub ? truncateKey(activeAccount.npub, 8, 4) : '' }}</span>
              <span class="flex items-center gap-0.5 text-[8px] font-semibold px-1 py-px rounded-full shrink-0"
                :class="activeAccount.mode === 'local'
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning'">
                <span class="w-1 h-1 rounded-full" :class="activeAccount.mode === 'local' ? 'bg-success' : 'bg-warning'" />
                {{ activeAccount.mode === 'local' ? t('account.local') : t('account.external') }}
              </span>
            </div>
          </div>
          <ChevronDown class="w-3.5 h-3.5 text-text-muted transition-transform duration-200 shrink-0" :class="activeTab === 'identity' ? 'rotate-180' : ''" />
        </button>
        <!-- Fallback when no account -->
        <div v-else class="flex items-center gap-2 flex-1">
          <Zap class="w-5 h-5 text-brand" />
          <span class="font-semibold text-sm tracking-tight">Buho Jump</span>
        </div>

        <!-- Settings button + dropdown -->
        <div class="relative shrink-0" ref="settingsRef">
          <button @click.stop="showSettings = !showSettings"
            class="p-1.5 rounded-lg transition-colors"
            :class="showSettings ? 'bg-surface-elevated' : 'hover:bg-surface-elevated'"
            title="Settings">
            <Settings class="w-4 h-4 transition-transform duration-200" :class="showSettings ? 'text-brand rotate-90' : 'text-text-muted'" />
          </button>

          <!-- Settings dropdown -->
          <div v-if="showSettings"
            class="absolute right-0 top-full mt-1.5 w-60 max-h-[75vh] overflow-y-auto bg-surface-card rounded-xl border border-border shadow-lg z-50 animate-scale-in origin-top-right">

            <!-- Appearance section -->
            <div class="px-4 pt-3 pb-1.5">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.appearance') }}</span>
            </div>

            <!-- Mode toggle -->
            <button @click="toggleMode"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Sun v-if="currentMode === 'dark'" class="w-3.5 h-3.5 text-warning" />
                <Moon v-else class="w-3.5 h-3.5 text-info" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ currentMode === 'dark' ? t('settings.lightMode') : t('settings.darkMode') }}</span>
                <span class="text-[9px] text-text-muted">{{ currentMode === 'dark' ? t('settings.currentlyDark') : t('settings.currentlyLight') }}</span>
              </div>
            </button>

            <!-- Theme picker (compact dot row) -->
            <div class="px-4 pt-2 pb-2.5 flex items-center gap-3">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold shrink-0">{{ t('settings.theme') }}</span>
              <div class="flex items-center gap-1.5 flex-1 justify-end">
                <button v-for="id in themeIds" :key="id"
                  @click="setTheme(id)"
                  class="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 shrink-0"
                  :class="currentTheme === id ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface-card scale-110' : 'hover:scale-110'"
                  :title="themes[id]?.label"
                >
                  <span class="w-4 h-4 rounded-full border border-border/50"
                    :style="{ background: themes[id]?.dark?.['brand-primary'] || '#888' }" />
                </button>
              </div>
            </div>

            <div class="h-px bg-border" />

            <!-- Language section -->
            <div class="px-4 pt-2.5 pb-1.5">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.language') }}</span>
            </div>
            <button @click="showLanguagePicker = !showLanguagePicker"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Languages class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ locales.find(l => l.code === locale)?.native || 'English' }}</span>
                <span class="text-[9px] text-text-muted">{{ t('settings.language') }}</span>
              </div>
            </button>
            <div v-if="showLanguagePicker" class="px-2 pb-2">
              <LanguagePicker compact @select="showLanguagePicker = false" />
            </div>

            <div class="h-px bg-border" />

            <!-- Currency section -->
            <div class="px-4 pt-2.5 pb-1.5">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.currency') }}</span>
            </div>
            <button @click="showCurrencyPicker = !showCurrencyPicker"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Coins class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ CURRENCIES.find(c => c.code === fiatCurrency)?.symbol }} {{ fiatCurrency.toUpperCase() }}</span>
                <span class="text-[9px] text-text-muted">{{ t('settings.currencyDesc') }}</span>
              </div>
            </button>
            <div v-if="showCurrencyPicker" class="px-3 pb-2 max-h-40 overflow-y-auto">
              <div class="space-y-0.5">
                <button v-for="cur in CURRENCIES" :key="cur.code"
                  @click="setFiatCurrency(cur.code); showCurrencyPicker = false"
                  class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors text-left"
                  :class="fiatCurrency === cur.code ? 'bg-brand/8' : 'hover:bg-surface-elevated'">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono w-5 text-center">{{ cur.symbol }}</span>
                    <span class="text-xs" :class="fiatCurrency === cur.code ? 'font-semibold text-brand' : 'text-text-secondary'">
                      {{ cur.code.toUpperCase() }}
                    </span>
                    <span class="text-[9px] text-text-muted">{{ cur.name }}</span>
                  </div>
                  <Check v-if="fiatCurrency === cur.code" class="w-3 h-3 text-brand" />
                </button>
              </div>
            </div>

            <div class="h-px bg-border" />

            <!-- Relay settings -->
            <button @click="showRelaySettings = true; showNotificationSettings = false; showWizard = false; showSettings = false"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Radio class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ t('settings.relaySettings') }}</span>
                <span class="text-[9px] text-text-muted">{{ t('settings.relaySettingsDesc') }}</span>
              </div>
            </button>

            <!-- Notification settings -->
            <button @click="showNotificationSettings = true; showRelaySettings = false; showWizard = false; showSettings = false"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Bell class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ t('notifications.settingsLabel') }}</span>
                <span class="text-[9px] text-text-muted">{{ t('notifications.settingsDesc') }}</span>
              </div>
            </button>

            <div class="h-px bg-border" />

            <!-- Security section -->
            <div class="px-4 pt-2.5 pb-1.5">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.security') }}</span>
            </div>
            <button @click="handleLock"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-colors text-left">
              <div class="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center">
                <Lock class="w-3.5 h-3.5 text-text-muted" />
              </div>
              <div>
                <span class="text-xs font-medium block">{{ t('settings.lockExtension') }}</span>
                <span class="text-[9px] text-text-muted">{{ t('settings.lockDesc') }}</span>
              </div>
            </button>

            <!-- Version footer -->
            <div class="px-4 py-2.5 border-t border-border mt-1">
              <span class="text-[9px] text-text-muted">{{ t('settings.version', { version: '0.1.0' }) }}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Wizard overlay -->
      <div v-if="showWizard" class="flex-1 overflow-y-auto p-4 animate-fade-in-up">
        <IdentityWizard @complete="onWizardComplete" @cancel="showWizard = false" />
      </div>

      <!-- Relay settings overlay -->
      <div v-else-if="showRelaySettings" class="flex-1 overflow-y-auto p-4">
        <RelaySettings @back="showRelaySettings = false" />
      </div>

      <!-- Notification settings overlay -->
      <div v-else-if="showNotificationSettings" class="flex-1 overflow-y-auto p-4">
        <NotificationSettings @back="showNotificationSettings = false" />
      </div>

      <!-- Main content area -->
      <template v-else>

        <!-- Loading skeleton -->
        <div v-if="!dataLoaded" class="flex-1 overflow-y-auto p-4 space-y-4">
          <div class="bg-surface-card rounded-xl p-4 border border-border space-y-3">
            <div class="flex items-center gap-3">
              <SkeletonLoader width="36px" height="36px" rounded="rounded-full" />
              <div class="flex-1 space-y-2">
                <SkeletonLoader width="120px" height="14px" />
                <SkeletonLoader width="80px" height="10px" />
              </div>
            </div>
            <SkeletonLoader height="32px" rounded="rounded-lg" />
          </div>
        </div>

        <!-- Scrollable content -->
        <div v-else class="flex-1 flex flex-col overflow-y-auto" :class="activeTab === 'chat' && chatView === 'thread' ? 'overflow-hidden' : ''">

          <!-- ══════════════════════════════════════════════ -->
          <!-- ══ Identity Tab                            ══ -->
          <!-- ══════════════════════════════════════════════ -->
          <section v-if="activeTab === 'identity'" class="p-4 space-y-4">

            <!-- Site detail overlay -->
            <SiteDetail
              v-if="selectedSite"
              :host="selectedSite"
              :methods="permissions[selectedSite] || {}"
              @back="selectedSite = null"
              @revoked="selectedSite = null; loadPermissions()"
            />

            <!-- Connected sites popup -->
            <div v-else-if="showPermissionsPopup" class="space-y-3 animate-fade-in-up">
              <div class="flex items-center gap-2">
                <button @click="showPermissionsPopup = false" class="p-1 rounded-md hover:bg-surface-elevated transition-colors">
                  <ArrowLeft class="w-4 h-4 text-text-muted" />
                </button>
                <span class="text-sm font-semibold">{{ t('account.connectedSites') }}</span>
              </div>

              <div v-if="permissionCount > 0" class="space-y-1">
                <button v-for="(methods, host) in permissions" :key="host"
                  @click="selectedSite = host"
                  class="w-full flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-xl border border-border hover:border-brand/30 transition-all group">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <div class="w-7 h-7 rounded-lg bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
                      <Globe class="w-3.5 h-3.5 text-text-muted" />
                    </div>
                    <div class="min-w-0">
                      <span class="text-xs font-medium truncate block">{{ host }}</span>
                      <span class="text-[9px] text-text-muted">{{ Object.keys(methods).length }} {{ t('sites.permissionsGranted') }}</span>
                    </div>
                  </div>
                  <ChevronDown class="w-3 h-3 text-text-muted -rotate-90 group-hover:text-brand transition-colors shrink-0" />
                </button>
              </div>

              <div v-else class="bg-surface-card rounded-xl border border-border p-6 text-center">
                <Globe class="w-5 h-5 text-text-muted mx-auto mb-2" />
                <p class="text-xs text-text-muted">{{ t('account.noSites') }}</p>
                <p class="text-[10px] text-text-muted mt-0.5">{{ t('account.noSitesHint') }}</p>
              </div>
            </div>

            <!-- Active identity card -->
            <template v-else>
            <div v-if="activeAccount" class="bg-surface-card rounded-xl border border-border animate-fade-in-up overflow-hidden">

              <!-- Profile header — banner or gradient fallback -->
              <div class="relative">
                <div v-if="profileData?.banner" class="h-20 overflow-hidden">
                  <img
                    :src="profileData.banner"
                    alt=""
                    class="w-full h-full object-cover"
                    @error="profileData.banner = null"
                  />
                </div>
                <div v-else class="h-16 bg-gradient-to-br from-brand/15 via-brand/5 to-transparent" />

                <!-- Avatar — overlaps the banner bottom edge -->
                <div class="absolute -bottom-5 left-4">
                  <div class="w-11 h-11 rounded-full border-2 border-surface-card overflow-hidden shrink-0 shadow-sm"
                    :class="profileData?.picture ? '' : 'bg-brand flex items-center justify-center'">
                    <img v-if="profileData?.picture" :src="profileData.picture" alt="" class="w-full h-full object-cover" />
                    <div v-else-if="profileLoading" class="w-full h-full skeleton-shimmer" />
                    <span v-else class="text-surface-base text-sm font-bold">{{ displayName[0].toUpperCase() }}</span>
                  </div>
                </div>

                <!-- Mode badge — sits on top of banner with backdrop blur -->
                <div class="absolute top-2.5 right-3 flex items-center gap-1.5">
                  <span class="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border backdrop-blur-sm"
                    :class="activeAccount.mode === 'local'
                      ? 'bg-success/10 text-success border-success/20'
                      : 'bg-warning/10 text-warning border-warning/20'">
                    <span class="w-1 h-1 rounded-full" :class="activeAccount.mode === 'local' ? 'bg-success' : 'bg-warning'" />
                    {{ activeAccount.mode === 'local' ? t('account.onThisDevice') : t('account.externalSigner') }}
                  </span>
                </div>
              </div>

              <!-- Identity info -->
              <div class="px-4 pt-7 pb-3 space-y-3">
                <!-- Name + about -->
                <div>
                  <div v-if="profileLoading && !profileData" class="space-y-1.5">
                    <div class="skeleton-shimmer h-4 w-32 rounded" />
                    <div class="skeleton-shimmer h-3 w-48 rounded" />
                  </div>
                  <template v-else>
                    <div class="flex items-center gap-1.5">
                      <span class="font-bold text-sm truncate">{{ displayName }}</span>
                      <span v-if="profileData?.nip05" class="text-[9px] text-brand font-medium truncate">
                        {{ profileData.nip05 }}
                      </span>
                    </div>
                    <p v-if="profileData?.about" class="text-[10px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed">
                      {{ profileData.about }}
                    </p>
                    <p v-else class="text-[10px] text-text-muted mt-0.5">{{ t('account.activeDesc') }}</p>
                  </template>
                </div>

                <!-- Pubkey row -->
                <div v-if="activeAccount.npub" class="flex items-center gap-2">
                  <code class="flex-1 text-[10px] bg-surface-base px-2.5 py-1.5 rounded-lg font-mono text-text-muted truncate">
                    {{ truncateKey(activeAccount.npub, 14, 8) }}
                  </code>
                  <button @click="copyPubkey" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-colors shrink-0">
                    <Check v-if="copied" class="w-3.5 h-3.5 text-success" />
                    <Copy v-else class="w-3.5 h-3.5 text-text-muted" />
                  </button>
                </div>

                <!-- Profile metadata pills -->
                <div v-if="profileData?.lud16 || profileData?.lud19 || profileLoading" class="flex items-center gap-2 flex-wrap">
                  <div v-if="profileData?.lud16" class="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
                    <Zap class="w-2.5 h-2.5" />
                    <span class="truncate max-w-[180px]">{{ profileData.lud16 }}</span>
                  </div>
                  <div v-else-if="profileData?.lud19" class="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
                    <Zap class="w-2.5 h-2.5" />
                    <span>LNURL set</span>
                  </div>
                  <div v-if="profileLoading && !profileData" class="skeleton-shimmer h-4 w-24 rounded-full" />
                </div>
              </div>

              <!-- Connected sites button -->
              <div v-if="permissionCount > 0" class="border-t border-border px-4 py-3">
                <button @click="showPermissionsPopup = true"
                  class="w-full flex items-center justify-between py-1.5 group">
                  <div class="flex items-center gap-1.5">
                    <ShieldCheck class="w-3 h-3 text-text-muted" />
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{{ t('account.connectedSites') }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-muted font-semibold">{{ permissionCount }}</span>
                    <ChevronDown class="w-3 h-3 text-text-muted -rotate-90 group-hover:text-brand transition-colors" />
                  </div>
                </button>
              </div>
            </div>

            <!-- Empty state -->
            <EmptyState
              v-if="!activeAccount"
              :icon="User"
              :title="t('account.noAccountTitle')"
              :description="t('account.noAccountDesc')"
              :action-label="t('account.addAccount')"
              @action="showWizard = true"
            />

            <!-- Other accounts (switch) -->
            <div v-if="accounts.length > 1" class="space-y-1.5 animate-fade-in-up stagger-2">
              <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('account.switchAccount') }}</p>
              <button
                v-for="acc in accounts.filter(a => !a.isActive)"
                :key="acc.id"
                @click="requestSwitchAccount(acc.id)"
                :disabled="!!switchingAccount"
                class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-surface-card border border-transparent hover:border-border transition-all text-sm group disabled:opacity-60"
              >
                <div class="flex items-center gap-2.5">
                  <!-- Loading spinner replaces avatar when switching -->
                  <div v-if="switchingAccount === acc.id"
                    class="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center">
                    <Loader2 class="w-3.5 h-3.5 text-brand animate-spin" />
                  </div>
                  <div v-else class="w-7 h-7 rounded-full bg-surface-elevated flex items-center justify-center text-[10px] font-bold text-text-secondary">
                    {{ (acc.name || '?')[0].toUpperCase() }}
                  </div>
                  <div>
                    <span class="text-text-secondary font-medium">{{ acc.name }}</span>
                    <span v-if="switchingAccount === acc.id" class="text-[9px] ml-1.5 text-brand font-medium">
                      {{ t('account.switching') }}
                    </span>
                    <span v-else class="text-[9px] ml-1.5 px-1.5 py-px rounded font-medium"
                      :class="acc.mode === 'nip46'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-surface-elevated text-text-muted'">
                      {{ acc.mode === 'nip46' ? t('account.external') : t('account.local') }}
                    </span>
                  </div>
                </div>
                <span
                  v-if="!switchingAccount"
                  role="button"
                  @click.stop="requestDelete(acc.id)"
                  class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all cursor-pointer"
                  title="Remove account"
                >
                  <Trash2 class="w-3.5 h-3.5 text-text-muted hover:text-error" />
                </span>
              </button>
            </div>

            <!-- Switch account confirmation (bottom sheet) -->
            <BottomSheet :open="!!confirmSwitchId" variant="brand" @close="cancelSwitch">
              <template #icon><AlertTriangle class="w-4 h-4 text-brand" /></template>
              <template #title>{{ t('account.switchConfirmTitle') }}</template>
              <template #description>{{ t('account.switchConfirmDesc') }}</template>
              <template #actions>
                <button @click="cancelSwitch"
                  :disabled="!!switchingAccount"
                  class="py-2 text-xs rounded-lg bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold disabled:opacity-60">
                  {{ t('common.cancel') }}
                </button>
                <button @click="confirmSwitch"
                  :disabled="!!switchingAccount"
                  class="py-2 text-xs rounded-lg bg-brand text-surface-base hover:bg-brand-hover transition-colors font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 btn-primary">
                  <Loader2 v-if="switchingAccount" class="w-3 h-3 animate-spin" />
                  {{ switchingAccount ? t('account.switching') : t('account.switchConfirmBtn') }}
                </button>
              </template>
            </BottomSheet>

            <!-- Delete confirmation (bottom sheet) -->
            <BottomSheet :open="!!confirmingDelete" variant="danger" @close="cancelDelete">
              <template #icon><AlertTriangle class="w-4 h-4 text-error" /></template>
              <template #title>{{ t('account.deleteTitle') }}</template>
              <template #description>{{ t('account.deleteDesc') }}</template>
              <template #actions>
                <button @click="cancelDelete"
                  :disabled="deletingAccount"
                  class="py-2 text-xs rounded-lg bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-colors font-semibold disabled:opacity-60">
                  {{ t('common.cancel') }}
                </button>
                <button @click="confirmDelete"
                  :disabled="deletingAccount"
                  class="py-2 text-xs rounded-lg bg-error text-white hover:bg-error/90 transition-colors font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
                  <Loader2 v-if="deletingAccount" class="w-3 h-3 animate-spin" />
                  {{ deletingAccount ? t('account.removing') : t('account.deleteForever') }}
                </button>
              </template>
            </BottomSheet>

            <button @click="showWizard = true"
              class="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-xl border border-dashed border-border text-text-muted hover:text-brand hover:border-brand transition-colors">
              <Plus class="w-4 h-4" />
              {{ t('account.addAccount') }}
            </button>
            </template>
          </section>

          <!-- ══════════════════════════════════════════════ -->
          <!-- ══ Wallet Tab                              ══ -->
          <!-- ══════════════════════════════════════════════ -->
          <section v-else-if="activeTab === 'wallet'" class="p-4">

            <!-- Not connected -->
            <WalletConnect v-if="!walletStatus.connected" />

            <!-- Connected: sub-views -->
            <template v-else>
              <WalletHome
                v-if="walletView === 'home'"
                @send="showSendPanel = true"
                @receive="showReceivePanel = true"
                @history="walletView = 'history'"
                @detail="showTxDetail"
                @disconnect="handleDisconnectWallet"
              />

              <TransactionHistory
                v-else-if="walletView === 'history'"
                @back="walletView = 'home'"
                @detail="showTxDetail"
              />

              <TransactionDetail
                v-else-if="walletView === 'detail' && selectedTx"
                :tx="selectedTx"
                @close="closeTxDetail"
              />
            </template>
          </section>

          <!-- ══════════════════════════════════════════════ -->
          <!-- ══ Chat Tab                               ══ -->
          <!-- ══════════════════════════════════════════════ -->
          <section v-else-if="activeTab === 'chat'"
            class="flex flex-col"
            :class="chatView === 'thread' ? 'flex-1 min-h-0' : 'p-4'">
            <ChatHome
              v-if="chatView === 'home'"
              @open="(pk) => { chatPubkey = pk; chatView = 'thread' }"
              @new-chat="chatView = 'new'"
            />

            <ChatThread
              v-else-if="chatView === 'thread' && chatPubkey"
              :pubkey="chatPubkey"
              @back="chatView = 'home'; chatPubkey = null"
              class="flex-1 min-h-0"
            />

            <ContactPicker
              v-else-if="chatView === 'new'"
              @back="chatView = 'home'"
              @open="(pk) => { chatPubkey = pk; chatView = 'thread' }"
            />
          </section>

          </div><!-- /scrollable content -->

        <!-- ═══ Bottom Tab Bar ═══ -->
        <nav class="bottom-tabs">
          <button
            @click="activeTab = 'wallet'"
            class="bottom-tab"
            :class="{ active: activeTab === 'wallet' }"
          >
            <Wallet class="w-4 h-4" />
            {{ t('tabs.wallet') }}
          </button>
          <button
            @click="activeTab = 'chat'"
            class="bottom-tab"
            :class="{ active: activeTab === 'chat' }"
          >
            <MessageSquare class="w-4 h-4" />
            {{ t('tabs.chat') }}
            <span
              v-if="chatUnreadTotal > 0 && activeTab !== 'chat'"
              class="tab-badge"
            />
          </button>
        </nav>

        <!-- Send slide panel -->
        <SlidePanel :open="showSendPanel" @close="showSendPanel = false">
          <SendFlow @back="showSendPanel = false" @done="showSendPanel = false" />
        </SlidePanel>

        <!-- Receive slide panel -->
        <SlidePanel :open="showReceivePanel" @close="showReceivePanel = false">
          <ReceiveFlow @back="showReceivePanel = false" @done="showReceivePanel = false" />
        </SlidePanel>

      </template>
    </template>
  </div>
</template>
