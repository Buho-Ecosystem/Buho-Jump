/**
 * i18n setup — vue-i18n with lazy-loaded locales.
 * English is bundled inline; other languages load on demand.
 */
import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'

export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
]

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
})

/**
 * Lazy-load a locale's messages and set it as active.
 * Caches loaded locales so each file is fetched only once.
 */
const loaded = new Set(['en'])

export async function setLocale(code) {
  if (!loaded.has(code)) {
    try {
      const messages = await import(`../locales/${code}.json`)
      i18n.global.setLocaleMessage(code, messages.default || messages)
      loaded.add(code)
    } catch (err) {
      console.warn(`[i18n] Failed to load locale "${code}", falling back to English`, err)
      code = 'en'
    }
  }
  i18n.global.locale.value = code
  return code
}

export default i18n
