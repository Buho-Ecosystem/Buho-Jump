/**
 * Wallet composable — full NIP-47 wallet state for popup UI.
 * Supports multiple named NWC wallets with one active at a time.
 * Wraps all NWC operations via background message passing.
 */

import { ref } from 'vue'
import { useMessaging } from './useMessaging.js'

const status = ref({ connected: false, balance: null, activeWallet: null })
const wallets = ref([])
const connecting = ref(false)
const switching = ref(false)
const walletInfo = ref(null)
const { send } = useMessaging()

export function useWallet() {
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
    // Update active wallet name in status if it was the renamed one
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

  return {
    status,
    wallets,
    connecting,
    switching,
    walletInfo,
    loadStatus,
    loadWallets,
    connect,
    disconnect,
    switchWallet,
    rename,
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
  }
}
