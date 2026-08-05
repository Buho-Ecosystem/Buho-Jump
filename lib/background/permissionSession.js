/**
 * In-memory permission state for the current browser visit.
 *
 * Persistent decisions live in lib/permissions.js. This module deliberately
 * keeps visit grants in memory and scopes them to the active identity, tab,
 * origin, method, and (for event signing) event kind.
 *
 * Concurrent requests for the same scope share one pending prompt. The
 * cryptographic operation is never shared: callers only reuse the user's
 * permission decision and each handler performs its own operation afterwards.
 */

const NEVER_COALESCE = new Set(['weblnSendPayment', 'weblnKeysend'])

function normalizePart(value) {
  return value == null ? '' : String(value)
}

export function permissionScopeKey({ profileId, tabId, origin, method, kind }) {
  if (!origin || !method) return null
  return [profileId, tabId, origin, method, method === 'signEvent' ? kind : '']
    .map(normalizePart)
    .join('\u001f')
}

function permissionLaneKey({ profileId, tabId, origin }) {
  if (!origin) return null
  return [profileId, tabId, origin].map(normalizePart).join('\u001f')
}

export function createPermissionSession() {
  const grants = new Map()
  const pending = new Map()
  const lanes = new Map()
  const laneDepth = new Map()
  const laneGenerations = new Map()
  const tabGenerations = new Map()
  const MAX_PENDING_TOTAL = 32
  const MAX_PENDING_PER_LANE = 8
  let generation = 0
  let uniqueRequest = 0

  function hasGrant(scope) {
    const key = permissionScopeKey(scope)
    return key ? grants.has(key) : false
  }

  function grant(scope) {
    const key = permissionScopeKey(scope)
    if (key) grants.set(key, { ...scope, key })
  }

  function listGrants(profileId = null) {
    return [...grants.values()]
      .filter(scope => profileId == null || scope.profileId === profileId)
      .map(scope => ({ ...scope }))
  }

  function revoke(key) {
    return typeof key === 'string' ? grants.delete(key) : false
  }

  function clearOrigin(profileId, origin) {
    for (const [key, scope] of grants) {
      if (scope.profileId === profileId && scope.origin === origin) grants.delete(key)
    }
  }

  function clearProfile(profileId) {
    for (const [key, scope] of grants) {
      if (scope.profileId === profileId) grants.delete(key)
    }
  }

  function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1)
  }

  function cancelLane(scope) {
    const key = permissionLaneKey(scope)
    if (key) bump(laneGenerations, key)
  }

  function clearTab(tabId) {
    const tabPart = normalizePart(tabId)
    bump(tabGenerations, tabPart)
    for (const [key, scope] of grants) {
      if (normalizePart(scope.tabId) === tabPart) grants.delete(key)
    }
  }

  function clear() {
    grants.clear()
    generation++
  }

  function pendingCount() {
    return pending.size
  }

  /**
   * Run one prompt per permission scope and show distinct permissions one at a
   * time per site/tab. Payment approvals receive unique keys so each payment
   * remains a separate user decision while still avoiding a window flood.
   */
  function coalesce(scope, openPrompt) {
    const key = permissionScopeKey(scope)
    const laneKey = permissionLaneKey(scope)
    if (!key || !laneKey) return Promise.resolve().then(openPrompt)

    const canCoalesce = !NEVER_COALESCE.has(scope.method)
    if (canCoalesce) {
      const existing = pending.get(key)
      if (existing) return existing
    }

    const depth = laneDepth.get(laneKey) || 0
    if (pending.size >= MAX_PENDING_TOTAL || depth >= MAX_PENDING_PER_LANE) {
      const error = new Error('Too many permission requests')
      error.code = 'REQUEST_LIMIT'
      return Promise.reject(error)
    }

    const pendingKey = canCoalesce ? key : `${key}\u001f${++uniqueRequest}`
    const previous = lanes.get(laneKey)
    const startGeneration = generation
    const startLaneGeneration = laneGenerations.get(laneKey) || 0
    const tabPart = normalizePart(scope.tabId)
    const startTabGeneration = tabGenerations.get(tabPart) || 0
    laneDepth.set(laneKey, depth + 1)
    let promise
    promise = Promise.resolve()
      .then(async () => {
        if (previous) await previous.catch(() => {})
        if (
          generation !== startGeneration
          || (laneGenerations.get(laneKey) || 0) !== startLaneGeneration
          || (tabGenerations.get(tabPart) || 0) !== startTabGeneration
        ) return false
        // Lane depth still counts this request, so behind = depth - 1.
        // The prompt shows it so queued requests read as one guided flow.
        return openPrompt({ queuedBehind: Math.max(0, (laneDepth.get(laneKey) || 1) - 1) })
      })
      .finally(() => {
        if (pending.get(pendingKey) === promise) pending.delete(pendingKey)
        if (lanes.get(laneKey) === promise) lanes.delete(laneKey)
        const nextDepth = (laneDepth.get(laneKey) || 1) - 1
        if (nextDepth > 0) laneDepth.set(laneKey, nextDepth)
        else laneDepth.delete(laneKey)
      })

    pending.set(pendingKey, promise)
    lanes.set(laneKey, promise)
    return promise
  }

  return {
    hasGrant,
    grant,
    listGrants,
    revoke,
    clearOrigin,
    clearProfile,
    cancelLane,
    clearTab,
    clear,
    coalesce,
    pendingCount,
  }
}
