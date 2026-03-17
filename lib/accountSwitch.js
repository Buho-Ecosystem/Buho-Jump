/**
 * Atomic account switch — single function that handles all background-side
 * cleanup when switching accounts.
 *
 * Ensures NWC client, NIP-46 signer, and relay auth state are all reset
 * before activating the new account. Called from the SWITCH_ACCOUNT handler
 * in background.js instead of fragmented inline logic.
 */

import { setActiveAccount } from './accounts.js'
import { resetAuthedRelays } from './relayPool.js'

/**
 * Perform a full account switch in the background service worker.
 *
 * @param {string} accountId - The account to switch to
 * @param {object} deps - Background-scoped dependencies
 * @param {object|null} deps.nwcClient - NWC client instance
 * @param {Function|null} deps.nwcNotifUnsub - NWC notification cleanup function
 * @param {object|null} deps.remoteSigner - NIP-46 remote signer instance
 * @returns {{ nwcClient, nwcNotifUnsub, remoteSigner }} - Cleaned-up state for background to adopt
 */
export async function performAccountSwitch(accountId, { nwcClient, nwcNotifUnsub, remoteSigner }) {
  // 1. Close NWC wallet connection + notification subscription
  if (nwcNotifUnsub) {
    try { nwcNotifUnsub() } catch { /* best effort */ }
  }
  if (nwcClient) {
    try { nwcClient.close() } catch { /* best effort */ }
  }

  // 2. Disconnect NIP-46 remote signer
  if (remoteSigner) {
    try { remoteSigner.close() } catch { /* best effort */ }
  }

  // 3. Clear relay auth state so NIP-42 challenges re-fire for the new account
  resetAuthedRelays()

  // 4. Set the new active account in storage
  await setActiveAccount(accountId)

  // Return cleaned-up state for background.js to adopt
  return {
    nwcClient: null,
    nwcNotifUnsub: null,
    remoteSigner: null,
  }
}
