import { createApp } from 'vue'
import App from './App.vue'
import i18n from '../../lib/i18n.js'
import { initLocale } from '../../composables/useLocale.js'
import { applyThemeBackground } from '../../lib/themeFlash.js'
import '../../assets/main.css'

// Set the page background from the stored theme before mount (avoids dark-mode flash)
applyThemeBackground()

const app = createApp(App)
app.use(i18n)
app.mount('#app')

// Load saved locale preference (non-blocking)
initLocale()
