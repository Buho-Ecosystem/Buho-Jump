/**
 * WebLN provider — runs in page (main) context.
 * Bridges window.webln calls to the extension background via the content script.
 * Only exposes webln if the extension has an active NWC wallet connection.
 * @see https://webln.guide
 */
;(function () {
  var EVENT_REQ = 'webln-request'
  var RESPONSE_TYPE = 'webln-response'
  var TIMEOUT_MS = 60000

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
        reject(new Error('WebLN request timeout'))
      }, TIMEOUT_MS)
    })
  }

  var enabled = false

  window.webln = {
    enabled: false,

    enable: function () {
      return send('webln_enable', []).then(function (result) {
        enabled = true
        window.webln.enabled = true
        return result
      })
    },

    getInfo: function () {
      if (!enabled) return Promise.reject(new Error('WebLN not enabled'))
      return send('webln_getInfo', [])
    },

    sendPayment: function (paymentRequest) {
      if (!enabled) return Promise.reject(new Error('WebLN not enabled'))
      return send('webln_sendPayment', [paymentRequest])
    },

    makeInvoice: function (args) {
      if (!enabled) return Promise.reject(new Error('WebLN not enabled'))
      return send('webln_makeInvoice', [args])
    },

    getBalance: function () {
      if (!enabled) return Promise.reject(new Error('WebLN not enabled'))
      return send('webln_getBalance', [])
    },

    keysend: function (args) {
      if (!enabled) return Promise.reject(new Error('WebLN not enabled'))
      return send('webln_keysend', [args])
    },
  }
})()
