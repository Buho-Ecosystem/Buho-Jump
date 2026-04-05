<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLock } from '../../composables/useLock.js'
import { useAccounts } from '../../composables/useAccounts.js'
import { useWallet } from '../../composables/useWallet.js'
import { usePermissions } from '../../composables/usePermissions.js'
import { useAllowanceSync } from '../../composables/useAllowanceSync.js'
import { useTheme } from '../../composables/useTheme.js'
import { useToast } from '../../composables/useToast.js'
import { useFiat, CURRENCIES } from '../../composables/useFiat.js'
import { useLocale } from '../../composables/useLocale.js'
import { useListKeyboard } from '../../composables/useListKeyboard.js'
import { usePopupState } from '../../composables/usePopupState.js'
import { truncateKey } from '../../lib/utils.js'
import { nip19, nip21 } from 'nostr-core'
import QRCode from 'qrcode'
import LockScreen from '../../components/LockScreen.vue'
import WelcomeScreen from '../../components/WelcomeScreen.vue'
import IdentityWizard from '../../components/IdentityWizard.vue'
import LanguagePicker from '../../components/LanguagePicker.vue'
import ToastContainer from '../../components/ToastContainer.vue'
import SkeletonLoader from '../../components/SkeletonLoader.vue'
import EmptyState from '../../components/EmptyState.vue'
import SiteDetail from '../../components/SiteDetail.vue'
import SiteContextBar from '../../components/SiteContextBar.vue'
import BottomSheet from '../../components/BottomSheet.vue'
import SlidePanel from '../../components/SlidePanel.vue'
import BottomTabs from '../../components/popup/BottomTabs.vue'
// Chat sub-views
import ChatHome from '../../components/chat/ChatHome.vue'
import ChatThread from '../../components/chat/ChatThread.vue'
import ContactPicker from '../../components/chat/ContactPicker.vue'
import GroupThread from '../../components/chat/GroupThread.vue'
import GroupCreate from '../../components/chat/GroupCreate.vue'
import GroupInfo from '../../components/chat/GroupInfo.vue'
import { useChat } from '../../composables/useChat.js'
import { useOnline } from '../../composables/useOnline.js'
import { useGroups } from '../../composables/useGroups.js'
import { useContacts } from '../../composables/useContacts.js'
import { useRelays } from '../../composables/useRelays.js'
// Wallet sub-views
import WalletConnect from '../../components/wallet/WalletConnect.vue'
import NoWalletHome from '../../components/wallet/NoWalletHome.vue'
import WalletHome from '../../components/wallet/WalletHome.vue'
import WalletSelector from '../../components/wallet/WalletSelector.vue'
import SendFlow from '../../components/wallet/SendFlow.vue'
import ReceiveFlow from '../../components/wallet/ReceiveFlow.vue'
import TransactionHistory from '../../components/wallet/TransactionHistory.vue'
import TransactionDetail from '../../components/wallet/TransactionDetail.vue'
import RelaySettings from '../../components/RelaySettings.vue'
import NotificationSettings from '../../components/NotificationSettings.vue'
import OpenInBrowserButton from '../../components/OpenInBrowserButton.vue'
import {
  Plus, ArrowLeft, Globe, Coins,
  Copy, Check, Trash2, Wallet as WalletIcon, Sun, Moon,
  Lock, ShieldCheck, ChevronDown, AlertTriangle,
  Settings, Loader2, CheckCircle, Languages, Radio, Bell,
  QrCode, PictureInPicture2, WifiOff, KeyRound, ShieldAlert,
} from 'lucide-vue-next'

const { t } = useI18n()
const { locale, locales } = useLocale()

// Catch rendering errors from child components
onErrorCaptured((err) => {
  console.error('[App] Component error caught:', err)
  return false // let it propagate for visibility
})

const activeTab = ref('wallet')
const showLanguagePicker = ref(false)
const copied = ref(false)
const dataLoaded = ref(false)
const welcomeCompleted = ref(true) // assume true until checked (prevents flash)
const lockError = ref('')
const lockBusy = ref(false)

// Delete confirmation state
const confirmingDelete = ref(null)

// Settings menu
const settingsRef = ref(null)

// Loading states for async actions
const switchingAccount = ref(null) // account id being switched to
const confirmSwitchId = ref(null) // account id pending switch confirmation
const deletingAccount = ref(false)
const revokingDomain = ref(null) // domain being revoked
const confirmRevokeDomain = ref(null) // domain pending confirmation

// Pubkey format cycling: 0 = npub, 1 = hex, 2 = nprofile
const pubkeyFormat = ref(0)
const showPubkeyQr = ref(false)
const pubkeyQrDataUrl = ref('')

const formattedPubkey = computed(() => {
  const acct = activeAccount.value
  if (!acct) return ''
  if (pubkeyFormat.value === 0) return acct.npub || ''
  if (pubkeyFormat.value === 1) return acct.pubkey || ''
  if (pubkeyFormat.value === 2 && acct.pubkey) {
    try { return nip19.nprofileEncode({ pubkey: acct.pubkey, relays: [] }) } catch { return acct.npub || '' }
  }
  if (pubkeyFormat.value === 3 && acct.npub) {
    try { return nip21.encodeNostrURI(acct.npub) } catch { return acct.npub || '' }
  }
  return acct.npub || ''
})

const pubkeyFormatLabel = computed(() => {
  const labels = ['npub', 'hex', 'nprofile', 'nostr:']
  return labels[pubkeyFormat.value] || 'npub'
})

function cyclePubkeyFormat() {
  pubkeyFormat.value = (pubkeyFormat.value + 1) % 4
}

