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
 * Extends beyond nostr-core's NostrConnect:
 * - bunker:// URI support (Amber, LNbits always-on signer)
 * - Multiple relay fallback
 * - Secret param in connect handshake
 * - NIP-44 remote encrypt/decrypt methods
 *
 * Uses nostr-core primitives (Relay, nip04, finalizeEvent) and error classes.
 */

import {
  Relay, finalizeEvent, nip04, getPublicKey, hexToBytes, bytesToHex, randomBytes,
  Nip46Error, Nip46TimeoutError, Nip46ConnectionError, Nip46RemoteError,
} from 'nostr-core'

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
    throw new Nip46Error('Invalid URI: must start with bunker:// or nostrconnect://', 'INVALID_URI')
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

  if (!pubkey || pubkey.length < 64) throw new Nip46Error('Invalid URI: missing or invalid pubkey', 'INVALID_URI')
  if (!relays.length) throw new Nip46Error('Invalid URI: missing relay parameter', 'INVALID_URI')

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
  async connect(secret, { skipHandshake = false } = {}) {
    for (const url of this.#relayUrls) {
      try {
        this.#relay = new Relay(url)
        await this.#relay.connect({ timeout: 5000 })

        // Subscribe to responses
        this.#sub = this.#relay.subscribe(
          [{ kinds: [NIP46_KIND], authors: [this.#remotePubkey], '#p': [this.#publicKey] }],
          { onevent: (event) => this.#handleResponse(event) }
        )

        // Send connect handshake (skipped for nostrconnect flow — already acked)
        if (!skipHandshake) {
          const params = [this.#publicKey]
          if (secret) params.push(secret)
          await this.#sendRequest('connect', params)
        }

        this.#connected = true
        return
      } catch (err) {
        this.#relay?.close()
        // If it's not the last relay, try the next one
        if (url === this.#relayUrls[this.#relayUrls.length - 1]) {
          throw new Nip46ConnectionError(`Failed to connect: ${err.message}`)
        }
        continue
      }
    }
    throw new Nip46ConnectionError('Failed to connect to any relay')
  }

  /**
   * Gracefully disconnect — notify the remote signer, then close.
   */
  async disconnect() {
    if (this.#connected) {
      try { await this.#sendRequest('disconnect', []) } catch { /* best-effort */ }
    }
    this.close()
  }

  close() {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timeout)
      p.reject(new Nip46Error('Connection closed'))
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
      throw new Nip46ConnectionError('Not connected. Call connect() first.')
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
        reject(new Nip46TimeoutError(`Request timed out after ${this.#timeout / 1000}s: ${method}`))
      }, this.#timeout)

      this.#pending.set(id, { resolve, reject, timeout })

      this.#relay.publish(event).catch((err) => {
        clearTimeout(timeout)
        this.#pending.delete(id)
        reject(new Nip46Error(`Failed to publish ${method}: ${err.message}`))
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
      pending.reject(new Nip46RemoteError(response.error))
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

/**
 * Generate a nostrconnect:// URI for signer apps to scan.
 * The URI contains this extension's client pubkey so the signer can connect back.
 */
export function createNostrConnectURI({ clientPubkey, relayUrl, secret, name, url, image }) {
  const params = new URLSearchParams()
  params.set('relay', relayUrl)
  if (secret) params.set('secret', secret)
  if (name) params.set('name', name)
  if (url) params.set('url', url)
  if (image) params.set('image', image)
  return `nostrconnect://${clientPubkey}?${params.toString()}`
}

/**
 * Wait for a remote signer to connect back after scanning a nostrconnect:// URI.
 * Listens for an incoming NIP-46 "connect" request from the signer.
 *
 * @param {Object} opts
 * @param {Uint8Array|string} opts.secretKey - client secret key
 * @param {string} opts.relayUrl - relay to listen on
 * @param {string} opts.secret - expected secret from the URI
 * @param {number} [opts.timeout] - timeout in ms (default 60s)
 * @returns {Promise<RemoteSigner>} connected signer
 */
export function awaitNostrConnect({ secretKey, relayUrl, secret, timeout = 60000 }) {
  const sk = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey
  const clientPubkey = getPublicKey(sk)

  return new Promise(async (resolve, reject) => {
    let relay, sub, timer

    const cleanup = () => {
      clearTimeout(timer)
      sub?.close()
    }

    timer = setTimeout(() => {
      cleanup()
      relay?.close()
      reject(new Nip46TimeoutError('No signer connected within timeout'))
    }, timeout)

    try {
      relay = new Relay(relayUrl)
      await relay.connect({ timeout: 5000 })

      // Listen for any NIP-46 message tagged to our client pubkey
      sub = relay.subscribe(
        [{ kinds: [NIP46_KIND], '#p': [clientPubkey] }],
        {
          onevent: (event) => {
            let decrypted
            try {
              decrypted = nip04.decrypt(sk, event.pubkey, event.content)
            } catch { return }

            let request
            try {
              request = JSON.parse(decrypted)
            } catch { return }

            if (request.method !== 'connect') return

            // Verify secret if provided
            const [, incomingSecret] = request.params || []
            if (secret && incomingSecret !== secret) return

            // Signer's pubkey is the event author
            const signerPubkey = event.pubkey

            cleanup()

            // Send "connect" ack response
            const response = JSON.stringify({ id: request.id, result: 'ack' })
            const encrypted = nip04.encrypt(sk, signerPubkey, response)
            const ackEvent = finalizeEvent({
              kind: NIP46_KIND,
              created_at: Math.floor(Date.now() / 1000),
              tags: [['p', signerPubkey]],
              content: encrypted,
            }, sk)
            relay.publish(ackEvent).catch(() => {})

            // Close the listening relay — RemoteSigner.connect() opens its own
            relay.close()

            // Create and connect a proper RemoteSigner
            const signer = new RemoteSigner({
              secretKey: sk,
              remotePubkey: signerPubkey,
              relayUrls: [relayUrl],
            })
            // Skip handshake — signer already sent connect, we acked
            signer.connect(null, { skipHandshake: true })
              .then(() => resolve(signer))
              .catch(reject)
          },
        }
      )
    } catch (err) {
      cleanup()
      reject(new Nip46ConnectionError(`Failed to listen on relay: ${err.message}`))
    }
  })
}
