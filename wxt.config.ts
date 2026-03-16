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
    name: 'Buho Jump - Bitcoin Wallet for Lightning & Nostr',
    description: 'Your Bitcoin Lightning wallet and companion for Nostr apps, social identity, encrypted messaging and instant payments.',
    icons: {
      48: 'logo/icon-48x48.png',
      96: 'logo/icon-96x96.png',
      128: 'logo/icon-128x128.png',
      256: 'logo/icon-256x256.png',
    },
    action: {
      default_title: 'Buho Jump',
      default_icon: {
        48: 'logo/icon-48x48.png',
        96: 'logo/icon-96x96.png',
        128: 'logo/icon-128x128.png',
      },
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