async function togglePubkeyQr() {
  if (showPubkeyQr.value) {
    showPubkeyQr.value = false
    return
  }
  const val = formattedPubkey.value
  if (!val) return
  try {
    pubkeyQrDataUrl.value = await QRCode.toDataURL(val, { width: 200, margin: 2, color: { dark: '#000', light: '#fff' } })
    showPubkeyQr.value = true
  } catch { /* ignore */ }
}

// Profile data fetched from relays
const profileData = ref(null)
const profileLoading = ref(false)

const { locked, passwordSet, loading: lockLoading, autoLockCountdown, setup: setupPassword, unlock, lock, resetAutoLock } = useLock()
const { accounts, activeAccount, nip46Status, load: loadAccounts, switchTo, remove, fetchProfile, loadNip46Status } = useAccounts()
const { status: walletStatus, wallets: savedWallets, switching: walletSwitching, walletType, loadStatus: loadWallet, loadWallets, disconnect: disconnectWallet, switchWallet, rename: renameWallet, autoCreateWallet } = useWallet()
const { policies: permissions, load: loadPermissions, revokeDomain } = usePermissions()
const { getForHost: getAllowanceForHost } = useAllowanceSync()
const { currentTheme, currentMode, themes, themeIds, setTheme, toggleMode } = useTheme()
const toast = useToast()
const { currency: fiatCurrency, setCurrency: setFiatCurrency } = useFiat()
const { switchAccount: switchChatAccount, unreadTotal: chatUnreadTotal } = useChat()
const { switchAccount: switchGroupAccount, unreadTotal: groupUnreadTotal } = useGroups()
const { resetContacts } = useContacts()
const { relayConfig, loadRelays } = useRelays()
const { online } = useOnline()
const {
  showWizard,
  showSettings,
  showPermissionsPopup,
  selectedSite,
  showRelaySettings,
  showNotificationSettings,
  walletView,
  showSendPanel,
  showReceivePanel,
  showWalletConnect,
  selectedTx,
  chatView,
  chatPubkey,
  chatGroupKey,
  resetForTabSwitch,
  resetForAccountSwitch,
  showTxDetail,
  closeTxDetail,
  openChatThread,
  closeChatThread,
  openGroupThread,
  closeGroupThread,
} = usePopupState()
const { highlightedIndex: currencyHighlight, onKeydown: onCurrencyKeydown, resetHighlight: resetCurrencyHighlight } = useListKeyboard({
  itemCount: () => CURRENCIES.length,
  onSelect: (i) => { setFiatCurrency(CURRENCIES[i].code); showCurrencyPicker.value = false; resetCurrencyHighlight() },
})
const needsBackup = ref(false)
const profileBadges = ref([])
const lastUnlockedAt = ref(0)
const showCurrencyPicker = ref(false)

function toggleIdentity() {
  activeTab.value = activeTab.value === 'identity' ? 'wallet' : 'identity'
}

// Site detail opened from wallet budget bar — stays on wallet tab via SlidePanel
const showSiteBudgetPanel = ref(false)
const siteBudgetHost = ref('')

function navigateToSiteDetail(host) {
  siteBudgetHost.value = host
  showSiteBudgetPanel.value = true
}

function siteBudgetPill(host) {
  const a = getAllowanceForHost(host)
  if (!a) return null
  if (a.enabled === false) return { label: `${a.budget.toLocaleString()} sats`, color: 'bg-surface-elevated text-text-muted', paused: true }
  const ratio = a.spent / a.budget
  const color = ratio > 0.9 ? 'bg-error/10 text-error' : ratio > 0.7 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
  return { label: `${a.spent.toLocaleString()} / ${a.budget.toLocaleString()}`, color, paused: false }
}

// Sort sites: most recent budget activity first, then alphabetical
const sortedPermissions = computed(() => {
  return Object.entries(permissions.value).sort(([a], [b]) => {
    const ta = getAllowanceForHost(a)?.updated_at || 0
    const tb = getAllowanceForHost(b)?.updated_at || 0
    if (ta !== tb) return tb - ta
    return a.localeCompare(b)
  })
})

const permissionCount = computed(() => Object.keys(permissions.value).length)

const accountRelayCount = computed(() => relayConfig.value.account?.length || 0)
const walletRelayCount = computed(() => relayConfig.value.wallet?.length || 0)
const chatRelayCount = computed(() => relayConfig.value.chat?.length || 0)
const totalRelayCount = computed(() => accountRelayCount.value + walletRelayCount.value + chatRelayCount.value)

// Reset sub-views when switching tabs
watch(activeTab, () => {
  resetForTabSwitch()
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
    resetForAccountSwitch()
    resetContacts()
    switchChatAccount()
    switchGroupAccount()

    // Reload account-scoped relay config
    loadRelays()
  }
})

// Display name: profile.display_name > profile.name > account.name
const displayName = computed(() => {
  if (profileData.value?.display_name) return profileData.value.display_name
  if (profileData.value?.name) return profileData.value.name
  if (activeAccount.value?.name) return activeAccount.value.name
  // While profile loads, show truncated npub instead of jargon
  if (activeAccount.value?.npub) return truncateKey(activeAccount.value.npub, 8, 4)
  return ''
})

// Close settings on click outside
function onClickOutside(e) {
  if (showSettings.value && settingsRef.value && !settingsRef.value.contains(e.target)) {
    showSettings.value = false
  }
}
onMounted(async () => {
  document.addEventListener('click', onClickOutside, true)
  // Check if welcome screen has been completed (first-run detection)
  const stored = await chrome.storage.local.get('welcomeCompleted')
  welcomeCompleted.value = !!stored.welcomeCompleted
})
onUnmounted(() => {
  document.removeEventListener('click', onClickOutside, true)
  if (nip46PollTimer) clearInterval(nip46PollTimer)
})

function copyPubkey() {
  const val = formattedPubkey.value
  if (!val) return
  navigator.clipboard.writeText(val)
  copied.value = true
  toast.success(t('common.copiedToClipboard'))
  setTimeout(() => (copied.value = false), 2500)
}

