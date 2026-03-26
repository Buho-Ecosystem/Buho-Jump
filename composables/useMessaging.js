/**
 * Messaging composable — clean wrapper for chrome.runtime.sendMessage.
 * All popup ↔ background communication goes through here.
 *
 * Error codes from background.js are translated to i18n keys before
 * throwing, so UI callers display localized messages automatically.
 */

// Longer timeout for operations that involve relay connections
const SLOW_OPS = new Set([
  'CONNECT_NIP46', 'PUBLISH_PROFILE', 'PUBLISH_NIP65', 'FETCH_PROFILE', 'FETCH_NIP65',
  'CONNECT_WALLET', 'SWITCH_WALLET',
  'CASHU_MINT_TOKENS', 'CASHU_CREATE_TOKEN', 'CASHU_RECEIVE_TOKEN',
  'CASHU_EXPORT_BACKUP', 'CASHU_IMPORT_BACKUP', 'CASHU_RESTORE_FROM_RELAY',
  'WALLET_PAY_INVOICE', 'WALLET_MAKE_INVOICE',
])
import { MESSAGING_DEFAULT_TIMEOUT, MESSAGING_SLOW_TIMEOUT } from '../lib/constants/timers.js'

// Known error codes from background.js → i18n key prefix: "errors."
const ERROR_CODES = new Set([
  'PERMISSION_DENIED', 'NO_SIGNER', 'NO_ACCOUNT', 'NO_EVENT',
  'NO_PUBKEY', 'LOCAL_ACCOUNT_REQUIRED', 'LOCKED', 'WRONG_PASSWORD',
  'NO_WALLET', 'WALLET_DISCONNECTED', 'TIMEOUT', 'INSUFFICIENT_BALANCE',
])

export function useMessaging() {
  /**
   * Send a message to the background and await a response.
   * @param {string} type - message type
   * @param {...any} params - parameters
   * @returns {Promise<any>} - the result from the background
   */
  async function send(type, ...params) {
    const ms = SLOW_OPS.has(type) ? MESSAGING_SLOW_TIMEOUT : MESSAGING_DEFAULT_TIMEOUT
    let timer
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type, params }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timed out')), ms)
      }),
    ]).finally(() => clearTimeout(timer))

    if (response?.error) {
      // If the error is a known code, prefix with errors. so i18n can translate it.
      // UI components using useI18n can call t(err.message) or check te(err.message).
      const code = response.error
      const message = ERROR_CODES.has(code) ? `errors.${code}` : code
      throw new Error(message)
    }
    return response?.result
  }

  return { send }
}
