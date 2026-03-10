/**
 * NIP-46 bridge for remote signing.
 *
 * Supports two URI formats:
 * - bunker://<remote-signer-pubkey>?relay=wss://...&secret=<optional>
 *     → Standard NIP-46: extension acts as CLIENT, connects to remote SIGNER
 *
 * - nostrconnect://<remote-signer-pubkey>?relay=wss://...&secret=<optional>&name=...&url=...&image=...
 *     → Same flow, different prefix. Both treat the pubkey as the remote signer.
 *     → Extra metadata (name, url, image) is extracted but not required.
 *
 * Uses nostr-core's Relay and nip04 primitives directly since nostr-core's
 * nip46 module is not yet compiled to dist.
 */

import { Relay, finalizeEvent, nip04, getPublicKey, hexToBytes, bytesToHex, randomBytes } from 'nostr-core'

const NIP46_KIND = 24133
const DEFAULT_TIMEOUT = 30000 // 30s — faster feedback than 60s

/**
 * Parse a bunker:// or nostrconnect:// URI.
 * Both formats: <protocol>://<remote-signer-pubkey>?relay=wss://...&secret=<optional>
 */
export function parseBunkerURI(uri) {
  const isBunker = uri.startsWith('bunker://')
  const isNostrConnect = uri.startsWith('nostrconnect://')

  if (!isBunker && !isNostrConnect) {
    throw new Error('Invalid URI: must start with bunker:// or nostrconnect://')
  }

  const normalized = uri.replace(/^(bunker|nostrconnect):\/\//, 'http://')
  const url = new URL(normalized)
  const pubkey = url.hostname || url.pathname.replace(/^\/\//, '')

  const relays = url.searchParams.getAll('relay')
  const secret = url.searchParams.get('secret') || null

  // nostrconnect:// may include app metadata
  const name = url.searchParams.get('name') || null
  const appUrl = url.searchParams.get('url') || null
  const image = url.searchParams.get('image') || null

  if (!pubkey || pubkey.length < 64) throw new Error('Invalid URI: missing or invalid pubkey')
  if (!relays.length) throw new Error('Invalid URI: missing relay parameter')

  return { pubkey, relays, secret, isBunker, name, appUrl, image }
}

/**
 * Remote signer client — connects to a NIP-46 bunker.
 * Implements the same interface as nostr-core's Signer.
 */
export class RemoteSigner {
  #relay = null
  #sub = null
  #secretKey
  #publicKey
  #remotePubkey
  #relayUrls
  #connected = false
  #pending = new Map()
  #timeout

  constructor({ secretKey, remotePubkey, relayUrls, timeout = DEFAULT_TIMEOUT }) {
    this.#secretKey = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey
    this.#publicKey = getPublicKey(this.#secretKey)
    this.#remotePubkey = remotePubkey
    this.#relayUrls = relayUrls
    this.#timeout = timeout
  }

  get connected() { return this.#connected }
  get remotePubkey() { return this.#remotePubkey }
  get publicKey() { return this.#publicKey }
  get relayUrls() { return this.#relayUrls }

  /**
   * Connect to the first available relay and perform NIP-46 handshake.
   */
  async connect(secret) {
    for (const url of this.#relayUrls) {
      try {
        this.#relay = new Relay(url)
        await this.#relay.connect({ timeout: 5000 })

        // Subscribe to responses
        this.#sub = this.#relay.subscribe(
          [{ kinds: [NIP46_KIND], authors: [this.#remotePubkey], '#p': [this.#publicKey] }],
          { onevent: (event) => this.#handleResponse(event) }
        )

        // Send connect handshake
        const params = [this.#publicKey]
        if (secret) params.push(secret)
        await this.#sendRequest('connect', params)

        this.#connected = true
        return
      } catch (err) {
        this.#relay?.close()
        // If it's not the last relay, try the next one
        if (url === this.#relayUrls[this.#relayUrls.length - 1]) {
          throw new Error(`Failed to connect: ${err.message}`)
        }
        continue
      }
    }
    throw new Error('Failed to connect to any relay')
  }

  close() {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timeout)
      p.reject(new Error('Connection closed'))
    }
    this.#pending.clear()
    this.#sub?.close()
    this.#relay?.close()
    this.#connected = false
  }

  async getPublicKey() {
    return this.#sendRequest('get_public_key', [])
  }

  async signEvent(event) {
    const result = await this.#sendRequest('sign_event', [JSON.stringify(event)])
    return JSON.parse(result)
  }

  async nip04Encrypt(pubkey, plaintext) {
    return this.#sendRequest('nip04_encrypt', [pubkey, plaintext])
  }

  async nip04Decrypt(pubkey, ciphertext) {
    return this.#sendRequest('nip04_decrypt', [pubkey, ciphertext])
  }

  async nip44Encrypt(pubkey, plaintext) {
    return this.#sendRequest('nip44_encrypt', [pubkey, plaintext])
  }

  async nip44Decrypt(pubkey, ciphertext) {
    return this.#sendRequest('nip44_decrypt', [pubkey, ciphertext])
  }

  async getRelays() {
    const result = await this.#sendRequest('get_relays', [])
    return JSON.parse(result)
  }

  // ── Private ──

  async #sendRequest(method, params) {
    if (method !== 'connect' && !this.#connected) {
      throw new Error('Not connected. Call connect() first.')
    }

    const id = bytesToHex(randomBytes(16))
    const request = JSON.stringify({ id, method, params })
    const encrypted = nip04.encrypt(this.#secretKey, this.#remotePubkey, request)

    const event = finalizeEvent(
      {
        kind: NIP46_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.#remotePubkey]],
        content: encrypted,
      },
      this.#secretKey
    )

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Request timed out after ${this.#timeout / 1000}s: ${method}`))
      }, this.#timeout)

      this.#pending.set(id, { resolve, reject, timeout })

      this.#relay.publish(event).catch((err) => {
        clearTimeout(timeout)
        this.#pending.delete(id)
        reject(new Error(`Failed to publish ${method}: ${err.message}`))
      })
    })
  }

  #handleResponse(event) {
    let decrypted
    try {
      decrypted = nip04.decrypt(this.#secretKey, this.#remotePubkey, event.content)
    } catch { return }

    let response
    try {
      response = JSON.parse(decrypted)
    } catch { return }

    const pending = this.#pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.#pending.delete(response.id)

    if (response.error) {
      pending.reject(new Error(response.error))
    } else {
      pending.resolve(response.result || '')
    }
  }
}

/**
 * Connect to a bunker via URI string.
 * @param {string} uri - bunker:// or nostrconnect:// URI
 * @param {string} clientSecretHex - hex client secret key
 * @returns {Promise<RemoteSigner>}
 */
export async function connectBunker(uri, clientSecretHex) {
  const parsed = parseBunkerURI(uri)
  const signer = new RemoteSigner({
    secretKey: clientSecretHex,
    remotePubkey: parsed.pubkey,
    relayUrls: parsed.relays,
  })
  await signer.connect(parsed.secret)
  return signer
}