const switchTargetAccount = computed(() => {
  if (!confirmSwitchId.value) return null
  return accounts.value.find(a => a.id === confirmSwitchId.value) || null
})

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

const deletingAccountObj = computed(() =>
  accounts.value.find(a => a.id === confirmingDelete.value)
)

function requestDelete(accId) {
  confirmingDelete.value = accId
}

function cancelDelete() {
  confirmingDelete.value = null
}

function openBackupPage() {
  const url = chrome.runtime.getURL('options.html?page=account')
  chrome.tabs.create({ url })
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
  const activeId = walletStatus.value.activeWallet?.id
  await disconnectWallet(activeId)
  walletView.value = 'home'
  toast.info(t('toast.walletDisconnected'))
}

async function handleSwitchWallet(walletId) {
  try {
    await switchWallet(walletId)
    walletView.value = 'home'
    const name = savedWallets.value.find(w => w.id === walletId)?.name || ''
    toast.success(t('wallet.walletSwitched', { name }))
  } catch (err) {
    toast.error(err.message || t('wallet.connectFailed'))
  }
}

async function handleRenameWallet(walletId, name) {
  try {
    await renameWallet(walletId, name)
    toast.success(t('wallet.walletRenamed'))
  } catch (err) {
    toast.error(err.message)
  }
}

async function handleRemoveWallet(walletId) {
  await disconnectWallet(walletId)
  walletView.value = 'home'
  toast.info(t('toast.walletDisconnected'))
}

async function onWizardComplete() {
  showWizard.value = false
  await loadAccounts()
  // Auto-create Cashu wallet for new users (non-blocking on failure)
  try {
    await autoCreateWallet()
    await Promise.all([loadWallet(), loadWallets()])
  } catch (err) {
    // Non-fatal — user can still add a wallet manually
  }
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
    const msg = err.message || ''
    if (msg.startsWith('TOO_MANY_ATTEMPTS:')) {
      const seconds = msg.split(':')[1]
      lockError.value = t('lock.tooManyAttempts', { seconds })
    } else {
      lockError.value = msg || t('lock.wrongPassword')
    }
  } finally {
    lockBusy.value = false
  }
}

async function loadData() {
  await Promise.all([loadAccounts(), loadWallet(), loadWallets(), loadPermissions(), loadRelays()])
  dataLoaded.value = true
  if (accounts.value.length === 0) {
    showWizard.value = true
  } else if (activeAccount.value?.pubkey) {
    profileLoading.value = true
    fetchProfile(activeAccount.value.pubkey)
      .then(p => { profileData.value = p })
      .catch(() => { profileData.value = null })
      .finally(() => { profileLoading.value = false })
    // Fetch profile badges (non-blocking)
    import('../../lib/badges.js').then(({ fetchProfileBadges }) => {
      chrome.runtime.sendMessage({ type: 'GET_RELAY_CONFIG' }).then(res => {
        const relays = res?.result?.account || []
        if (relays.length) {
          fetchProfileBadges(activeAccount.value.pubkey, relays)
            .then(b => { profileBadges.value = b })
            .catch(() => {})
        }
      })
    })
  }
  // Poll NIP-46 reconnection status for remote signer accounts
  if (activeAccount.value?.mode === 'nip46') {
    pollNip46Status()
  }
  // Check if backup reminder is needed
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CHECK_BACKUP_STATUS' })
    needsBackup.value = res?.result?.needsBackup || false
  } catch { needsBackup.value = false }
}

let nip46PollTimer = null
function pollNip46Status() {
  clearInterval(nip46PollTimer)
  loadNip46Status()
  nip46PollTimer = setInterval(async () => {
    await loadNip46Status()
    // Stop polling once connected
    if (nip46Status.value.connected && !nip46Status.value.reconnecting) {
      clearInterval(nip46PollTimer)
      nip46PollTimer = null
    }
  }, 1500)
}

function handleLock() {
  showSettings.value = false
  lock()
}

const isDetached = ref(window.location.search.includes('detached=1')
  || window.innerWidth > 420)

function openFullPage() {
  const url = chrome.runtime.getURL('popup.html?detached=1')
  if (chrome.windows?.create) {
    chrome.windows.create({
      url,
      type: 'popup',
      width: 400,
      height: 640,
      focused: true,
    })
  } else {
    // Firefox fallback
    chrome.tabs.create({ url })
  }
  window.close()
}

// Handle ?tab= query param from notification clicks
const urlParams = new URLSearchParams(window.location.search)
const targetTab = urlParams.get('tab')
if (targetTab === 'chat') activeTab.value = 'chat'
else if (targetTab === 'wallet') activeTab.value = 'wallet'

function onLanguageSelected() {
  showLanguagePicker.value = false
}

function openOptionsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })
  showSettings.value = false
}

