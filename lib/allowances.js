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
import { isCanonicalWebOrigin } from './origins.js'

const STORAGE_KEY = 'allowances'
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']
const MAX_SATS = 21_000_000 * 100_000_000
let mutationTail = Promise.resolve()

function isValidOrigin(origin) {
  return typeof origin === 'string'
    && origin.length > 0
    && !RESERVED_KEYS.includes(origin)
    && isCanonicalWebOrigin(origin)
}

function isValidAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_SATS
}

function serializeMutation(operation) {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}

function sanitizeAllowances(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const clean = {}
  for (const [origin, entry] of Object.entries(value)) {
    if (!isValidOrigin(origin) || !entry || typeof entry !== 'object' || !isValidAmount(entry.budget)) continue
    const spent = Number.isSafeInteger(entry.spent) && entry.spent >= 0 ? entry.spent : 0
    clean[origin] = {
      budget: entry.budget,
      spent,
      enabled: entry.enabled !== false,
      created_at: Number.isSafeInteger(entry.created_at) ? entry.created_at : 0,
      updated_at: Number.isSafeInteger(entry.updated_at) ? entry.updated_at : 0,
      ...(Array.isArray(entry.payments) ? { payments: entry.payments.slice(-MAX_PAYMENT_LOG) } : {}),
    }
  }
  return clean
}

export async function getAllowances() {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  return sanitizeAllowances(data[STORAGE_KEY])
}

export async function getAllowance(host) {
  if (!isValidOrigin(host)) return null
  const allowances = await getAllowances()
  return allowances[host] || null
}

/**
 * Set or update a budget allowance for a host.
 * @param {string} host - domain name
 * @param {number} budget - total budget in sats
 */
export async function setAllowance(host, budget) {
  if (!isValidOrigin(host) || !isValidAmount(budget)) return
  return serializeMutation(async () => {
    const allowances = await getAllowances()
    const existing = allowances[host]
    const now = Math.floor(Date.now() / 1000)
    allowances[host] = {
      budget,
      spent: existing?.spent || 0,
      enabled: existing?.enabled ?? true,
      created_at: existing?.created_at || now,
      updated_at: now,
      ...(existing?.payments ? { payments: existing.payments } : {}),
    }
    await verifiedSet(STORAGE_KEY, allowances)
  })
}

/**
 * Enable or disable an allowance without removing it.
 * Disabled allowances keep their budget/spent data but don't auto-approve.
 */
export async function setAllowanceEnabled(host, enabled) {
  if (!isValidOrigin(host)) return
  return serializeMutation(async () => {
    const allowances = await getAllowances()
    if (!allowances[host]) return
    allowances[host].enabled = !!enabled
    allowances[host].updated_at = Math.floor(Date.now() / 1000)
    await verifiedSet(STORAGE_KEY, allowances)
  })
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
  if (!isValidOrigin(host) || !isValidAmount(amountSats)) return null
  return serializeMutation(() => recordSpendUnlocked(host, amountSats, description))
}

async function recordSpendUnlocked(host, amountSats, description, reservationId = null) {
  const allowances = await getAllowances()
  const entry = allowances[host]
  if (!entry || entry.enabled === false || amountSats > entry.budget - entry.spent) return null
  entry.spent += amountSats
  entry.updated_at = Math.floor(Date.now() / 1000)
  entry.payments ||= []
  entry.payments.push({
    amount: amountSats,
    timestamp: entry.updated_at,
    description: typeof description === 'string' ? description.slice(0, 200) : '',
    ...(reservationId ? { reservationId } : {}),
  })
  if (entry.payments.length > MAX_PAYMENT_LOG) entry.payments = entry.payments.slice(-MAX_PAYMENT_LOG)
  await verifiedSet(STORAGE_KEY, allowances)
  return entry
}

/** Atomically claim budget before a payment leaves the wallet. */
export async function reserveSpend(host, amountSats, description) {
  if (!isValidOrigin(host) || !isValidAmount(amountSats)) return null
  const reservationId = crypto.randomUUID()
  return serializeMutation(async () => {
    const entry = await recordSpendUnlocked(host, amountSats, description, reservationId)
    return entry ? { reservationId, entry } : null
  })
}

/** Refund a failed payment reservation. Successful reservations remain spend. */
export async function refundSpend(host, reservationId) {
  if (!isValidOrigin(host) || typeof reservationId !== 'string' || !reservationId) return false
  return serializeMutation(async () => {
    const allowances = await getAllowances()
    const entry = allowances[host]
    if (!entry?.payments) return false
    const index = entry.payments.findIndex(payment => payment.reservationId === reservationId)
    if (index < 0) return false
    const [reservation] = entry.payments.splice(index, 1)
    entry.spent = Math.max(0, entry.spent - reservation.amount)
    entry.updated_at = Math.floor(Date.now() / 1000)
    await verifiedSet(STORAGE_KEY, allowances)
    return true
  })
}

/**
 * Check if a payment amount fits within a host's remaining budget.
 * Returns false if the allowance is disabled or doesn't exist.
 */
export async function checkBudget(host, amountSats) {
  if (!isValidOrigin(host) || !isValidAmount(amountSats)) return false
  const entry = await getAllowance(host)
  if (!entry || entry.enabled === false) return false
  return (entry.budget - entry.spent) >= amountSats
}

/**
 * Remove an allowance for a host.
 */
export async function removeAllowance(host) {
  if (!isValidOrigin(host)) return
  return serializeMutation(async () => {
    const allowances = await getAllowances()
    delete allowances[host]
    await verifiedSet(STORAGE_KEY, allowances)
  })
}

/**
 * Reset spent amount for a host (e.g. monthly reset).
 */
export async function resetAllowanceSpend(host) {
  if (!isValidOrigin(host)) return
  return serializeMutation(async () => {
    const allowances = await getAllowances()
    if (allowances[host]) {
      allowances[host].spent = 0
      allowances[host].payments = []
      allowances[host].updated_at = Math.floor(Date.now() / 1000)
      await verifiedSet(STORAGE_KEY, allowances)
    }
  })
}
