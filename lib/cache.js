/**
 * Simple TTL cache — replaces scattered Date.now() arithmetic with a clean API.
 *
 * Usage:
 *   const cache = new TtlCache(15 * 60 * 1000)  // 15 min TTL
 *   cache.set('key', data)
 *   const hit = cache.get('key')  // returns data or undefined if expired
 */

export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs
    this.entries = new Map()
  }

  get(key) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expires) {
      this.entries.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key, data) {
    this.entries.set(key, { data, expires: Date.now() + this.ttlMs })
  }

  has(key) {
    return this.get(key) !== undefined
  }

  delete(key) {
    this.entries.delete(key)
  }

  clear() {
    this.entries.clear()
  }
}
