# Security

Buho Jump handles private keys and wallet credentials. We take that seriously.

---

## Reporting a vulnerability

> [!IMPORTANT]
> **Do not open a public issue for security vulnerabilities.**

Please report security issues privately:

1. Go to [GitHub Security Advisories](https://github.com/Buho-Ecosystem/Buho-Jump/security/advisories/new)
2. Describe the issue, steps to reproduce, and potential impact
3. We will respond within **7 days** and work with you on a fix

If you prefer email, reach out to the maintainers listed in the [README](README.md).

---

## How your data is protected

| What | How |
|------|-----|
| Private keys | Encrypted at rest with AES-256-GCM, key derived from your master password via PBKDF2 (100k iterations) |
| Wallet connections (NWC) | Encrypted at rest with the same method |
| Direct messages | End-to-end encrypted (NIP-17 gift wraps with NIP-44) |
| Session state | In-memory only (`chrome.storage.session`), cleared on browser close |
| Master password | Never stored — only a verification hash is kept |

---

## What is NOT stored or transmitted

- No analytics or telemetry
- No browsing history
- No data sent to our servers — we don't operate servers
- No remote code execution
- No third-party trackers or ad networks

---

## Architecture boundaries

- **Content script** bridges messages between web pages and the background service worker. It does not read or modify page content.
- **Permission prompts** appear in a separate browser window — web pages cannot interact with or dismiss them.
- **Web pages** never receive your private key. Signing happens in the background service worker and only the signed result is returned.

---

## Scope

This policy covers the Buho Jump browser extension. Third-party services you connect to (Nostr relays, wallet providers, Cashu mints) are outside our control.

---

Thank you for helping keep Buho Jump secure.
