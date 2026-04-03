import { createApp } from 'vue'
import App from './App.vue'
import i18n from '../../lib/i18n.js'
import { initLocale } from '../../composables/useLocale.js'
import '../../assets/main.css'

const app = createApp(App)
app.use(i18n)
app.mount('#app')

initLocale()
