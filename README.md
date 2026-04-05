<p align="center">
  <img src="public/logo/icon-256x256.png" width="80" alt="Buho Jump" />
</p>

<h1 align="center">Buho Jump</h1>

<p align="center">
  Your Bitcoin Lightning wallet and companion for Nostr apps —<br/>
  social identity, privat messaging, and instant payments in the browser.
</p>

<p align="center">
  <a href="https://github.com/Buho-Ecosystem/Buho-Jump/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
  <img src="https://img.shields.io/badge/platform-Chrome%20%C2%B7%20Firefox%20%C2%B7%20Brave%20%C2%B7%20Edge-blue" alt="Platforms" />
</p>

---

## What is Buho Jump?

Buho Jump is an open-source browser extension that brings **Nostr** and **Lightning** to every website. Manage your digital identity, chat with end-to-end encryption, and pay with Bitcoin — all from your browser toolbar.

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
- WebLN provider for in-browser payments
- Per-site spending budgets
- Fiat conversion (19 currencies)
- Shop online with Bitcoin in South Africa — works with [MoneyBadger-supported stores](https://www.moneybadger.co.za/stores) via SnapScan, Zapper, and Scan to Pay

**Messaging**
- Private 1:1 chats with end-to-end encryption (NIP-17)
- Group chats: private groups, relay communities (NIP-29), open channels (NIP-28)
- Zap friends directly from chat

**Security**
- All keys encrypted at rest (AES-256-GCM)
- No analytics, no telemetry, no tracking
- Session locks on browser close
- Fully open source

---

## Install

Get Buho Jump from your browser's extension store:

- [Chrome Web Store](#)
- [Firefox Add-ons](#)

Want to build from source? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Built with nostr-core

20 Nostr protocol implementations — all powered by [nostr-core](https://github.com/DoktorShift/nostr-core):

`NIP-02` `NIP-04` `NIP-05` `NIP-06` `NIP-07` `NIP-11` `NIP-17` `NIP-19` `NIP-24` `NIP-28` `NIP-29` `NIP-42` `NIP-44` `NIP-46` `NIP-47` `NIP-50` `NIP-51` `NIP-57` `NIP-59` `NIP-65`

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
  background.js        — Service worker: signing, wallet, permissions, relays
  content.js           — NIP-07 + WebLN bridge (page ↔ background)
  popup/               — Extension popup (Vue 3)
  options/             — Full-page settings (Vue 3)
  prompt/              — Permission approval window
components/
  chat/                — Chat, groups, contact picker
  wallet/              — Wallet home, send, receive, selector
  options/             — Settings pages
composables/           — Vue composables (useChat, useGroups, useWallet, etc.)
lib/                   — Core logic (accounts, crypto, relays, wallet, NIP-46)
locales/               — i18n translations (15 languages)
public/
  nostr-provider.js    — NIP-07 window.nostr injection
  webln-provider.js    — WebLN window.webln injection
```

</details>

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [Privacy Policy](PRIVACY_POLICY.md) | What data is stored and transmitted |
| [Security](SECURITY.md) | Encryption, responsible disclosure |
| [FAQ](FAQ.md) | Common questions answered |
| [Contributing](CONTRIBUTING.md) | How to help — code, translations, bug reports |
| [Store Listing](STORE_LISTING.md) | Chrome/Firefox store descriptions and permissions |

---

## License

[AGPL-3.0](LICENSE) — free and open source.
