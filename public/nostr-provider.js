/**
 * NIP-07 window.nostr provider — runs in page (main) context.
 * Sends requests via CustomEvent. Receives responses via postMessage
 * (Firefox cannot read CustomEvent.detail from extensions).
 * @see https://nips.nostr.com/7
 */
;(function () {
  var EVENT_REQ = 'nip07-request'
  var RESPONSE_TYPE = 'nip07-response'
  // Generous: a locked request prompts the user to unlock AND then approve, two
  // sequential interactions in separate windows. Too short and the page rejects
  // mid-flow even though the extension is still waiting on the user.
  var TIMEOUT_MS = 180000

  function send(method, params) {
    return new Promise(function (resolve, reject) {
      var id = Math.random().toString(36).slice(2) + Date.now()

      function onMessage(e) {
        if (e.source !== window || e.data?.type !== RESPONSE_TYPE) return
        var p = e.data.payload
        if (!p || p.id !== id) return
        window.removeEventListener('message', onMessage)
        clearTimeout(timer)
        if (p.error) reject(new Error(p.error))
        else resolve(p.result)
      }

      window.addEventListener('message', onMessage)
      document.dispatchEvent(
        new CustomEvent(EVENT_REQ, {
          detail: { id: id, method: method, params: params || [] },
        })
      )

      var timer = setTimeout(function () {
        window.removeEventListener('message', onMessage)
        reject(new Error('NIP-07 request timeout'))
      }, TIMEOUT_MS)
    })
  }

  function checkEvent(event) {
    if (!event || typeof event !== 'object') return 'Event must be an object'
    if (typeof event.kind !== 'number') return 'Event must have kind (number)'
    if (typeof event.content !== 'string') return 'Event must have content (string)'
    if (!Array.isArray(event.tags)) return 'Event must have tags (array)'
    if (typeof event.created_at !== 'number') return 'Event must have created_at (number)'
    return null
  }

  window.nostr = {
    getPublicKey: function () {
      return send('getPublicKey', [])
    },
    signEvent: function (event) {
      var err = checkEvent(event)
      if (err) return Promise.reject(new Error(err))
      return send('signEvent', [event])
    },
    getRelays: function () {
      return send('getRelays', [])
    },
    nip04: {
      encrypt: function (pubkey, plaintext) {
        return send('nip04_encrypt', [pubkey, plaintext])
      },
      decrypt: function (pubkey, ciphertext) {
        return send('nip04_decrypt', [pubkey, ciphertext])
      },
    },
    nip44: {
      encrypt: function (pubkey, plaintext) {
        return send('nip44_encrypt', [pubkey, plaintext])
      },
      decrypt: function (pubkey, ciphertext) {
        return send('nip44_decrypt', [pubkey, ciphertext])
      },
    },
  }
})()