// Load data when unlocked
watch([locked, lockLoading], async ([isLocked, isLoading]) => {
  if (isLoading) return
  if (isLocked) {
    // Fetch last-unlocked timestamp for lock screen display
    try {
      const data = await chrome.storage.local.get('_sessionFallback')
      lastUnlockedAt.value = data._sessionFallback?.unlockedAt || 0
    } catch { lastUnlockedAt.value = 0 }
  } else if (!dataLoaded.value) {
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
  <div :class="['popup-container bg-surface-base text-text-primary', { detached: isDetached }]">
    <ToastContainer />

    <!-- Offline banner -->
    <div v-if="!online" class="flex items-center justify-center gap-2 px-3 py-1.5 bg-error/10 border-b border-error/20 text-[11px] text-error font-medium">
      <WifiOff class="w-3.5 h-3.5 shrink-0" />
      <span>{{ t('common.offline') }}</span>
    </div>

    <!-- Loading state -->
    <div v-if="lockLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-3 animate-fade-in">
        <img src="/logo/logo.svg" alt="Buho Jump" class="w-8 h-8 mx-auto animate-pulse" />
        <p class="text-xs text-text-muted">{{ t('common.loading') }}</p>
      </div>
    </div>

    <!-- Welcome screen (first run only — before password setup) -->
    <template v-else-if="!passwordSet && !welcomeCompleted">
      <WelcomeScreen @complete="welcomeCompleted = true" />
    </template>

    <!-- Lock screen / Password setup -->
    <template v-else-if="locked || !passwordSet">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-2">
          <img src="/logo/logo.svg" alt="Buho Jump" class="w-5 h-5" />
          <span class="font-semibold text-sm tracking-tight">Buho Jump</span>
        </div>
        <!-- Minimal settings on lock screen -->
        <div class="relative" ref="settingsRef">
          <button @click.stop="showSettings = !showSettings"
            class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200"
            title="Settings">
            <Settings class="w-4 h-4 text-text-muted" />
          </button>

          <!-- Lock screen settings dropdown (theme only) -->
          <div v-if="showSettings"
            class="absolute right-0 top-full mt-1.5 w-56 bg-surface-card rounded-2xl border border-border shadow-lg z-50 overflow-hidden animate-scale-in origin-top-right">
            <!-- Mode toggle -->
            <button @click="toggleMode"
              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-all duration-200 text-left">
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
              class="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-elevated transition-all duration-200 text-left">
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
        :last-unlocked-at="lastUnlockedAt"
        @setup="handleSetup"
        @unlock="handleUnlock"
      />
    </template>

    <!-- Main UI (after unlock) -->
    <template v-else>

      <!-- Auto-lock warning banner -->
      <div v-if="autoLockCountdown > 0"
        class="flex items-center justify-between px-4 py-2 bg-warning/10 border-b border-warning/20 text-warning text-xs animate-fade-in">
        <span class="font-medium">{{ t('lock.autoLockWarning', { seconds: autoLockCountdown }) }}</span>
        <button @click="resetAutoLock" class="px-2 py-0.5 rounded-lg bg-warning/20 hover:bg-warning/30 font-semibold transition-all duration-200 text-[10px]">
          {{ t('lock.stayUnlocked') }}
        </button>
      </div>

      <!-- Backup reminder banner -->
      <div v-if="needsBackup"
        class="flex items-center justify-between px-4 py-2 bg-warning/8 border-b border-warning/15 text-[11px] text-warning animate-fade-in">
        <span class="font-medium">{{ t('lock.backupReminder') }}</span>
        <button @click="needsBackup = false" class="p-0.5 rounded hover:bg-warning/15 transition-colors" :aria-label="t('common.close')">
          <span class="text-xs">&times;</span>
        </button>
      </div>

      <!-- ═══ Profile Header ═══ -->
      <header class="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <!-- Profile area (tappable to expand identity) -->
        <button
          v-if="activeAccount"
          @click="toggleIdentity"
          class="flex items-center gap-2 min-w-0 text-left transition-all duration-200 rounded-lg -ml-1 pl-1 py-0.5 shrink"
          :class="activeTab === 'identity' ? 'bg-surface-elevated/50' : 'hover:bg-surface-elevated/30'"
        >
          <!-- Avatar -->
          <div class="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-border shadow-sm"
            :class="profileData?.picture ? '' : 'bg-brand flex items-center justify-center'">
            <img v-if="profileData?.picture" :src="profileData.picture" alt="" class="w-full h-full object-cover" @error="profileData.picture = null" />
            <div v-else-if="profileLoading && !profileData" class="w-full h-full skeleton-shimmer" />
            <span v-else class="text-surface-base text-[10px] font-bold">{{ displayName[0]?.toUpperCase() }}</span>
          </div>
          <!-- Name + mode badge -->
          <div class="min-w-0">
            <div v-if="profileLoading && !profileData && !displayName" class="skeleton-shimmer h-3.5 w-16 rounded" />
            <div v-else class="text-[12px] font-extrabold truncate leading-tight max-w-[90px]">{{ displayName }}</div>
            <div class="flex items-center gap-1">
              <span v-if="activeAccount.mode === 'nip46' && nip46Status.reconnecting"
                class="flex items-center gap-0.5 text-[7px] font-semibold px-1 py-px rounded-full shrink-0 bg-info/10 text-info">
                <Loader2 class="w-2 h-2 animate-spin" />
                {{ t('account.reconnecting') }}
              </span>
              <span v-else class="flex items-center gap-0.5 text-[7px] font-semibold px-1 py-px rounded-full shrink-0"
                :class="activeAccount.mode === 'local'
                  ? 'bg-success/10 text-success'
                  : nip46Status.connected ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'">
                <span class="w-1 h-1 rounded-full"
                  :class="activeAccount.mode === 'local'
                    ? 'bg-success'
                    : nip46Status.connected ? 'bg-success' : 'bg-warning'" />
                {{ activeAccount.mode === 'local' ? t('account.local') : t('account.external') }}
              </span>
            </div>
          </div>
          <ChevronDown class="w-3 h-3 text-text-muted transition-transform duration-200 shrink-0" :class="activeTab === 'identity' ? 'rotate-180' : ''" />
        </button>
        <!-- Fallback when no account -->
        <div v-else class="flex items-center gap-2 shrink-0">
          <img src="/logo/logo.svg" alt="Buho Jump" class="w-5 h-5" />
          <span class="font-semibold text-sm tracking-tight">Buho Jump</span>
        </div>

        <!-- Spacer -->
        <div class="flex-1" />

        <!-- Wallet selector -->
        <WalletSelector
          :wallets="savedWallets"
          :balance="walletStatus.balance"
          :connected="walletStatus.connected"
          :switching="walletSwitching"
          @switch="handleSwitchWallet"
          @add="showWalletConnect = true; activeTab = 'wallet'"
          @rename="handleRenameWallet"
          @remove="handleRemoveWallet"
        />

        <!-- Pop out to detached window -->
        <div v-if="!isDetached" class="relative shrink-0 group/pop">
          <button @click="openFullPage" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200">
            <PictureInPicture2 class="w-3.5 h-3.5 text-text-muted group-hover/pop:text-brand transition-colors duration-200" />
          </button>
          <!-- Styled tooltip -->
          <div class="pointer-events-none absolute right-0 top-full mt-2 w-52 opacity-0 group-hover/pop:opacity-100 transition-all duration-200 translate-y-1 group-hover/pop:translate-y-0 z-50">
            <div class="bg-surface-card border border-border rounded-xl shadow-lg px-3 py-2.5">
              <p class="text-[11px] font-semibold text-text-primary leading-tight">{{ t('settings.popOutTitle') }}</p>
              <p class="text-[10px] text-text-muted leading-snug mt-1">{{ t('settings.popOutDesc') }}</p>
            </div>
          </div>
        </div>

        <!-- Settings button + dropdown -->
        <div class="relative shrink-0" ref="settingsRef">
          <button @click.stop="showSettings = !showSettings"
            class="p-1.5 rounded-lg transition-all duration-200"
            :class="showSettings ? 'bg-surface-elevated' : 'hover:bg-surface-elevated'"
            title="Settings">
            <Settings class="w-4 h-4 transition-transform duration-200" :class="showSettings ? 'text-brand rotate-90' : 'text-text-muted'" />
          </button>

          <!-- Settings dropdown -->
          <div v-if="showSettings"
            class="absolute right-0 top-full mt-1.5 w-56 bg-surface-card rounded-2xl border border-border shadow-lg z-50 animate-scale-in origin-top-right">

            <!-- Dark / Light toggle -->
            <button @click="toggleMode"
              class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-all duration-200 text-left">
              <Sun v-if="currentMode === 'dark'" class="w-4 h-4 text-warning shrink-0" />
              <Moon v-else class="w-4 h-4 text-info shrink-0" />
              <span class="text-xs font-medium">{{ currentMode === 'dark' ? t('settings.switchToLight') : t('settings.switchToDark') }}</span>
            </button>

            <!-- Theme dots -->
            <div class="px-4 pb-3 flex items-center gap-2">
              <button v-for="id in themeIds" :key="id"
                @click="setTheme(id)"
                class="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 shrink-0"
                :class="currentTheme === id ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface-card scale-110' : 'hover:scale-110'"
                :title="themes[id]?.label"
              >
                <span class="w-4 h-4 rounded-full border border-border/50"
                  :style="{ background: themes[id]?.dark?.['brand-primary'] || 'var(--text-muted)' }" />
              </button>
            </div>

            <div class="h-px bg-border" />

            <!-- Currency -->
            <button @click="showCurrencyPicker = true; showSettings = false"
              class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left">
              <div class="flex items-center gap-3">
                <Coins class="w-4 h-4 text-text-muted shrink-0" />
                <span class="text-xs font-medium">{{ t('settings.currency') }}</span>
              </div>
              <span class="text-[11px] text-text-muted font-mono">{{ CURRENCIES.find(c => c.code === fiatCurrency)?.symbol }} {{ fiatCurrency.toUpperCase() }}</span>
            </button>

            <!-- Language -->
            <button @click="showLanguagePicker = true; showSettings = false"
              class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left">
              <div class="flex items-center gap-3">
                <Languages class="w-4 h-4 text-text-muted shrink-0" />
                <span class="text-xs font-medium">{{ t('settings.language') }}</span>
              </div>
              <span class="text-[11px] text-text-muted">{{ locales.find(l => l.code === locale)?.native || 'English' }}</span>
            </button>

            <div class="h-px bg-border" />

            <!-- Lock -->
            <button @click="handleLock"
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-elevated transition-all duration-200 text-left">
              <Lock class="w-4 h-4 text-text-muted shrink-0" />
              <span class="text-xs font-medium">{{ t('settings.lockExtension') }}</span>
            </button>

            <div class="h-px bg-border" />

            <!-- Links to full settings pages -->
            <div class="px-4 pt-2.5 pb-1.5">
              <span class="text-[9px] uppercase tracking-widest text-text-muted font-semibold">{{ t('settings.more') }}</span>
            </div>
            <button @click="showRelaySettings = true; showSettings = false"
              class="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-elevated transition-all duration-200 text-left">
              <div class="flex items-center gap-3">
                <Radio class="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span class="text-[11px] text-text-secondary">{{ t('settings.relaySettings') }}</span>
              </div>
              <OpenInBrowserButton page="relays" />
            </button>
            <button @click="showNotificationSettings = true; showSettings = false"
              class="w-full flex items-center justify-between px-4 py-2 hover:bg-surface-elevated transition-all duration-200 text-left">
              <div class="flex items-center gap-3">
                <Bell class="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span class="text-[11px] text-text-secondary">{{ t('notifications.settingsLabel') }}</span>
              </div>
              <OpenInBrowserButton page="preferences" />
            </button>

            <!-- Footer -->
            <div class="px-4 py-2 flex items-center justify-between border-t border-border mt-1">
              <button @click="openOptionsPage" class="text-[10px] text-brand font-medium hover:underline">
                {{ t('settings.allSettings') }}
              </button>
              <span class="text-[9px] text-text-muted/50">v1.0.0</span>
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
          <div class="bg-surface-card rounded-3xl p-4 border border-border shadow-sm space-y-3">
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
                <button @click="showPermissionsPopup = false" class="p-1 rounded-md hover:bg-surface-elevated transition-all duration-200">
                  <ArrowLeft class="w-4 h-4 text-text-muted" />
                </button>
                <span class="text-sm font-semibold">{{ t('account.connectedSites') }}</span>
                <OpenInBrowserButton page="sites" />
              </div>

              <div v-if="permissionCount > 0" class="space-y-1">
                <button v-for="[host, methods] in sortedPermissions" :key="host"
                  @click="selectedSite = host"
                  class="w-full flex items-center justify-between px-3 py-2.5 bg-surface-card rounded-3xl border border-border shadow-sm hover:border-brand/30 transition-all duration-200 group">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <div class="w-10 h-10 rounded-[10px] bg-surface-elevated border border-border flex items-center justify-center shrink-0 overflow-hidden">
                      <Globe class="w-3.5 h-3.5 text-text-muted" />
                    </div>
                    <div class="min-w-0">
                      <span class="text-xs font-medium truncate block">{{ host }}</span>
                      <div class="flex items-center gap-1.5 mt-0.5">
                        <span class="text-[9px] text-text-muted">{{ Object.keys(methods).length }} {{ t('sites.permissionsGranted') }}</span>
                        <span v-if="siteBudgetPill(host)" class="text-[8px] px-1.5 py-px rounded-full font-semibold" :class="siteBudgetPill(host).color">
                          {{ siteBudgetPill(host).paused ? t('sites.budgetPaused') : siteBudgetPill(host).label }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronDown class="w-3 h-3 text-text-muted -rotate-90 group-hover:text-brand transition-all duration-200 shrink-0" />
                </button>
              </div>

              <div v-else class="bg-surface-card rounded-3xl border border-border shadow-sm p-6 text-center">
                <Globe class="w-5 h-5 text-text-muted mx-auto mb-2" />
                <p class="text-xs text-text-muted">{{ t('account.noSites') }}</p>
                <p class="text-[10px] text-text-muted mt-0.5">{{ t('account.noSitesHint') }}</p>
              </div>
            </div>

            <!-- Active identity card -->
            <template v-else>
            <div v-if="activeAccount" class="bg-surface-card rounded-3xl border border-border shadow-sm animate-fade-in-up overflow-hidden">

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
                      <span class="font-extrabold text-sm truncate">{{ displayName }}</span>
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
                <div v-if="activeAccount.npub" class="space-y-2">
                  <div class="flex items-center gap-1.5">
                    <button @click="cyclePubkeyFormat"
                      class="flex-1 flex items-center gap-1.5 bg-surface-base px-2.5 py-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200 group min-w-0"
                      :title="t('account.tapToCycle')">
                      <span class="text-[8px] uppercase tracking-wider text-brand font-bold shrink-0">{{ pubkeyFormatLabel }}</span>
                      <code class="text-[10px] font-mono text-text-muted truncate">{{ truncateKey(formattedPubkey, 14, 8) }}</code>
                    </button>
                    <button @click="togglePubkeyQr" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200 shrink-0"
                      :title="t('account.showQr')">
                      <QrCode class="w-3.5 h-3.5" :class="showPubkeyQr ? 'text-brand' : 'text-text-muted'" />
                    </button>
                    <button @click="copyPubkey" class="p-1.5 rounded-lg hover:bg-surface-elevated transition-all duration-200 shrink-0">
                      <Check v-if="copied" class="w-3.5 h-3.5 text-success" />
                      <Copy v-else class="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  </div>
                  <!-- QR code for pubkey -->
                  <div v-if="showPubkeyQr && pubkeyQrDataUrl" class="flex justify-center animate-fade-in-up">
                    <div class="bg-white p-2 rounded-3xl shadow-sm">
                      <img :src="pubkeyQrDataUrl" alt="QR" class="w-[160px] h-[160px]" />
                    </div>
                  </div>
                </div>

                <!-- Profile metadata pills -->
                <div v-if="profileData?.lud16 || profileData?.lud19 || profileLoading" class="flex items-center gap-2 flex-wrap">
                  <div v-if="profileData?.lud16" class="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
                    <WalletIcon class="w-2.5 h-2.5" />
                    <span class="truncate max-w-[180px]">{{ profileData.lud16 }}</span>
                  </div>
                  <div v-else-if="profileData?.lud19" class="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
                    <WalletIcon class="w-2.5 h-2.5" />
                    <span>LNURL set</span>
                  </div>
                  <div v-if="profileLoading && !profileData" class="skeleton-shimmer h-4 w-24 rounded-full" />
                </div>

                <!-- Profile badges (NIP-58) -->
                <div v-if="profileBadges.length > 0" class="flex items-center gap-1.5 flex-wrap">
                  <div v-for="badge in profileBadges" :key="badge.name"
                    class="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-brand/6 text-brand border border-brand/12 font-medium"
                    :title="badge.description || badge.name">
                    <img v-if="badge.thumbUrl" :src="badge.thumbUrl" alt="" class="w-3 h-3 rounded-sm object-cover" />
                    <span class="truncate max-w-[100px]">{{ badge.name }}</span>
                  </div>
                </div>
              </div>

              <!-- Connected sites button -->
              <div v-if="permissionCount > 0" class="border-t border-border px-4 py-3">
                <div class="flex items-center gap-1">
                  <button @click="showPermissionsPopup = true"
                    class="flex-1 flex items-center justify-between py-1.5 group">
                    <div class="flex items-center gap-1.5">
                      <ShieldCheck class="w-3 h-3 text-text-muted" />
                      <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{{ t('account.connectedSites') }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-muted font-semibold">{{ permissionCount }}</span>
                      <ChevronDown class="w-3 h-3 text-text-muted -rotate-90 group-hover:text-brand transition-all duration-200" />
                    </div>
                  </button>
                  <OpenInBrowserButton page="sites" />
                </div>
              </div>

              <!-- Connected relays -->
              <div class="border-t border-border px-4 py-3">
                <div class="flex items-center gap-1">
                  <button @click="showRelaySettings = true; showSettings = false"
                    class="flex-1 flex items-center justify-between py-1.5 group">
                    <div class="flex items-center gap-1.5">
                      <Radio class="w-3 h-3 text-text-muted" />
                      <span class="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{{ t('account.connectedRelays') }}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span v-if="totalRelayCount > 0" class="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text-muted font-semibold">{{ totalRelayCount }}</span>
                      <ChevronDown class="w-3 h-3 text-text-muted -rotate-90 group-hover:text-brand transition-all duration-200" />
                    </div>
                  </button>
                  <OpenInBrowserButton page="relays" />
                </div>
                <div v-if="totalRelayCount > 0" class="flex items-center gap-2 mt-1.5 pl-[18px]">
                  <span class="text-[9px] text-text-muted">{{ accountRelayCount }} {{ t('relay.tabAccount') }}</span>
                  <span class="text-[9px] text-text-muted opacity-40">·</span>
                  <span class="text-[9px] text-text-muted">{{ walletRelayCount }} {{ t('relay.tabWallet') }}</span>
                  <span class="text-[9px] text-text-muted opacity-40">·</span>
                  <span class="text-[9px] text-text-muted">{{ chatRelayCount }} {{ t('relay.tabChat') }}</span>
                </div>
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
                class="w-full flex items-center justify-between px-3 py-2.5 rounded-3xl hover:bg-surface-card border border-transparent hover:border-border transition-all duration-200 text-sm group disabled:opacity-60"
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
                  class="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all duration-200 cursor-pointer"
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
              <template #description>
                <div v-if="switchTargetAccount" class="flex items-center gap-2 justify-center mb-1">
                  <div class="w-6 h-6 rounded-full bg-surface-elevated flex items-center justify-center text-[9px] font-bold text-text-secondary">
                    {{ (switchTargetAccount.name || '?')[0].toUpperCase() }}
                  </div>
                  <span class="font-semibold text-text-primary text-xs">{{ switchTargetAccount.name }}</span>
                  <span class="text-[9px] px-1.5 py-px rounded font-medium"
                    :class="switchTargetAccount.mode === 'nip46' ? 'bg-warning/10 text-warning' : 'bg-surface-elevated text-text-muted'">
                    {{ switchTargetAccount.mode === 'nip46' ? t('account.external') : t('account.local') }}
                  </span>
                </div>
                {{ t('account.switchConfirmDesc') }}
              </template>
              <template #actions>
                <button @click="cancelSwitch"
                  :disabled="!!switchingAccount"
                  class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold disabled:opacity-60">
                  {{ t('common.cancel') }}
                </button>
                <button @click="confirmSwitch"
                  :disabled="!!switchingAccount"
                  class="py-2 text-xs rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 btn-primary">
                  <Loader2 v-if="switchingAccount" class="w-3 h-3 animate-spin" />
                  {{ switchingAccount ? t('account.switching') : t('account.switchConfirmBtn') }}
                </button>
              </template>
            </BottomSheet>

            <!-- Delete confirmation (bottom sheet) -->
            <BottomSheet :open="!!confirmingDelete" variant="danger" @close="cancelDelete">
              <template #title>{{ t('account.deleteTitle') }}</template>
              <template #content>
                <div class="space-y-4 px-1">
                  <!-- Account being deleted -->
                  <div v-if="deletingAccountObj" class="flex items-center gap-3 p-3 rounded-2xl bg-surface-base border border-border">
                    <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      :class="deletingAccountObj.mode === 'nip46' ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'">
                      {{ (deletingAccountObj.name || '?')[0].toUpperCase() }}
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm font-semibold truncate">{{ deletingAccountObj.name }}</p>
                      <span class="text-[9px] px-1.5 py-px rounded font-medium"
                        :class="deletingAccountObj.mode === 'nip46' ? 'bg-warning/10 text-warning' : 'bg-surface-elevated text-text-muted'">
                        {{ deletingAccountObj.mode === 'nip46' ? t('account.external') : t('account.local') }}
                      </span>
                    </div>
                  </div>

                  <!-- Warning banner (local keys only) -->
                  <div v-if="deletingAccountObj?.mode !== 'nip46'" class="flex gap-2.5 p-3 rounded-2xl bg-warning/8 border border-warning/15">
                    <ShieldAlert class="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div>
                      <p class="text-[11px] font-semibold text-warning leading-tight">{{ t('account.deleteBackupWarning') }}</p>
                      <p class="text-[10px] text-text-muted leading-snug mt-1">{{ t('account.deleteBackupHint') }}</p>
                    </div>
                  </div>

                  <!-- Remote signer info -->
                  <div v-else class="flex gap-2.5 p-3 rounded-2xl bg-surface-base border border-border">
                    <ShieldAlert class="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                    <p class="text-[11px] text-text-muted leading-snug">{{ t('account.deleteDescRemote') }}</p>
                  </div>

                  <!-- Description -->
                  <p class="text-[11px] text-text-muted leading-relaxed text-center">
                    {{ deletingAccountObj?.mode === 'nip46' ? t('account.deleteRemoteExplain') : t('account.deleteLocalExplain') }}
                  </p>

                  <!-- Action buttons -->
                  <div class="space-y-2">
                    <!-- Backup CTA (local keys only) -->
                    <button v-if="deletingAccountObj?.mode !== 'nip46'"
                      @click="openBackupPage"
                      class="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-2xl bg-surface-elevated hover:bg-surface-hover border border-border transition-all duration-200 font-semibold text-text-primary">
                      <KeyRound class="w-3.5 h-3.5" />
                      {{ t('account.deleteBackupCta') }}
                    </button>

                    <!-- Delete button -->
                    <button @click="confirmDelete"
                      :disabled="deletingAccount"
                      class="w-full py-2.5 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
                      <Loader2 v-if="deletingAccount" class="w-3 h-3 animate-spin" />
                      <Trash2 v-else class="w-3 h-3" />
                      {{ deletingAccount ? t('account.removing') : t('account.deleteForever') }}
                    </button>

                    <!-- Cancel -->
                    <button @click="cancelDelete"
                      :disabled="deletingAccount"
                      class="w-full py-2 text-xs rounded-2xl text-text-muted hover:text-text-secondary transition-all duration-200 font-medium disabled:opacity-60">
                      {{ t('common.cancel') }}
                    </button>
                  </div>
                </div>
              </template>
            </BottomSheet>

            <button @click="showWizard = true"
              class="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm rounded-3xl border border-dashed border-border text-text-muted hover:text-brand hover:border-brand transition-all duration-200">
              <Plus class="w-4 h-4" />
              {{ t('account.addAccount') }}
            </button>
            </template>
          </section>

          <!-- ══════════════════════════════════════════════ -->
          <!-- ══ Wallet Tab                              ══ -->
          <!-- ══════════════════════════════════════════════ -->
          <section v-else-if="activeTab === 'wallet'" class="p-4">

            <!-- Add wallet flow (reachable from empty state + wallet selector) -->
            <WalletConnect
              v-if="showWalletConnect"
              @back="showWalletConnect = false"
            />

            <!-- Not connected — show empty state -->
            <NoWalletHome
              v-else-if="!walletStatus.connected"
              @connect-wallet="showWalletConnect = true"
            />

            <!-- Connected: sub-views -->
            <template v-else>
              <SiteContextBar
                v-if="walletView === 'home'"
                @navigate-site="navigateToSiteDetail"
                class="mx-4 mb-2"
              />
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
            class="flex flex-col flex-1 min-h-0"
            :class="chatView === 'thread' || chatView === 'group-thread' ? '' : ''">
            <ChatHome
              v-if="chatView === 'home'"
              @open="openChatThread"
              @open-group="openGroupThread"
              @new-chat="chatView = 'new'"
              @new-group="chatView = 'group-create'"
              class="flex-1 min-h-0 pt-2"
            />

            <ChatThread
              v-else-if="chatView === 'thread' && chatPubkey"
              :pubkey="chatPubkey"
              @back="closeChatThread"
              class="flex-1 min-h-0"
            />

            <ContactPicker
              v-else-if="chatView === 'new'"
              @back="chatView = 'home'"
              @open="openChatThread"
            />

            <GroupThread
              v-else-if="chatView === 'group-thread' && chatGroupKey"
              :group-key="chatGroupKey"
              @back="closeGroupThread"
              @info="chatView = 'group-info'"
              class="flex-1 min-h-0"
            />

            <GroupCreate
              v-else-if="chatView === 'group-create'"
              @back="chatView = 'home'"
              @joined="openGroupThread"
            />

            <GroupInfo
              v-else-if="chatView === 'group-info' && chatGroupKey"
              :group-key="chatGroupKey"
              @back="chatView = 'group-thread'"
            />
          </section>

          </div><!-- /scrollable content -->

        <!-- ═══ Bottom Tab Bar ═══ -->
        <BottomTabs
          :active-tab="activeTab"
          :unread-count="chatUnreadTotal + groupUnreadTotal"
          @update:active-tab="activeTab = $event"
        />

        <!-- Send slide panel -->
        <SlidePanel :open="showSendPanel" @close="showSendPanel = false">
          <SendFlow @back="showSendPanel = false" @done="showSendPanel = false" />
        </SlidePanel>

        <!-- Receive slide panel -->
        <SlidePanel :open="showReceivePanel" @close="showReceivePanel = false">
          <ReceiveFlow @back="showReceivePanel = false" @done="showReceivePanel = false" />
        </SlidePanel>

        <!-- Site budget panel (opened from SiteContextBar on wallet tab) -->
        <SlidePanel :open="showSiteBudgetPanel" @close="showSiteBudgetPanel = false">
          <SiteDetail
            v-if="siteBudgetHost"
            :host="siteBudgetHost"
            :methods="permissions[siteBudgetHost] || {}"
            @back="showSiteBudgetPanel = false"
            @revoked="showSiteBudgetPanel = false; loadPermissions()"
          />
        </SlidePanel>

      </template>
    </template>

    <!-- Language picker bottom sheet -->
    <BottomSheet :open="showLanguagePicker" @close="showLanguagePicker = false">
      <template #title>{{ t('settings.language') }}</template>
      <template #content>
        <LanguagePicker @select="showLanguagePicker = false" />
      </template>
    </BottomSheet>

    <!-- Currency picker bottom sheet -->
    <BottomSheet :open="showCurrencyPicker" @close="showCurrencyPicker = false">
      <template #title>{{ t('settings.currency') }}</template>
      <template #content>
        <div class="grid grid-cols-2 gap-1">
          <button v-for="cur in CURRENCIES" :key="cur.code"
            @click="setFiatCurrency(cur.code); showCurrencyPicker = false"
            class="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs transition-all duration-200"
            :class="fiatCurrency === cur.code
              ? 'bg-brand/10 text-brand font-semibold border border-brand/20'
              : 'text-text-secondary hover:bg-surface-elevated border border-transparent'"
          >
            <span class="font-mono w-4 text-center">{{ cur.symbol }}</span>
            <span class="flex-1 truncate">{{ cur.code.toUpperCase() }}</span>
            <Check v-if="fiatCurrency === cur.code" class="w-3 h-3 text-brand shrink-0" />
          </button>
        </div>
      </template>
    </BottomSheet>
  </div>
</template>
