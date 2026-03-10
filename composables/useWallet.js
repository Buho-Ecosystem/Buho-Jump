/**
 * Wallet composable — full NIP-47 wallet state for popup UI.
 * Wraps all NWC operations via background message passing.
 */

import { ref } from 'vue'
import { useMessaging } from './useMessaging.js'

const status = ref({ connected: false, balance: null })
const connecting = ref(false)
const walletInfo = ref(null)
const { send } = useMessaging()

export function useWallet() {
  async function loadStatus() {
    const res = await send('GET_WALLET_STATUS')
    status.value = res || { connected: false, balance: null }
  }

  async function connect(connectionUri) {
    connecting.value = true
    try {
      await send('CONNECT_WALLET', connectionUri)
      await loadStatus()
    } finally {
      connecting.value = false
    }
  }

  async function disconnect() {
    await send('DISCONNECT_WALLET')
    status.value = { connected: false, balance: null }
    walletInfo.value = null
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

  return {
    status,
    connecting,
    walletInfo,
    loadStatus,
    connect,
    disconnect,
    getBalance,
    getInfo,
    getBudget,
    payInvoice,
    makeInvoice,
    lookupInvoice,
    listTransactions,
    payKeysend,
    signMessage,
  }
}
