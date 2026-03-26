# From nos2x to Buho Jump

## A practical migration guide for existing Nostr users

---

You've been using nos2x for a while. It works. It signs events. But you keep hearing about new NIPs, wallet integrations, and chat features that your extension just... doesn't do.

Here's how to move to Buho Jump without losing anything.

### Step 1: Export your key from nos2x

Open nos2x settings. Copy your nsec (starts with `nsec1`). If you only have the hex private key, that works too — Buho Jump accepts both formats.

**Important:** Do this in a private window or make sure no one's watching your screen. This is your identity.

### Step 2: Install Buho Jump

Grab it from the Chrome Web Store (or Firefox Add-ons, or load it as an unpacked extension if you're that kind of person).

On first launch, you'll set a master password. This encrypts everything in the extension. Pick something strong — there's no reset.

### Step 3: Import your key

Choose "I Already Have an Account" and paste your nsec. Buho Jump validates the format (shows an error if it's not a valid nsec or 64-char hex), encrypts it with your master password, and activates the account.

Your pubkey is the same. Your identity is the same. Every Nostr client will see you as the same user.

### Step 4: Disable nos2x

Both extensions inject `window.nostr`. They'll conflict. Disable nos2x in `chrome://extensions` — don't uninstall it yet, just in case. Once you've confirmed everything works in Buho Jump, you can remove it.

### What you gain

Here's the stuff you couldn't do before:

**A wallet.** Connect any NWC wallet and pay Lightning invoices directly from the extension. Auto-approve small payments with per-site budgets.

**Chat.** Send and receive encrypted DMs without leaving the extension. NIP-17 gift wraps for real privacy. Group messaging. Reactions. Replies.

**Better permissions.** nos2x is allow/deny. Buho Jump is per-method — a site can read your pubkey but not sign events. Or sign kind 1 notes but not kind 4 DMs. You decide.

**Fiat conversion.** See your balance in your local currency. 19 currencies supported.

**Multiple accounts.** Switch between identities with one tap. Each account has its own relay list, chat history, and permissions.

**Auto-lock.** Extension locks after inactivity. Shows a 30-second warning with a "stay unlocked" button.

**NIP-46 option.** If you want to stop storing your nsec in the browser entirely, connect a remote signer. Same features, key stays on your phone.

### What stays the same

- `window.nostr` API — same interface, same NIP-07 spec
- Your pubkey, npub, nprofile — all identical
- Relay list — configure in Buho Jump's settings, or publish via NIP-65
- Any Nostr client that worked with nos2x will work with Buho Jump

### The one thing to check

If you were using nos2x with a specific relay list, add those relays to Buho Jump's account relay pool. The extension ships with sensible defaults (damus, nos.lol, primal, etc.) but your custom relays won't carry over automatically.

Go to Settings → Relay Settings → Account Relays → add your relays.

### Timeline

The whole migration takes about 2 minutes. Most of that is deciding on a password.

---

*If you run into issues, the extension is fully open source at github.com/Buho-Ecosystem/Buho-Jump. File an issue or ask in the Nostr community.*
