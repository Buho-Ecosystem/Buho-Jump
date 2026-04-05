/**
 * Per-site budget allowance system.
 * Each allowance grants a domain a spending limit (in sats) that auto-approves
 * payments without prompting, until the budget is exhausted.
 *
 * Storage: chrome.storage.local['allowances'] = {
 *   "example.com": {
 *     budget: 1000, spent: 0, enabled: true,
 *     payments: [{ amount, timestamp, description }],  // last 20
 *     created_at, updated_at
 *   }
 * }
 */

import { verifiedSet } from './storage.js'

const STORAGE_KEY = 'allowances'
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']

function isValidHost(host) {
  return typeof host === 'string' && host.length > 0 && !RESERVED_KEYS.includes(host)
}

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
  if (!isValidHost(host)) return
  const allowances = await getAllowances()
  const existing = allowances[host]
  const now = Math.floor(Date.now() / 1000)

  allowances[host] = {
    budget,
    spent: existing?.spent || 0,
    enabled: existing?.enabled ?? true,
    created_at: existing?.created_at || now,
    updated_at: now,
  }

  await verifiedSet(STORAGE_KEY, allowances)
}

/**
 * Enable or disable an allowance without removing it.
 * Disabled allowances keep their budget/spent data but don't auto-approve.
 */
export async function setAllowanceEnabled(host, enabled) {
  if (!isValidHost(host)) return
  const allowances = await getAllowances()
  if (!allowances[host]) return
  allowances[host].enabled = !!enabled
  allowances[host].updated_at = Math.floor(Date.now() / 1000)
  await verifiedSet(STORAGE_KEY, allowances)
}

const MAX_PAYMENT_LOG = 20

/**
 * Record spending against a host's allowance.
 * Logs the payment (last 20 kept) and returns the updated entry, or null if over budget.
 * @param {string} host
 * @param {number} amountSats
 * @param {string} [description] - optional label (e.g. invoice description)
 */
export async function recordSpend(host, amountSats, description) {
  if (!isValidHost(host)) return null
  const allowances = await getAllowances()
  const entry = allowances[host]
  if (!entry) return null

  const remaining = entry.budget - entry.spent
  if (amountSats > remaining) return null

  entry.spent += amountSats
  entry.updated_at = Math.floor(Date.now() / 1000)

  // Append to payment log (ring buffer — keep last N)
  if (!entry.payments) entry.payments = []
  entry.payments.push({ amount: amountSats, timestamp: entry.updated_at, description: description || '' })
  if (entry.payments.length > MAX_PAYMENT_LOG) entry.payments = entry.payments.slice(-MAX_PAYMENT_LOG)

  await verifiedSet(STORAGE_KEY, allowances)
  return entry
}

/**
 * Check if a payment amount fits within a host's remaining budget.
 * Returns false if the allowance is disabled or doesn't exist.
 */
export async function checkBudget(host, amountSats) {
  if (!isValidHost(host)) return false
  const entry = await getAllowance(host)
  if (!entry || entry.enabled === false) return false
  return (entry.budget - entry.spent) >= amountSats
}

/**
 * Remove an allowance for a host.
 */
export async function removeAllowance(host) {
  const allowances = await getAllowances()
  delete allowances[host]
  await verifiedSet(STORAGE_KEY, allowances)
}

/**
 * Reset spent amount for a host (e.g. monthly reset).
 */
export async function resetAllowanceSpend(host) {
  const allowances = await getAllowances()
  if (allowances[host]) {
    allowances[host].spent = 0
    allowances[host].updated_at = Math.floor(Date.now() / 1000)
    await verifiedSet(STORAGE_KEY, allowances)
  }
}
