import { createApp } from 'vue'
import App from './App.vue'
import i18n from '../../lib/i18n.js'
import { initLocale } from '../../composables/useLocale.js'
import { applyThemeBackground } from '../../lib/themeFlash.js'
import '../../assets/main.css'

// Keepalive port to the background, held for this window's whole lifetime.
// An open Port keeps the MV3 service worker (Chrome) / event page (Firefox)
// alive, so the background's in-memory pending-request map and the handler
// awaiting this prompt survive while the user unlocks and approves. We connect
// before Vue mounts (and before any mode-specific early return) to minimize the
// gap where only the in-flight request keeps the worker alive. The browser
// auto-disconnects the port when the window/tab closes.
const requestId = new URLSearchParams(location.search).get('requestId')
if (requestId) {
  try {
    const port = chrome.runtime.connect({ name: `prompt:${requestId}` })
    // Page-driven heartbeat reliably resets the worker idle timer (page timers
    // are reliable; SW-side timers are not, hence the no-op handler in the
    // background's onConnect listener consumes these pings).
    const ping = setInterval(() => {
      try { port.postMessage({ t: 'ping' }) } catch {}
    }, 20000)
    port.onDisconnect.addListener(() => clearInterval(ping))
  } catch { /* extension context unavailable */ }
}

// Set the page background from the stored theme before mount (avoids dark-mode flash)
applyThemeBackground()

const app = createApp(App)
app.use(i18n)
app.mount('#app')

// Load saved locale preference (non-blocking)
initLocale()
