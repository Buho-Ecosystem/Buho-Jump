// Review-only host: mounts real components, with synthetic state and no live services.
import { createApp, h, nextTick } from 'vue'
import i18n, { setLocale } from '../../lib/i18n.js'
import '../../assets/main.css'
import { useAccounts } from '../../composables/useAccounts.js'
import { useWallet } from '../../composables/useWallet.js'
import { themes, defaultTheme } from '../../themes/tokens.js'
import { useContacts } from '../../composables/useContacts.js'
import { useChat } from '../../composables/useChat.js'
const components = import.meta.glob('../../components/**/*.vue')
const entries = import.meta.glob('../../entrypoints/*/App.vue')
window.mountReview = async ({ component, props = {}, state = {}, locale = 'en', mode = 'light', full = false, empty = false }) => {
  await setLocale(locale)
  document.documentElement.setAttribute('data-theme', defaultTheme)
  document.documentElement.setAttribute('data-mode', mode)
  for (const [key, value] of Object.entries(themes[defaultTheme][mode])) document.documentElement.style.setProperty(`--${key}`, value)
  await chrome.storage.local.set({mode, locale})
  const { account, wallet, messages } = window.__fixtures
  useAccounts().accounts.value = [account]
  useWallet().wallets.value = [wallet]
  useWallet().status.value = { connected: true, balance: 2100, activeWallet: wallet }
  useChat().currentAccountPubkey.value = account.pubkey
  useChat().initialized.value = true
  useChat().messages.value = empty ? {} : messages
  useContacts().contacts.value = [{pubkey: 'b'.repeat(64),npub:'npub1blair',profile:{display_name:'Blair'}}]
  useContacts().loading.value = false
  const module = (components[`../../components/${component}.vue`] || entries[`../../entrypoints/${component}/App.vue`])
  if (!module) throw new Error(`Unknown review component: ${component}`)
  const View = (await module()).default
  let view
  createApp({ render: () => h('main', { class: full ? '' : 'review-component', style: full ? '' : `padding:16px;min-height:600px;position:relative;${component.startsWith('chat/ChatThread') ? 'height:700px;display:flex;flex-direction:column;' : ''}${component === 'chat/ChatBubble' ? 'padding-top:260px;' : ''}` }, [h(View, { ...props, ref: instance => { view = instance } })]) }).use(i18n).mount('#app')
  await new Promise(resolve => setTimeout(resolve, 150))
  const setup = view.$.setupState
  for (const [key, value] of Object.entries(state)) {
    if (!(key in setup)) throw new Error(`Unknown fixture state ${component}.${key}`)
    setup[key] = value
    await nextTick()
  }
  useContacts().loading.value = false
  await nextTick()
  window.__reviewView = view
}
