# Your Keys, Your Rules

## What happens to your secrets inside Buho Jump

---

You paste your nsec into a browser extension. What happens next?

In most extensions: it gets stored. Maybe encrypted, maybe not. You hope for the best.

Here's what Buho Jump does.

**Step 1:** Your password goes through PBKDF2 with 100,000 iterations and a random salt. This derives an AES-256-GCM encryption key. Not your password — a key derived from your password. The difference matters.

**Step 2:** Your nsec (or any secret — wallet URIs too) is encrypted with that key. A random IV is generated for each encryption. The output is `salt + IV + ciphertext`, base64-encoded. Even if two accounts have the same password, their encrypted blobs look completely different.

**Step 3:** The encrypted blob goes into `chrome.storage.local`. Your password exists only in memory, in the service worker. When the extension locks (manually, on timeout, or when you close the browser), the password is wiped. The secrets become inaccessible until you unlock again.

### What an attacker gets

If someone steals your `chrome.storage.local` data, they get:
- Encrypted blobs that require your password + PBKDF2 + AES-256-GCM to decrypt
- Your public key and account metadata (display name, relay list — public info anyway)
- Encrypted wallet connection URIs
- Chat messages (encrypted separately by Nostr protocols)

Without your password, the secrets are noise.

### What we don't store

- Your password (never persisted to disk — session memory only)
- Plaintext nsec (encrypted immediately on import)
- Any analytics, telemetry, or tracking data
- Nothing leaves your device. Ever.

### The NIP-46 option

Don't want any secrets in the browser at all? Use NIP-46 remote signing. Your nsec stays on your phone or your dedicated LNbits Remote Signer. The extension holds a client keypair that can't do anything without your signer device approval.

Three layers. Pick your comfort level.

---

*AES-256-GCM. PBKDF2 100k. Zero telemetry. That's the baseline, not a feature.*
