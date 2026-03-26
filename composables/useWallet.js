/**
 * Wallet composable — unified wallet state for popup UI.
 * Supports both NWC (NIP-47) and Cashu (NIP-60) wallets with one active at a time.
 * All operations route through background message passing — the composable
 * never knows or cares which engine is active.
 */

import { ref, computed } from 'vue'
import { useMessaging } from './useMessaging.js'

const status = ref({ connected: false, balance: null, activeWallet: null })
const wallets = ref([])
const connecting = ref(false)
const switching = ref(false)
const walletInfo = ref(null)
const { send } = useMessaging()

export function useWallet() {
  // ── Computed ────────────────────────────────────────────────────

  /** Active wallet type: 'nwc' | 'cashu' | null */
  const walletType = computed(() => {
    const active = wallets.value.find(w => w.isActive)
    return active?.type || status.value.activeWallet?.type || null
  })

  // ── Existing methods (unchanged signatures) ────────────────────

  async function loadStatus() {
    const res = await send('GET_WALLET_STATUS')
    status.value = res || { connected: false, balance: null, activeWallet: null }
  }

  async function loadWallets() {
    const res = await send('GET_WALLETS')
    wallets.value = res || []
  }

  async function connect(connectionUri, name) {
    connecting.value = true
    try {
      await send('CONNECT_WALLET', connectionUri, name)
      await Promise.all([loadStatus(), loadWallets()])
    } finally {
      connecting.value = false
    }
  }

  async function disconnect(walletId) {
    await send('DISCONNECT_WALLET', walletId || undefined)
    await Promise.all([loadStatus(), loadWallets()])
  }

  async function switchWallet(walletId) {
    switching.value = true
    try {
      const res = await send('SWITCH_WALLET', walletId)
      if (res) {
        status.value = {
          connected: res.connected,
          balance: res.balance,
          activeWallet: wallets.value.find(w => w.id === walletId) || null,
        }
      }
      await loadWallets()
    } finally {
      switching.value = false
    }
  }

  async function rename(walletId, name) {
    await send('RENAME_WALLET', walletId, name)
    await loadWallets()
    if (status.value.activeWallet?.id === walletId) {
      status.value = {
        ...status.value,
        activeWallet: { ...status.value.activeWallet, name },
      }
    }
  }

  async function getBalance() {
    const res = await send('WALLET_GET_BALANCE')
    if (res?.balance != null) {
      status.value = { ...status.value, balance: res.balance }
    }
    return res
  }

  async function getInfo() {
    const res = await send('WALLET_GET_INFO')
    walletInfo.value = res
    return res
  }

  async function payInvoice(invoice, amountSats) {
    return await send('WALLET_PAY_INVOICE', invoice, amountSats)
  }

  async function makeInvoice(amountSats, description) {
    return await send('WALLET_MAKE_INVOICE', amountSats, description)
  }

  async function lookupInvoice(params) {
    return await send('WALLET_LOOKUP_INVOICE', params)
  }

  async function listTransactions(params) {
    return await send('WALLET_LIST_TRANSACTIONS', params || {})
  }

  async function payKeysend(params) {
    return await send('WALLET_PAY_KEYSEND', params)
  }

  async function signMessage(message) {
    return await send('WALLET_SIGN_MESSAGE', message)
  }

  async function getBudget() {
    return await send('WALLET_GET_BUDGET')
  }

  async function sendZap({ recipientPubkey, amountSats, lightningAddress, content }) {
    return await send('SEND_ZAP', { recipientPubkey, amountSats, lightningAddress, content })
  }

  // ── Cashu-specific methods ─────────────────────────────────────

  async function autoCreateWallet() {
    return await send('AUTO_CREATE_CASHU_WALLET')
  }

  async function redeemToken(tokenStr) {
    return await send('CASHU_RECEIVE_TOKEN', tokenStr)
  }

  async function createToken(amountSats, memo) {
    return await send('CASHU_CREATE_TOKEN', amountSats, memo)
  }

  async function checkMintQuote(mintUrl, quoteId) {
    return await send('CASHU_CHECK_MINT_QUOTE', mintUrl, quoteId)
  }

  async function mintTokens(mintUrl, amountSats, quoteId) {
    return await send('CASHU_MINT_TOKENS', mintUrl, amountSats, quoteId)
  }

  async function exportBackup() {
    return await send('CASHU_EXPORT_BACKUP')
  }

  async function importBackup(data) {
    return await send('CASHU_IMPORT_BACKUP', data)
  }

  async function restoreFromRelay() {
    return await send('CASHU_RESTORE_FROM_RELAY')
  }

  async function getCashuMintInfo(mintUrl) {
    return await send('CASHU_GET_MINT_INFO', mintUrl)
  }

  return {
    // State
    status,
    wallets,
    connecting,
    switching,
    walletInfo,
    walletType,
    // Lifecycle
    loadStatus,
    loadWallets,
    connect,
    disconnect,
    switchWallet,
    rename,
    // Operations (unified — background routes by wallet type)
    getBalance,
    getInfo,
    getBudget,
    payInvoice,
    makeInvoice,
    lookupInvoice,
    listTransactions,
    payKeysend,
    signMessage,
    sendZap,
    // Cashu-specific
    autoCreateWallet,
    redeemToken,
    createToken,
    checkMintQuote,
    mintTokens,
    exportBackup,
    importBackup,
    restoreFromRelay,
    getCashuMintInfo,
  }
}
