# FAQ

## What is Buho Jump?

A browser extension that combines **Nostr identity**, **encrypted messaging**, and **Bitcoin Lightning payments** in one place. It works as a signer, chat client, and wallet — directly in your browser toolbar.

---

## What can it do?

- **Sign in** to Nostr apps (NIP-07)
- **Connect remote signers** like Amber (NIP-46)
- **Send and receive Bitcoin** via Lightning
- **Chat privately** with end-to-end encryption
- **Join group chats** — private groups, relay communities, and open channels
- **Manage multiple accounts** and wallets

---

## Which wallets are supported?

Buho Jump supports three wallet types:

| Type | How it connects |
|------|----------------|
| **NWC** | Any Nostr Wallet Connect compatible wallet (Alby Hub, Coinos, Minibits, etc.) |
| **Cashu** | Ecash wallet connected to a Cashu mint |
| **LNbits** | Direct connection to an LNbits instance |

You can add multiple wallets and switch between them.

---

## Can I shop online with Bitcoin?

Yes — if you're in South Africa, Buho Jump works with [MoneyBadger-supported online stores](https://www.moneybadger.co.za/stores). At checkout, the extension detects payment QR codes from SnapScan, Zapper, and Scan to Pay, converts them to Lightning payments, and lets you pay in Bitcoin from your connected wallet.

---

## What is a spending budget?

When a website requests a Lightning payment, Buho Jump asks for your approval. If you trust the site and don't want to be asked every time, you can set a **spending budget**.

A budget lets the site withdraw funds automatically — up to the limit you set. Once the budget runs out, payments go back to requiring your approval.

You can pause, adjust, or remove a budget at any time from the site detail view in the popup or the Connected Sites page in settings.

---

## Does it store my private key on a server?

No. Everything stays on your device. Private keys and wallet credentials are encrypted at rest with AES-256-GCM. If you prefer not to store keys in the browser at all, use NIP-46 remote signing with an app like Amber.

---

## Which browsers are supported?

Chrome, Brave, Edge, and other Chromium-based browsers. Firefox is also supported.

---

## Is it open source?

Yes - [AGPL-3.0](LICENSE). The full source code is at https://github.com/Buho-Ecosystem/Buho-Jump.

---

## Does it track me?

No analytics, no telemetry, no ads, no remote data collection. See the [Privacy Policy](PRIVACY_POLICY.md).

---

## Can I migrate from nos2x or another Nostr extension?

Yes. Import your existing `nsec` or hex private key, or switch to NIP-46 remote signing (NIP-46 lacks support of privacy features in Chat). Buho Jump adds wallet support, encrypted messaging, and more granular permissions.

---

## How does group chat work?

Buho Jump supports three types of group messaging:

- **Private groups** — invite-only, end-to-end encrypted
- **Relay communities** (NIP-29) — moderated groups hosted on a relay
- **Open channels** (NIP-28) — public chat rooms

---

## How do I report a bug?

Open an [issue on GitHub](https://github.com/Buho-Ecosystem/Buho-Jump/issues) with what you expected, what happened, and your browser name/version.

## How do I report a security issue?

See [SECURITY.md](SECURITY.md) — please don't open public issues for vulnerabilities.

## How can I help?

See [CONTRIBUTING.md](CONTRIBUTING.md) — code, translations, and bug reports are all welcome.
