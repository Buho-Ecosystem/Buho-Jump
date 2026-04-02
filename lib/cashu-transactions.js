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
 * @param {{ direction: 'in'|'out', amount: number, description?: string, state?: 'pending'|'settled'|'failed' }} tx
 * @returns {string} The payment_hash (unique ID) for later updates via updateCashuTx
 */
export async function recordCashuTx(walletId, { direction, amount, description, state }) {
  const history = await loadHistory(walletId)
  const paymentHash = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  history.unshift({
    type: direction === 'in' ? 'incoming' : 'outgoing',
    amount: amount * 1000, // sats → msats (TransactionItem expects msats)
    description: description || '',
    created_at: now,
    settled_at: state === 'settled' ? now : 0,
    state: state || 'settled',
    payment_hash: paymentHash,
  })

  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY

  await chrome.storage.local.set({ [storageKey(walletId)]: history })
  return paymentHash
}

/**
 * Update an existing transaction by payment_hash (e.g. pending → settled/failed).
 * @param {string} walletId
 * @param {string} paymentHash
 * @param {{ state: 'settled'|'failed', description?: string }} updates
 */
export async function updateCashuTx(walletId, paymentHash, updates) {
  const history = await loadHistory(walletId)
  const tx = history.find(t => t.payment_hash === paymentHash)
  if (!tx) return
  if (updates.state) {
    tx.state = updates.state
    if (updates.state === 'settled') tx.settled_at = Math.floor(Date.now() / 1000)
  }
  if (updates.description) tx.description = updates.description
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
