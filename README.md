<p align="center">
  <img src="public/logo/icon-256x256.png" width="80" alt="Buho Jump" />
</p>

<h1 align="center">Buho Jump</h1>

<p align="center">
  Your Bitcoin Lightning wallet and companion for Nostr apps,<br/>
  social identity, private messaging, and instant payments in the browser.
</p>

<p align="center">
  <a href="https://github.com/Buho-Ecosystem/Buho-Jump/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
  <img src="https://img.shields.io/badge/platform-Chrome%20%C2%B7%20Firefox%20%C2%B7%20Brave%20%C2%B7%20Edge-blue" alt="Platforms" />
</p>

---

## What is Buho Jump?

Buho Jump is an open-source browser extension that brings **Nostr** and **Lightning** to every website. Manage your digital identity, chat with end-to-end encryption, and pay with Bitcoin - all from your browser toolbar.

> [!NOTE]
> Buho Jump is built by [DoktorShift](https://github.com/DoktorShift) and [Pratik227](https://github.com/Pratik227) as part of the [Buho Ecosystem](https://github.com/Buho-Ecosystem).

---

## Features

**Identity**
- Sign in to any Nostr app (NIP-07)
- Connect remote signers like Amber (NIP-46)
- Multiple accounts with easy switching
- Per-site permission control

**Wallet**
- NWC, Cashu, and LNbits - three wallet types, one-click switching
- NUTbits one-click wallet setup - connect a dedicated wallet instantly
- Send and receive Bitcoin Lightning payments
- Private eCash spending with encrypted backups, NIP-60 proof and receiving-key recovery, and recovery-word restoration
- Cashu payment requests: create them and pay incoming ones (NUT-18, NUT-26)
- Animated QR codes for large eCash tokens (NUT-16)
- Mint list restore from your recovery words (NUT-27)
- WebLN provider for in-browser payments
- Per-site spending budgets
- Fiat conversion (19 currencies)
- Shop online with Bitcoin in South Africa - works with [MoneyBadger-supported stores](https://www.moneybadger.co.za/stores) via SnapScan, Zapper, and Scan to Pay

**Messaging**
- Private 1:1 chats with end-to-end encryption (NIP-17)
- Zap friends directly from chat

**Security**
- All keys encrypted at rest (AES-256-GCM)
- No analytics, no telemetry, no tracking
- Session locks on browser close
- Fully open source

---

## Install

Buho Jump is in beta. Store listings (Chrome Web Store, Firefox Add-ons) are coming.

Until then, download a ready-to-load package from
[GitHub Releases](https://github.com/Buho-Ecosystem/Buho-Jump/releases) and follow
[TESTING.md](TESTING.md). No build required.

Found a bug? Open an [issue](https://github.com/Buho-Ecosystem/Buho-Jump/issues).
For security problems, see [SECURITY.md](SECURITY.md) instead.

---

## Build and Test

Requires Node.js 20+ and npm 10+.

```bash
npm ci               # install dependencies
npm run dev          # live-reload dev build (Chrome); npm run dev:firefox for Firefox
npm run build        # production build; npm run build:firefox for Firefox
npm test             # run the unit tests (Vitest)
```

Full developer setup lives in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Built with nostr-core

Nostr identity, signing, relay, messaging, wallet, and safety flows are powered by [nostr-core](https://github.com/DoktorShift/nostr-core). Important wallet protocols include `NIP-47` for NWC and `NIP-60` for encrypted Cashu wallet state on Nostr relays.

---

## Tech Stack

| Tool | Role |
|------|------|
| [WXT](https://wxt.dev) | Browser extension framework |
| [Vue 3](https://vuejs.org) | UI with Composition API |
| [Tailwind CSS v4](https://tailwindcss.com) | Styling via CSS custom properties |
| [nostr-core](https://github.com/DoktorShift/nostr-core) | Nostr protocol library |
| [Vite](https://vitejs.dev) | Build tool |

---

## Project Structure

<details>
<summary><strong>Show file tree</strong></summary>

```
entrypoints/
  background.js        - Service worker: signing, wallet, permissions, relays
  content.js           - NIP-07 + WebLN bridge (page ↔ background)
  popup/               - Extension popup (Vue 3)
  options/             - Full-page settings (Vue 3)
  prompt/              - Permission approval window
components/
  chat/                - Chat, contact picker
  wallet/              - Wallet home, send, receive, selector
  options/             - Settings pages
composables/           - Vue composables (useChat, useWallet, etc.)
lib/                   - Core logic (accounts, crypto, relays, wallet, NIP-46)
locales/               - i18n translations (17 languages)
public/
  nostr-provider.js    - NIP-07 window.nostr injection
  webln-provider.js    - WebLN window.webln injection
```

</details>

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [Testing](TESTING.md) | Load and try Buho Jump before it hits the stores (no build required) |
| [Privacy Policy](PRIVACY_POLICY.md) | What data is stored and transmitted |
| [Security](SECURITY.md) | Encryption, responsible disclosure |
| [FAQ](FAQ.md) | Common questions answered |
| [Contributing](CONTRIBUTING.md) | How to help - code, translations, bug reports |
| [Store Listing](STORE_LISTING.md) | Chrome/Firefox store descriptions and permissions |
| [Firefox Release](docs/FIREFOX_RELEASE.md) | How builds are cut in CI and submitted to AMO |

---

## License

[AGPL-3.0](LICENSE) - free and open source.
