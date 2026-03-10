import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  dev: {
    server: {
      port: 3457,
    },
  },
  manifest: ({ browser }) => ({
    name: 'Buho Jump',
    description: 'Nostr key manager, NIP-07 signer, NIP-46 remote signing, NWC wallet & WebLN provider — by Buho',
    action: {
      default_title: 'Buho Jump',
    },
    permissions: browser === 'firefox'
      ? ['storage', 'tabs', 'notifications']
      : ['storage', 'tabs', 'windows', 'notifications'],
    web_accessible_resources: [
      {
        resources: ['nostr-provider.js', 'webln-provider.js'],
        matches: ['<all_urls>'],
      },
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: '@buho-jump',
        },
      },
    }),
  }),
})
