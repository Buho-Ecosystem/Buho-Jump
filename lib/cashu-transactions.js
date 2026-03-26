/**
 * Local transaction history for Cashu wallets.
 *
 * Persisted to chrome.storage.local under cashuTxHistory_{walletId}.
 * Maps to the same shape as NWC listTransactions response so
 * TransactionItem.vue works unchanged.
 */

const MAX_HISTORY = 200

function storageKey(walletId) {
  return `cashuTxHistory_${walletId}`
}

/**
 * Record a Cashu transaction.
 * @param {string} walletId
 * @param {{ direction: 'in'|'out', amount: number, description?: string }} tx
 */
export async function recordCashuTx(walletId, { direction, amount, description }) {
  const history = await loadHistory(walletId)

  history.unshift({
    type: direction === 'in' ? 'incoming' : 'outgoing',
    amount: amount * 1000, // sats → msats (TransactionItem expects msats)
    description: description || '',
    created_at: Math.floor(Date.now() / 1000),
    settled_at: Math.floor(Date.now() / 1000),
    state: 'settled',
    payment_hash: crypto.randomUUID(), // unique ID for dedup
  })

  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY

  await chrome.storage.local.set({ [storageKey(walletId)]: history })
}

/**
 * Get Cashu transactions in the same format as NWC listTransactions.
 * @returns {{ transactions: Array }}
 */
export async function getCashuTransactions(walletId, { limit = 20, offset = 0 } = {}) {
  const history = await loadHistory(walletId)
  return {
    transactions: history.slice(offset, offset + limit),
  }
}

/**
 * Clear transaction history for a wallet.
 */
export async function clearCashuTxHistory(walletId) {
  await chrome.storage.local.remove(storageKey(walletId))
}

async function loadHistory(walletId) {
  try {
    const data = await chrome.storage.local.get(storageKey(walletId))
    return Array.isArray(data[storageKey(walletId)]) ? data[storageKey(walletId)] : []
  } catch {
    return []
  }
}
