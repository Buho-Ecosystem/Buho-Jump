# Privacy Policy

**Last updated:** August 2026

Buho Jump is an open-source browser extension for Nostr identity, Lightning payments, and encrypted messaging. Your privacy is the whole point.

---

## The short version

- Everything is stored **locally on your device**
- Sensitive data is **encrypted at rest**
- We don't operate servers - your data never touches us
- No analytics, no telemetry, no tracking

---

## What is stored on your device

| Data | How it's stored | Why |
|------|----------------|-----|
| Nostr private keys | Encrypted (AES-256-GCM) | Sign events on your behalf |
| Identity recovery words | Encrypted (AES-256-GCM) | Recreate NIP-06 accounts and LUD-05 website login keys |
| Wallet connections (NWC, Cashu, LNbits) | Encrypted (AES-256-GCM) | Connect to your wallet |
| Cashu proofs, recovery counters, and payment history | Encrypted (AES-256-GCM) | Show and safely recover your eCash balance |
| Pending Cashu invoice and payment recovery data | Encrypted (AES-256-GCM) | Claim incoming payments and resolve outgoing payments safely after an interruption |
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
| Encrypted Cashu wallet events | Your Nostr relays | Optional NIP-60 wallet backup and recovery |
| Encrypted merchant lookup | Branta Guardrail, when merchant verification is enabled | Show a verified merchant before a supported payment |
| Selected fiat currency | CoinGecko | Load a public Bitcoin exchange rate for local display |
| NIP-05 lookups | The domain in the address | Verifying Nostr identities |
| Profile data | Your Nostr relays | Fetching contact names and pictures |
| Derived public identity keys | Default Nostr relays, only when you start word recovery | Find used NIP-06 account paths; relays may correlate the checked public identities |
| LUD-04 signature and domain-specific public key | The website shown in the Lightning Login confirmation | Complete a user-approved Lightning Login request |

---

## Encryption

- **Private keys and identity recovery words** - AES-256-GCM, derived from your master password via PBKDF2-SHA256 (600,000 iterations)
- **Wallet connections** - same method
- **Direct messages** - end-to-end encrypted (NIP-17 gift wraps with NIP-44 encryption)
- **Session data** - in-memory only (`chrome.storage.session`), cleared on browser close, manual lock, or auto-lock expiry
- **Master password** - never stored, only a verification hash is kept

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

When a website requests access to your identity or wallet, Buho Jump prompts you for approval. The default approval lasts only for that capability in the requesting browser tab. Simultaneous requests for the same capability share one approval prompt, but Buho Jump still performs every requested cryptographic operation separately. Payment approvals are never grouped. You can choose permanent access under More options and revoke saved permissions at any time.

Lightning Login asks for temporary access to the exact HTTPS website shown in the confirmation. Access is requested at that moment, not at installation. Jump derives a separate LUD-05 public identity for each domain, so the website never receives your recovery words, Nostr private key, or identity used at another domain.

During recovery, Jump can check the first 20 NIP-06 public identities on default Nostr relays. This makes recovery easier, but a relay may infer that the checked public keys are related. The recovery screen discloses this before the check; entering a specific account number skips relay discovery.

Cashu is custodial. Your chosen mint processes eCash deposits, withdrawals, swaps, and proof-state checks. The mint can see requests made to it and can become unavailable. Jump asks for browser access to the exact custom mint you choose, keeps mint balances separate, and describes the built-in public mint as suitable only for small testing balances.

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
