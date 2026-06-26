# Why Another Nostr Extension?

## The honest answer

---

Fair question. nos2x exists. Alby exists. Why build another one?

Because none of them do everything.

nos2x is a signer. That's it. It signs events. No wallet, no chat, no permissions beyond allow/deny. It's a great tool for 2022. It's not enough for 2026.

We wanted something different. An extension that treats Nostr identity, Lightning payments, and encrypted messaging as equal first-class features. Not an identity tool that can sort of do payments. Not a wallet that can sort of sign events. The full stack.

### What "full stack" actually means

**Identity:** Local keys, mnemonic backup (NIP-06), or NIP-46 remote signing. Multi-account with one-tap switching. Profile publishing. NIP-05 verification display.

**Wallet:** Connect any NWC-compatible wallet - Alby, Buho, Coinos, LNbits, Mutiny, whatever. Or use the built-in Cashu wallet with zero setup. Multi-wallet support. Per-site spending budgets. Fiat conversion in 19 currencies.

**Chat:** NIP-17 encrypted DMs with gift wraps. NIP-04 + NIP-44 fallback. Reply, react, forward, delete. Content warnings. Expiring messages.

**Permissions:** Per-domain, per-method. A site can have `getPublicKey: allow` but `signEvent: ask every time` and `sendPayment: deny`. Budget allowances auto-approve payments up to a limit. Blocklist prevents injection on specific domains.

**WebLN:** Full `window.webln` provider. Any site that uses WebLN (tip buttons, paywalls, Lightning login) works out of the box with whatever wallet you've connected.

### The things we got right

**NIP-46 with QR codes.** No more asking users to copy bunker URIs. Generate a QR, scan it with your signer app or the LNbits Remote Signer, done.

**Chat that works.** Telegram-style bubbles, message status, reactions, reply threads, contact search. Account-scoped storage so switching accounts doesn't mix conversations.

**Fiat everywhere.** Balance, send flow, receive flow, transaction history - all toggle between sats and your local currency. Because not everyone thinks in satoshis yet.

**15 languages.** English, German, French, Spanish, Japanese, Czech, Danish, Finnish, Italian, Dutch, Norwegian, Portuguese, Russian, Swedish, Chinese. Because Nostr is global.

### Who it's for

If you use one Nostr client and one wallet and you're happy - keep doing that. This isn't for everyone.

It's for the person who wants their browser to be a first-class Nostr citizen. Who wants to sign into a Nostr app, pay a Lightning invoice, and send an encrypted message - all from the same extension, without switching between three tools.

It's open source. It's AGPL-3.0 licensed. It doesn't phone home. It doesn't have analytics. Your data stays encrypted on your device.

That's why we built another Nostr extension.

---

*Buho Jump is built by DoktorShift and Pratik227. Available for Chrome, Firefox, Edge, and Brave.*
