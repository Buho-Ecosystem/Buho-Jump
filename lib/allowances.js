/**
 * Per-site budget allowance system.
 * Each allowance grants a domain a spending limit (in sats) that auto-approves
 * payments without prompting, until the budget is exhausted.
 *
 * Storage: chrome.storage.local['allowances'] = {
 *   "example.com": { budget: 1000, spent: 0, created_at, updated_at }
 * }
 */

const STORAGE_KEY = 'allowances'

export async function getAllowances() {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  return data[STORAGE_KEY] || {}
}

export async function getAllowance(host) {
  const allowances = await getAllowances()
  return allowances[host] || null
}

/**
 * Set or update a budget allowance for a host.
 * @param {string} host - domain name
 * @param {number} budget - total budget in sats
 */
export async function setAllowance(host, budget) {
  const allowances = await getAllowances()
  const existing = allowances[host]
  const now = Math.floor(Date.now() / 1000)

  allowances[host] = {
    budget,
    spent: existing?.spent || 0,
    created_at: existing?.created_at || now,
    updated_at: now,
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: allowances })
}

/**
 * Record spending against a host's allowance.
 * Returns true if the spend was within budget, false if over.
 */
export async function recordSpend(host, amountSats) {
  const allowances = await getAllowances()
  const entry = allowances[host]
  if (!entry) return false

  const remaining = entry.budget - entry.spent
  if (amountSats > remaining) return false

  entry.spent += amountSats
  entry.updated_at = Math.floor(Date.now() / 1000)
  await chrome.storage.local.set({ [STORAGE_KEY]: allowances })
  return true
}

/**
 * Check if a payment amount fits within a host's remaining budget.
 */
export async function checkBudget(host, amountSats) {
  const entry = await getAllowance(host)
  if (!entry) return false
  return (entry.budget - entry.spent) >= amountSats
}

/**
 * Remove an allowance for a host.
 */
export async function removeAllowance(host) {
  const allowances = await getAllowances()
  delete allowances[host]
  await chrome.storage.local.set({ [STORAGE_KEY]: allowances })
}

/**
 * Reset spent amount for a host (e.g. monthly reset).
 */
export async function resetAllowanceSpend(host) {
  const allowances = await getAllowances()
  if (allowances[host]) {
    allowances[host].spent = 0
    allowances[host].updated_at = Math.floor(Date.now() / 1000)
    await chrome.storage.local.set({ [STORAGE_KEY]: allowances })
  }
}
