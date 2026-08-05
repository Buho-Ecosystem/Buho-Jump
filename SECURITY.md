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
| Private keys and identity words | Encrypted at rest with AES-256-GCM, using a PBKDF2-SHA256 key with 600,000 iterations |
| Wallet connections and Cashu wallet data | Encrypted at rest with the same versioned encryption envelope |
| Cashu recovery journals | Encrypted and kept until an interrupted proof update, incoming invoice, or outgoing payment is resolved |
| Direct messages | End-to-end encrypted (NIP-17 gift wraps with NIP-44) |
| Session state | In-memory only (`chrome.storage.session`), cleared on browser close |
| Master password | Never stored - only a verification hash is kept |

---

## What is NOT stored or transmitted

- No analytics or telemetry
- No browsing history
- No data sent to our servers - we don't operate servers
- No remote code execution
- No third-party trackers or ad networks

---

## Architecture boundaries

- **Content script** bridges messages between web pages and the background service worker. It does not read or modify page content.
- **Permission prompts** appear in a separate browser window - web pages cannot interact with or dismiss them.
- **Web pages** never receive your private key. Signing happens in the background service worker and only the signed result is returned.
- **Cashu proofs** stay separated by mint. Backup proofs are checked with their mint and rotated before storage.
- **Cashu payments** save exact change outputs before proofs can be consumed. An uncertain result stays pending until the mint confirms it.
- **Cashu invoices** are saved before they are shown. A paid invoice can be claimed after the popup or browser closes.
- **Cashu network calls** have a 15 second request timeout. Mints with NUT-19 support can safely retry the same critical request, while encrypted journals protect unresolved operations across restarts.
- **Cashu relay recovery** restores the NIP-60 private receiving key only into an empty local eCash wallet, preventing a silent key replacement.
- **Cashu payment requests** are validated before any money moves: the amount, unit, mint list, and delivery target must all check out first. If delivery fails after the eCash was prepared, the token is handed back to the user instead of being lost.
- **Incoming request payments** are redeemed automatically only when they come from a mint this wallet already uses. A payment from a new mint is shown to the user first and touches the network only after explicit approval.
- **Mint list backup (NUT-27)** is encrypted with a key derived from the recovery words before it reaches any relay. Restored mint URLs must pass HTTPS validation and are offered to the user, never added silently.
- **Auto-lock** is checked by the background security gate, including when the popup is closed. Expiry clears signing, wallet, relay, and temporary permission state.
- **Password changes** rotate every Cashu vault and recovery journal, then recreate cached wallet clients with the new password.
- **Custom services** receive exact browser-origin access only after the user confirms the connection.

---

## Scope

This policy covers the Buho Jump browser extension. Third-party services you connect to (Nostr relays, wallet providers, Cashu mints) are outside our control.

---

Thank you for helping keep Buho Jump secure.
