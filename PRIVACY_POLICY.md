# Buho Jump — Privacy Policy

**Last updated:** March 2026

Buho Jump is an open-source browser extension for managing Nostr identities, Lightning payments, and encrypted messaging. We take your privacy seriously.

## What data is stored

All data is stored **locally on your device** using the browser's built-in extension storage. Nothing is stored on our servers — we don't operate any servers.

| Data | How it's stored | Purpose |
|------|----------------|---------|
| Nostr private keys | Encrypted with AES-256-GCM using your master password | Sign events on your behalf (NIP-07) |
| Wallet connection (NWC) | Encrypted with AES-256-GCM using your master password | Connect to your Lightning wallet |
| Chat messages | Stored locally per account | Display your message history |
| Site permissions | Stored locally | Remember which sites you've approved |
| Relay list | Stored locally | Connect to your preferred Nostr relays |
| Preferences | Stored locally | Theme, language, currency, notification settings |

## What data is transmitted

| Data | Where | Why |
|------|-------|-----|
| Signed Nostr events | Your configured Nostr relays (WebSocket) | Publishing posts, profile updates, messages |
| Encrypted messages | Your configured Nostr relays (WebSocket) | Sending and receiving end-to-end encrypted DMs (NIP-17, NIP-04) |
| Lightning payments | Your NWC wallet provider (WebSocket) | Sending and receiving Bitcoin payments |
| NIP-05 lookups | The domain in the NIP-05 address (HTTPS) | Verifying Nostr identities |
| Profile data | Your configured Nostr relays (WebSocket) | Fetching contact names and pictures |

## Encryption

- **Private keys** are encrypted at rest with AES-256-GCM, derived from your master password via PBKDF2 (100,000 iterations)
- **Wallet connections** are encrypted at rest with the same method
- **Direct messages** use end-to-end encryption (NIP-17 gift wraps with NIP-44 encryption)
- **Session data** (unlock state) uses `chrome.storage.session` which is in-memory only and cleared when the browser closes
- Your master password is never stored — only a verification hash is kept

## What we don't do

- We don't collect analytics or telemetry
- We don't track your browsing activity
- We don't sell or share any data with third parties
- We don't operate servers that receive your data
- We don't have access to your keys, passwords, or messages
- We don't inject ads or affiliate links

## Third-party services

Buho Jump connects to Nostr relays and Lightning wallet providers that **you choose**. We don't control these services. Your data is transmitted directly between your browser and these services — it never passes through us.

Default relays are preconfigured for convenience but can be changed in settings.

## Per-site permissions

When a website requests access to your Nostr identity (NIP-07) or Lightning wallet (WebLN), Buho Jump prompts you for permission. You control which sites can:
- Read your public key
- Request event signatures
- Send Lightning payments
- Encrypt or decrypt messages

Permissions are stored locally and can be revoked at any time.

## Open source

Buho Jump is fully open source under the AGPL-3.0-only license. You can audit the code at:
https://github.com/Buho-Ecosystem/Buho-Jump

## Children's privacy

Buho Jump is not directed at children under 13. We do not knowingly collect data from children.

## Changes to this policy

We may update this privacy policy. Changes will be posted in the GitHub repository and reflected in the extension's store listing.

## Contact

For privacy questions, open an issue at:
https://github.com/Buho-Ecosystem/Buho-Jump/issues
