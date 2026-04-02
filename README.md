# Buho Jump - Browser Extension

**Your Bitcoin Lightning wallet and companion for Nostr apps — social identity, encrypted messaging, and instant payments in the Browser.**

Buho Jump is an open-source browser extension that brings Nostr and Lightning to every website. Manage your digital identity, chat with end-to-end encryption, and pay with Bitcoin — all from your browser toolbar.

## Features

- **NIP-07 Signer** — Sign in to any Nostr web app seamlessly
- **NIP-46 Remote Signing** — Connect Amber or other signers via QR code
- **Lightning Wallet** — Send and receive Bitcoin via NWC (Nostr Wallet Connect)
- **WebLN Provider** — In-browser Lightning payments for compatible sites
- **Encrypted Chat** — Private 1:1 messages with NIP-17 end-to-end encryption
- **Group Chat** — Private groups, relay communities (NIP-29), and open channels (NIP-28)
- **Multi-Account** — Switch between local and remote signer accounts
- **Multi-Wallet** — Connect and switch between multiple NWC wallets
- **15 Languages** — English, German, French, Spanish, Japanese, Chinese, and more (Language Packs are not finished - we could need your help!)
- **Per-Site Permissions** — Fine-grained control over which sites access your identity and wallet

## Built with nostr-core

22 Nostr protocol implementations — all powered by [nostr-core](https://github.com/DoktorShift/nostr-core):

NIP-02, 04, 05, 06, 07, 11, 17, 19, 24, 28, 29, 42, 44, 46, 47, 50, 51, 57, 59, 65

## Tech Stack

- [WXT](https://wxt.dev) — Browser extension framework
- [Vue 3](https://vuejs.org) — Composition API with `<script setup>`
- [Tailwind CSS v4](https://tailwindcss.com) — Utility-first styling with CSS custom properties
- [nostr-core](https://github.com/DoktorShift/nostr-core) — Complete Nostr protocol library
- [Vite](https://vitejs.dev) — Build tool

## Install

### From Stores
- Chrome Web Store 
- Firefox Add-ons 

### From Source

**Requirements:** Node.js 20+, npm 10+

```bash
# Clone
git clone https://github.com/Buho-Ecosystem/Buho-Jump.git
cd Buho-Jump

# Install dependencies
npm ci

# Development (Chrome)
npm run dev

# Development (Firefox)
npm run dev:firefox

# Production build (Chrome)
npm run build

# Production build (Firefox)
npx wxt build --browser firefox
```

### Load in Browser

**Chrome:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `.output/chrome-mv3` folder

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in the `.output/firefox-mv2` folder

## Project Structure

```
entrypoints/
  background.js        — Service worker: signing, wallet, permissions, relays
  content.js           — NIP-07 + WebLN bridge (page ↔ background)
  popup/               — Extension popup (Vue 3)
  options/             — Full-page settings (Vue 3)
  prompt/              — Permission approval window
components/
  chat/                — Chat, groups, contact picker
  wallet/              — Wallet home, send, receive, selector
  options/             — Settings pages (sites, account, wallets, messaging)
  popup/               — Bottom tabs
composables/           — Vue composables (useChat, useGroups, useWallet, etc.)
lib/                   — Core logic (accounts, crypto, relays, wallet, NIP-46)
locales/               — i18n translations (15 languages)
public/
  nostr-provider.js    — NIP-07 window.nostr injection
  webln-provider.js    — WebLN window.webln injection
```

## Security

- All private keys encrypted at rest with AES-256-GCM (PBKDF2, 100k iterations)
- NWC wallet connections encrypted at rest
- Direct messages use NIP-17 end-to-end encryption (NIP-44 + NIP-59 gift wraps)
- Session unlocked during browser session, locks on browser close
- No analytics, no telemetry, no tracking
- No remote code execution

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## Authors

- [DoktorShift](https://github.com/DoktorShift)
- [Pratik227](https://github.com/Pratik227)

## License

[AGPL-3.0](LICENSE)
