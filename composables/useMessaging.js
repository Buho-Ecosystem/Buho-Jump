/**
 * Messaging composable — clean wrapper for chrome.runtime.sendMessage.
 * All popup ↔ background communication goes through here.
 */

// Longer timeout for operations that involve relay connections
const SLOW_OPS = new Set(['CONNECT_NIP46', 'PUBLISH_PROFILE', 'PUBLISH_NIP65', 'FETCH_PROFILE', 'FETCH_NIP65'])
const DEFAULT_TIMEOUT = 15000 // 15s for CRUD / storage ops
const SLOW_TIMEOUT = 45000   // 45s for relay / network ops

export function useMessaging() {
  /**
   * Send a message to the background and await a response.
   * @param {string} type - message type
   * @param {...any} params - parameters
   * @returns {Promise<any>} - the result from the background
   */
  async function send(type, ...params) {
    const timeout = SLOW_OPS.has(type) ? SLOW_TIMEOUT : DEFAULT_TIMEOUT
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type, params }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), timeout)
      ),
    ])
    if (response?.error) throw new Error(response.error)
    return response?.result
  }

  return { send }
}
