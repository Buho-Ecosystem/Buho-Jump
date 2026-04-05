# Privacy Policy

**Last updated:** April 2026

Buho Jump is an open-source browser extension for Nostr identity, Lightning payments, and encrypted messaging. Your privacy is the whole point.

---

## The short version

- Everything is stored **locally on your device**
- Sensitive data is **encrypted at rest**
- We don't operate servers — your data never touches us
- No analytics, no telemetry, no tracking

---

## What is stored on your device

| Data | How it's stored | Why |
|------|----------------|-----|
| Nostr private keys | Encrypted (AES-256-GCM) | Sign events on your behalf |
| Wallet connections (NWC, Cashu, LNbits) | Encrypted (AES-256-GCM) | Connect to your wallet |
| Chat messages | Stored locally per account | Display your message history |
| Site permissions | Stored locally | Remember which sites you've approved |
| Relay list | Stored locally | Connect to your preferred Nostr relays |
| Preferences | Stored locally | Theme, language, currency, notifications |

---

## What is transmitted

When you use Buho Jump, data is sent **directly** from your browser to services **you choose**. It never passes through us.

| Data | Destination | Why |
|------|------------|-----|
| Signed Nostr events | Your Nostr relays | Publishing posts, profile updates, messages |
| Encrypted messages | Your Nostr relays | Sending and receiving DMs (NIP-17, NIP-04) |
| Lightning payments | Your NWC wallet provider | Sending and receiving Bitcoin |
| Cashu token operations | Your chosen Cashu mint | Minting, melting, and swapping ecash tokens |
| NIP-05 lookups | The domain in the address | Verifying Nostr identities |
| Profile data | Your Nostr relays | Fetching contact names and pictures |

---

## Encryption

- **Private keys** — AES-256-GCM, derived from your master password via PBKDF2 (100,000 iterations)
- **Wallet connections** — same method
- **Direct messages** — end-to-end encrypted (NIP-17 gift wraps with NIP-44 encryption)
- **Session data** — in-memory only (`chrome.storage.session`), cleared on browser close
- **Master password** — never stored, only a verification hash is kept

---

## What we don't do

- Collect analytics or telemetry
- Track your browsing
- Sell or share data with third parties
- Operate servers that receive your data
- Have access to your keys, passwords, or messages
- Inject ads or affiliate links

---

## Per-site permissions

When a website requests access to your identity or wallet, Buho Jump prompts you for approval. You control what each site can do, and you can revoke permissions at any time.

---

## Open source

Buho Jump is fully open source under [AGPL-3.0](LICENSE). Audit the code yourself:
https://github.com/Buho-Ecosystem/Buho-Jump

---

## Children's privacy

Buho Jump is not directed at children under 13. We do not knowingly collect data from children.

## Changes to this policy

Updates will be posted in the GitHub repository and reflected in the extension's store listing.

## Contact

For privacy questions, open an issue at https://github.com/Buho-Ecosystem/Buho-Jump/issues
