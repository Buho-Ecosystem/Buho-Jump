import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  dev: {
    server: {
      port: 3457,
    },
  },
  zip: {
    // AMO reviewers rebuild from the sources ZIP and diff the result. Keep
    // build artifacts and internal planning docs out so what they get is
    // source only.
    // (node_modules, dotfiles, tests and .output are excluded by WXT already.)
    excludeSources: [
      '**/*.zip',
      'PRODUCT_TREE.md',
    ],
  },
  manifest: ({ browser }) => ({
    // AMO caps the manifest name at 45 chars; Chromium allows the longer form.
    name: browser === 'firefox'
      ? 'Buho Jump - Bitcoin Lightning & Nostr Wallet'
      : 'Buho Jump - Bitcoin Wallet for Lightning & Nostr',
    short_name: 'Buho Jump',
    description: 'Your Bitcoin Lightning wallet and companion for Nostr apps, social identity, encrypted messaging and instant payments.',
    // `version` is intentionally omitted: WXT reads it from package.json, which
    // keeps a single source of truth for the release workflow to tag against.
    homepage_url: 'https://github.com/Buho-Ecosystem/Buho-Jump',
    icons: {
      16: 'favicon/favicon-16x16.png',
      48: 'logo/icon-48x48.png',
      96: 'logo/icon-96x96.png',
      128: 'logo/icon-128x128.png',
      256: 'logo/icon-256x256.png',
    },
    action: {
      default_title: 'Buho Jump',
      default_icon: {
        16: 'favicon/favicon-16x16.png',
        48: 'logo/icon-48x48.png',
        96: 'logo/icon-96x96.png',
        128: 'logo/icon-128x128.png',
      },
    },
    permissions: browser === 'firefox'
      ? ['storage', 'tabs', 'notifications', 'alarms']
      : ['storage', 'tabs', 'windows', 'notifications', 'alarms'],
    // The built-in eCash wallet must work immediately. Other user-selected
    // mints and LNbits servers are requested one origin at a time at runtime.
    host_permissions: [
      'https://mint.minibits.cash/*',
      'https://guardrail.branta.pro/*',
      'https://api.coingecko.com/*',
    ],
    // Requested per website only when the user confirms a LUD-04 Lightning
    // Login. This lets the background worker submit the signed callback while
    // keeping broad website access out of the default install permissions.
    optional_host_permissions: [
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    ...(browser === 'chrome' && {
      minimum_chrome_version: '110',
    }),
    web_accessible_resources: [
      {
        resources: ['nostr-provider.js', 'webln-provider.js', 'logo/icon-256x256.png'],
        matches: ['<all_urls>'],
      },
      {
        resources: ['nwc-callback.html'],
        matches: ['https://nutbits.drshift.dev/*'],
      },
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: '@buho-jump',
          // `data_collection_permissions` landed in Firefox 140 (desktop) and
          // 142 (Android). Older builds silently skip the data consent screen
          // that AMO requires, so we floor the install at those versions.
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: [
              'authenticationInfo',
              'financialAndPaymentInfo',
              'personalCommunications',
            ],
            optional: [],
          },
        },
        gecko_android: {
          strict_min_version: '142.0',
        },
      },
    }),
  }),
})
