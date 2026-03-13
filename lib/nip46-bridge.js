/**
 * NIP-46 bridge — thin adapter over nostr-core's NostrConnect.
 *
 * nostr-core v0.4.0 provides the full NIP-46 client (NostrConnect class).
 * This file only adds:
 *   - connectBunker()         — convenience wrapper with hex key + 30s timeout
 *   - createNostrConnectURI() — generate nostrconnect:// URI for QR scanning
 *   - awaitNostrConnect()     — reverse flow: listen for signer to connect back
 */

import {
  NostrConnect, parseConnectionURI,
  Relay, finalizeEvent, nip04, getPublicKey, hexToBytes,
  Nip46TimeoutError, Nip46ConnectionError, Nip46RemoteError,
} from 'nostr-core'

export { parseConnectionURI }

const NIP46_KIND = 24133
const EXTENSION_TIMEOUT = 30000 // 30s — faster feedback than nostr-core's 60s default

/**
 * Connect to a bunker via URI string.
 * @param {string} uri - bunker:// or nostrconnect:// URI
 * @param {string|Uint8Array} clientSecretHex - client secret key (hex string or bytes)
 * @returns {Promise<NostrConnect>}
 */
export async function connectBunker(uri, clientSecretHex) {
  const { remotePubkey, relayUrls, secret } = parseConnectionURI(uri)
  const signer = new NostrConnect({
    remotePubkey,
    relayUrls,
    secret,
    secretKey: typeof clientSecretHex === 'string' ? hexToBytes(clientSecretHex) : clientSecretHex,
  })
  signer.timeout = EXTENSION_TIMEOUT
  await signer.connect()
  return signer
}

/**
 * Generate a nostrconnect:// URI for signer apps to scan.
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
 *
 * Flow: listen on relay → signer sends NIP-46 "connect" → ack it → create
 * NostrConnect with the discovered signer pubkey → connect (re-handshake).
 *
 * If the signer rejects the re-handshake (some signers reject duplicate
 * connect), we treat "already connected" as success since the ack succeeded.
 *
 * @param {Object} opts
 * @param {AbortSignal} [opts.signal] - AbortSignal to cancel the wait
 * @returns {Promise<{ signer: NostrConnect, remotePubkey: string, relayUrl: string }>}
 */
export async function awaitNostrConnect({ secretKey, relayUrl, secret, timeout = 60000, signal }) {
  const sk = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey
  const clientPubkey = getPublicKey(sk)

  // Bail early if already aborted
  if (signal?.aborted) throw new Nip46ConnectionError('Cancelled')

  const relay = new Relay(relayUrl)
  await relay.connect({ timeout: 5000 }).catch((err) => {
    throw new Nip46ConnectionError(`Failed to listen on relay: ${err.message}`)
  })

  try {
    const signerPubkey = await waitForConnectRequest(relay, sk, clientPubkey, secret, timeout, signal)

    // Close the listening relay — NostrConnect.connect() opens its own
    relay.close()

    const signer = new NostrConnect({
      remotePubkey: signerPubkey,
      relayUrls: [relayUrl],
      secretKey: sk,
    })
    signer.timeout = EXTENSION_TIMEOUT

    // Re-handshake: the signer already sent connect and we acked, so most
    // signers will accept. If they reject with "already connected", that's
    // fine — the session is established either way.
    try {
      await signer.connect()
    } catch (err) {
      if (err instanceof Nip46RemoteError && /already.connected/i.test(err.message)) {
        // Signer considers us connected — session is valid
      } else {
        throw err
      }
    }

    return { signer, remotePubkey: signerPubkey, relayUrl }
  } catch (err) {
    relay.close()
    throw err
  }
}

// ── Internal ────────────────────────────────────────────────────

/**
 * Subscribe to NIP-46 events on a relay and wait for a valid "connect" request.
 * Sends an ack response when found. Returns the signer's pubkey.
 * Supports cancellation via AbortSignal.
 */
function waitForConnectRequest(relay, sk, clientPubkey, expectedSecret, timeout, signal) {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sub.close()
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new Nip46ConnectionError('Cancelled'))
    }

    // Wire up abort signal
    if (signal?.aborted) { reject(new Nip46ConnectionError('Cancelled')); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Nip46TimeoutError('No signer connected within timeout'))
    }, timeout)

    const sub = relay.subscribe(
      [{
        kinds: [NIP46_KIND],
        '#p': [clientPubkey],
        since: Math.floor(Date.now() / 1000) - 30, // ignore stale events on relay
      }],
      {
        onevent: (event) => {
          if (settled) return

          let decrypted
          try { decrypted = nip04.decrypt(sk, event.pubkey, event.content) } catch { return }

          let request
          try { request = JSON.parse(decrypted) } catch { return }

          if (request.method !== 'connect') return

          // Verify secret if one was included in the URI
          const [, incomingSecret] = request.params || []
          if (expectedSecret && incomingSecret !== expectedSecret) return

          cleanup()

          // Send ack response so the signer knows we received it
          const response = JSON.stringify({ id: request.id, result: 'ack' })
          const encrypted = nip04.encrypt(sk, event.pubkey, response)
          const ackEvent = finalizeEvent({
            kind: NIP46_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', event.pubkey]],
            content: encrypted,
          }, sk)
          relay.publish(ackEvent).catch(() => {})

          resolve(event.pubkey)
        },
      }
    )
  })
}
