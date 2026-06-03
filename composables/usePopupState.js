import { ref } from 'vue'

/**
 * Centralizes popup-local navigation and overlay state so tab/account switches
 * reset the UI consistently.
 */
export function usePopupState() {
  const showWizard = ref(false)
  const showSettings = ref(false)
  const showPermissionsPopup = ref(false)
  const selectedSite = ref(null)
  const showRelaySettings = ref(false)
  const showNotificationSettings = ref(false)

  const walletView = ref('home')
  const walletViewBefore = ref('home')
  const showSendPanel = ref(false)
  const showReceivePanel = ref(false)
  const showWalletConnect = ref(false)
  const selectedTx = ref(null)

  const chatView = ref('home')
  const chatPubkey = ref(null)

  function resetWalletState() {
    walletView.value = 'home'
    walletViewBefore.value = 'home'
    selectedTx.value = null
    showSendPanel.value = false
    showReceivePanel.value = false
    showWalletConnect.value = false
  }

  function resetChatState() {
    chatView.value = 'home'
    chatPubkey.value = null
  }

  function resetAccountOverlays() {
    showRelaySettings.value = false
    showNotificationSettings.value = false
    showPermissionsPopup.value = false
    selectedSite.value = null
    showSettings.value = false
  }

  function resetForTabSwitch() {
    resetWalletState()
    resetChatState()
    showPermissionsPopup.value = false
    selectedSite.value = null
    showWalletConnect.value = false
  }

  function resetForAccountSwitch() {
    resetAccountOverlays()
    resetWalletState()
    resetChatState()
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

  function openChatThread(pubkey) {
    chatPubkey.value = pubkey
    chatView.value = 'thread'
  }

  function closeChatThread() {
    chatPubkey.value = null
    chatView.value = 'home'
  }

  return {
    showWizard,
    showSettings,
    showPermissionsPopup,
    selectedSite,
    showRelaySettings,
    showNotificationSettings,
    walletView,
    walletViewBefore,
    showSendPanel,
    showReceivePanel,
    showWalletConnect,
    selectedTx,
    chatView,
    chatPubkey,
    resetWalletState,
    resetChatState,
    resetAccountOverlays,
    resetForTabSwitch,
    resetForAccountSwitch,
    showTxDetail,
    closeTxDetail,
    openChatThread,
    closeChatThread,
  }
}
