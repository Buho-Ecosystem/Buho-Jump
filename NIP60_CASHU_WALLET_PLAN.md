# NIP-60 Cashu Wallet — Default Wallet for New Users

> **Goal:** When a new user creates an account, they get a working wallet instantly — no NWC setup, no external apps, no jargon. Just a balance (0 sats) and a receive button. The wallet works with Cashu ecash under the hood but the user never needs to know that.

> **Principle:** The user does not care about protocols. They care about: _Can I receive money? Can I send money? Is my money safe?_

---

## Table of Contents

1. [Why This Matters](#1-why-this-matters)
2. [User Journey (Before vs After)](#2-user-journey)
3. [Architecture Overview](#3-architecture-overview)
4. [What We Already Have](#4-what-we-already-have)
5. [Implementation Phases](#5-implementation-phases)
6. [Phase 1: Core Wallet Engine](#phase-1-core-wallet-engine)
7. [Phase 2: UI — Wallet Home](#phase-2-ui--wallet-home)
8. [Phase 3: Send & Receive Flows](#phase-3-send--receive-flows)
9. [Phase 4: Backup System](#phase-4-backup-system)
10. [Phase 5: Lightning Bridge](#phase-5-lightning-bridge)
11. [Phase 6: NWC Coexistence](#phase-6-nwc-coexistence)
12. [Error Handling Matrix](#7-error-handling-matrix)
13. [Backup UX Deep Dive](#8-backup-ux-deep-dive)
14. [Security Model](#9-security-model)
15. [Migration & Rollout](#10-migration--rollout)
16. [Risks & Mitigations](#11-risks--mitigations)

---

## 1. Why This Matters

**Current state:** User creates account → sees "No Wallet Connected" → must find an NWC-compatible wallet → figure out connection strings → paste URI → then they can use the wallet tab.

**Drop-off point:** 95%+ of new users will never connect a wallet. They'll see the empty state, not understand what NWC is, and either ignore the wallet tab or uninstall.

**After this change:** User creates account → wallet tab shows "0 sats" with a receive button → they can receive ecash or Lightning immediately → they have a working wallet from second one.

**This is the single highest-impact UX change possible.** It turns Buho Jump from "a signing extension that also has a wallet if you configure it" into "a wallet that also does Nostr signing."

---

## 2. User Journey

### Before (Current)

```
Create Account → Wallet Tab → "No Wallet Connected"
                                    ↓
                              "Connect Wallet" button
                                    ↓
                              Paste NWC URI (???)
                                    ↓
                              User has no idea what NWC is
                                    ↓
                              Abandons wallet tab forever
```

### After (With NIP-60)

```
Create Account → Wallet Tab → "0 sats" balance shown
                                    ↓
                              "Receive" button visible
                                    ↓
                              User receives sats via Lightning or ecash
                                    ↓
                              Balance updates, user is hooked
                                    ↓
                              (Optional) Connect NWC wallet for more features
```

### After — Returning User

```
Open Extension → Unlock → Wallet shows balance (loaded from relay)
                              ↓
                         If relay data is stale → local cache shows last known balance
                              ↓
                         Background syncs token events from relays
```

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    POPUP UI                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WalletHome  │  │  SendFlow    │  │  ReceiveFlow  │  │
│  │ (balance,   │  │  (ecash or   │  │  (Lightning   │  │
│  │  history)   │  │   Lightning) │  │   invoice or  │  │
│  │             │  │              │  │   ecash token) │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│         └────────────────┼───────────────────┘          │
│                          │                              │
│                   useWallet() composable                │
│              (unified API — NWC or Cashu)               │
└──────────────────────────┬──────────────────────────────┘
                           │ chrome.runtime.sendMessage
┌──────────────────────────┼──────────────────────────────┐
│                   BACKGROUND.JS                         │
│                          │                              │
│         ┌────────────────┼────────────────┐             │
│         ▼                ▼                ▼             │
│   ┌──────────┐   ┌─────────────┐   ┌──────────┐       │
│   │ NWC      │   │ Cashu       │   │ Hybrid   │       │
│   │ Engine   │   │ Engine      │   │ Router   │       │
│   │ (exists) │   │ (new)       │   │ (new)    │       │
│   └──────────┘   └──────┬──────┘   └──────────┘       │
│                          │                              │
│              ┌───────────┼───────────┐                  │
│              ▼           ▼           ▼                  │
│        ┌─────────┐ ┌─────────┐ ┌──────────┐           │
│        │ nostr-  │ │ @cashu/ │ │ Relay    │           │
│        │ core    │ │ cashu-ts│ │ Pool     │           │
│        │ nip60   │ │ (mint)  │ │ (sync)   │           │
│        └─────────┘ └─────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        ┌──────────┐ ┌──────────┐    ┌──────────┐
        │ Cashu    │ │ Nostr    │    │ Local    │
        │ Mint     │ │ Relays   │    │ Storage  │
        │ (HTTP)   │ │ (events) │    │ (cache)  │
        └──────────┘ └──────────┘    └──────────┘
```

**Key principle:** The `useWallet()` composable presents a **unified API**. The UI never knows or cares whether the backend is NWC or Cashu. The background routes to the right engine.

---

## 4. What We Already Have

### In nostr-core (`src/nip60.ts`) — Ready to use

| Function | Purpose | Status |
|----------|---------|--------|
| `createWalletEvent()` | Create kind 17375 wallet metadata | Ready |
| `parseWalletEvent()` | Decrypt wallet from relay | Ready |
| `createTokenEvent()` | Store unspent proofs (kind 7375) | Ready |
| `parseTokenEvent()` | Decrypt token proofs from relay | Ready |
| `createHistoryEvent()` | Record transactions (kind 7376) | Ready |
| `parseHistoryEvent()` | Read transaction history | Ready |
| `createQuoteEvent()` | Track pending Lightning quotes (kind 7374) | Ready |
| `createTokenDeleteEvent()` | Delete spent tokens (kind 5) | Ready |
| `getWalletFilters()` | Relay query filters | Ready |
| `getProofsBalance()` | Sum proof amounts | Ready |

### In the extension — Needs modification

| Component | Current | Change Needed |
|-----------|---------|---------------|
| `lib/wallet.js` | NWC-only storage | Add `walletType: 'nwc' \| 'cashu'` field |
| `background.js` | NWC-only handlers | Add Cashu engine + routing |
| `WalletHome.vue` | NWC balance/txs | Works as-is if API is unified |
| `NoWalletHome.vue` | "Connect NWC" CTA | Replaced — wallet always exists |
| `SendFlow.vue` | NWC pay_invoice | Add Cashu send path |
| `ReceiveFlow.vue` | NWC make_invoice | Add Cashu receive path |
| Options page | No backup section | Add Cashu backup section |

### Not yet available — Must add

| Dependency | Purpose | Source |
|------------|---------|--------|
| `@cashu/cashu-ts` | Mint API client (mint, melt, swap) | npm package |
| `lib/cashu-engine.js` | Proof management, spend/receive logic | New file |
| `lib/cashu-sync.js` | Relay sync for token events | New file |
| `lib/cashu-backup.js` | Export/import token backup | New file |

---

## 5. Implementation Phases

```
Phase 1: Core Engine          ████████░░  (foundation — no UI yet)
Phase 2: Wallet Home UI       ██████░░░░  (balance, history — visible)
Phase 3: Send & Receive       ████████░░  (functional wallet)
Phase 4: Backup System        ██████████  (safety net — critical)
Phase 5: Lightning Bridge     ████████░░  (melt/mint — Lightning ↔ ecash)
Phase 6: NWC Coexistence      ████░░░░░░  (power users keep NWC option)
```

**The user sees value at the end of Phase 2.** Phases 1–2 are the MVP.

---

## Phase 1: Core Wallet Engine

> New file: `lib/cashu-engine.js`
> New file: `lib/cashu-sync.js`
> Modified: `lib/wallet.js`, `entrypoints/background.js`

### 1.1 Wallet Storage Schema Change

```js
// lib/wallet.js — new shape
{
  wallets: [
    // NWC wallet (existing)
    { id, name, type: 'nwc', connectionUri, createdAt },
    // Cashu wallet (new)
    { id, name, type: 'cashu', mintUrl, createdAt },
  ],
  activeWalletId: "<id>" | null,
  // Cashu-specific (encrypted alongside wallets)
  cashuState: {
    walletPrivkey: "<hex>",      // NIP-60 wallet-exclusive privkey
    proofs: {                     // Local proof cache (source of truth until relay sync)
      "<mintUrl>": [
        { id, amount, secret, C }
      ]
    },
    pendingQuotes: [],            // In-flight mint/melt quotes
    lastSyncTimestamp: 0,         // Last relay sync time
  }
}
```

### 1.2 Auto-Create on Account Creation

When a new account is created (any mode), automatically:

1. Generate a Cashu wallet-exclusive private key (`randomBytes(32)`)
2. Select a default mint (hardcoded list, configurable later)
3. Create the wallet entry with `type: 'cashu'`
4. Set it as active wallet
5. Publish kind 17375 wallet event to relays (non-blocking, retry in background)

```js
// In background.js, after account creation succeeds:
async function initCashuWallet(password, accountSecretKey) {
  const walletPrivkey = bytesToHex(randomBytes(32))
  const defaultMint = 'https://mint.minibits.cash'

  // Store locally
  const walletId = await addCashuWallet(defaultMint, 'My Wallet', password)

  // Publish wallet event to relays (fire-and-forget with retry)
  const walletEvent = nip60.createWalletEvent(
    { privkey: walletPrivkey, mints: [defaultMint] },
    accountSecretKey
  )
  publishToRelays(walletEvent).catch(err =>
    log.warn('cashu', 'WALLET_PUBLISH_FAILED', { err: err?.message })
  )

  return walletId
}
```

**User sees:** Nothing extra. Account creation flow is identical. Wallet is silently ready.

### 1.3 Cashu Engine — Proof Management

```js
// lib/cashu-engine.js — core operations

/** Get total balance from local proof cache. */
export function getBalance(proofs)

/** Receive ecash token (from paste, QR, or P2P). */
export async function receiveToken(encodedToken, mintUrl)

/** Spend proofs — select optimal proof combination, swap with mint. */
export async function spend(mintUrl, amountSats, proofs)

/** Mint new proofs from Lightning payment (receive via invoice). */
export async function mintFromQuote(mintUrl, quoteId)

/** Melt proofs to pay Lightning invoice. */
export async function meltToInvoice(mintUrl, invoice, proofs)

/** Check proof validity with mint (are they spent?). */
export async function checkProofState(mintUrl, proofs)
```

### 1.4 Relay Sync

```js
// lib/cashu-sync.js

/** Sync local proof cache with relay state. */
export async function syncFromRelays(pubkey, secretKey, pool, relays)

/** Publish current proof state to relays. */
export async function syncToRelays(proofs, secretKey, pool, relays)
```

**Sync strategy:**
- On unlock → load from local cache first (instant), then sync from relays (background)
- On receive/spend → update local cache immediately, publish to relays async
- Conflict resolution → relay state wins (proofs might be spent from another client)
- Stale data → show local balance immediately, update when relay responds

### 1.5 Background Message Handlers

New handlers in `background.js`:

```
CASHU_GET_BALANCE      → sum local proofs
CASHU_RECEIVE_TOKEN    → validate + store proofs
CASHU_SPEND            → swap proofs at mint, return change
CASHU_MINT_QUOTE       → request Lightning invoice from mint (receive flow)
CASHU_MINT_TOKENS      → exchange paid invoice for proofs
CASHU_MELT_QUOTE       → get cost to pay Lightning invoice
CASHU_MELT_TOKENS      → pay invoice, burn proofs
CASHU_CHECK_PROOFS     → verify proof validity
CASHU_GET_HISTORY      → return local transaction log
CASHU_SYNC             → manual relay sync trigger
```

### 1.6 Wallet Router

```js
// In background.js — route to correct engine
async function routeWalletOp(operation, params) {
  const wallet = await getActiveWallet(_cachedPassword)
  if (!wallet) throw new Error('NO_WALLET')

  if (wallet.type === 'cashu') {
    return cashuEngine[operation](params)
  } else {
    return nwcEngine[operation](params)  // existing NWC path
  }
}
```

---

## Phase 2: UI — Wallet Home

> Modified: `WalletHome.vue`, `NoWalletHome.vue` (deprecated)
> The wallet tab always shows a balance — never the empty state.

### 2.1 Kill the Empty State

`NoWalletHome.vue` is **never shown** for Cashu wallets. Since every new account gets a Cashu wallet, the "No Wallet Connected" screen only appears if the user explicitly disconnects all wallets (edge case).

### 2.2 WalletHome — Unified Display

The existing `WalletHome.vue` already shows:
- Balance (number)
- Send / Receive buttons
- Transaction history
- Refresh button

**No changes needed to the template.** The `useWallet()` composable already abstracts the balance/send/receive/history API. We just need the background handlers to return the same shape.

### 2.3 Wallet Type Indicator

Small, non-intrusive indicator on the balance card:

```
┌──────────────────────────────┐
│          0 sats              │  ← balance
│        ≈ $0.00               │  ← fiat conversion
│                              │
│  ⚡ Lightning-ready           │  ← subtle indicator
│                              │
│  [↑ Send]      [↓ Receive]  │
└──────────────────────────────┘
```

- **Cashu wallet:** "⚡ Lightning-ready" (no jargon)
- **NWC wallet:** Shows wallet name (existing behavior)
- **No wallet:** (shouldn't happen, but) "Connect a wallet"

### 2.4 Transaction History — Cashu Format

Map Cashu history events to the existing `TransactionItem` format:

```js
// Cashu history → TransactionItem shape
{
  type: history.direction === 'in' ? 'incoming' : 'outgoing',
  amount: parseInt(history.amount) * 1000,  // sats → msats for existing display
  created_at: event.created_at,
  description: direction === 'in' ? 'Received ecash' : 'Sent ecash',
  // No payment_hash for ecash — use event ID as fallback
}
```

---

## Phase 3: Send & Receive Flows

### 3.1 Receive Flow

**User taps "Receive" →** Two paths, both invisible to user:

#### Path A: Lightning Invoice (Default)
1. Extension requests mint quote from Cashu mint
2. Mint returns a Lightning invoice + quote ID
3. Extension shows QR code + copy button (same UI as current)
4. User shares invoice, payer pays via Lightning
5. Extension polls mint for quote status
6. When paid → mint issues proofs → extension stores them
7. Balance updates, toast: "Received X sats"

**This is identical to the current NWC receive flow from the user's perspective.**

#### Path B: Ecash Token (Paste/Scan)
1. User pastes or scans a `cashuA...` token string
2. Extension validates token, checks mint
3. Proofs are received (swapped at mint for fresh proofs)
4. Balance updates

**UI addition:** Small "Paste ecash" link below the Lightning QR.

### 3.2 Send Flow

**User taps "Send" →** Existing `SendFlow.vue` handles detection:

| Input | Detection | Engine |
|-------|-----------|--------|
| Lightning invoice (`lnbc...`) | `detectPaymentInput()` already works | Cashu melt (pay invoice via mint) |
| Lightning address (`user@domain`) | Already detected | LNURL → get invoice → Cashu melt |
| Cashu token (`cashuA...`) | New detection | Cashu send (create token) |
| Nostr pubkey / npub | Already detected | Cashu token via NIP-17 DM |
| SA Merchant QR | Already detected | LNURL → Cashu melt |

**All existing send detection works.** The only change is the backend: instead of NWC `pay_invoice`, the Cashu engine melts proofs at the mint.

### 3.3 Send Confirmation

Same confirmation dialog as NWC. User sees:
```
Pay 1,000 sats to lnbc...?
Wallet balance: 5,000 sats
[Cancel]  [Confirm]
```

No mention of ecash, proofs, or mints. Just sats.

### 3.4 Insufficient Balance

```
┌──────────────────────────────┐
│  ⚠️ Not enough balance        │
│                              │
│  You need 1,000 sats         │
│  Current balance: 500 sats   │
│                              │
│  [Top up wallet]  [Cancel]   │
└──────────────────────────────┘
```

"Top up wallet" → opens Receive flow.

---

## Phase 4: Backup System

> **This is the most critical phase for enterprise safety.** Ecash proofs are bearer tokens — if lost, the money is gone. The backup must be bulletproof and idiot-proof.

### 4.1 Backup Locations

| Location | When Shown | Format |
|----------|-----------|--------|
| Extension popup | Settings dropdown → "Backup Wallet" | One-tap export |
| Options page (full tab) | Sidebar → "Wallet Backup" section | Full backup management |
| Automatic relay backup | Every transaction | NIP-60 events (encrypted) |

### 4.2 Automatic Relay Backup (Zero Effort)

**This is the primary backup.** The user does nothing.

- Every proof change → publish kind 7375 token events to relays
- Wallet metadata → kind 17375 (replaceable, always current)
- All encrypted with NIP-44 to self — only the user's key can read them

**Recovery:** On new device, import account (nsec/mnemonic) → extension fetches wallet events from relays → proofs restored automatically.

**User never knows this happens.** It's silent, automatic, and tied to their Nostr identity.

### 4.3 Manual Backup — "Save Wallet Backup"

For users who want a local copy (or if relays go down):

#### In Extension Popup

```
Settings dropdown:
  ┌──────────────────────┐
  │ 🌙 Dark mode         │
  │ 🎨 Theme             │
  │ 🌐 Language          │
  │ ─────────────────── │
  │ 💾 Save wallet backup │  ← NEW
  │ ⚙️ Full settings      │
  └──────────────────────┘
```

**Tap "Save wallet backup" →**

```
┌──────────────────────────────┐
│  💾 Wallet Backup             │
│                              │
│  Your wallet has 5,000 sats. │
│  Save a backup file to       │
│  protect your funds.         │
│                              │
│  [Download Backup File]      │
│                              │
│  ✓ Auto-backup is active     │
│    (synced to your relays)   │
└──────────────────────────────┘
```

**"Download Backup File" →** Downloads a `.json` file:

```json
{
  "version": 1,
  "type": "buho-cashu-backup",
  "created_at": "2026-03-25T12:00:00Z",
  "mints": ["https://mint.minibits.cash"],
  "tokens": [
    "cashuAeyJ0b2tlb..."
  ]
}
```

The file contains standard Cashu V4 token strings. These can be:
- Restored in Buho Jump (import backup)
- Redeemed in **any** Cashu wallet (Minibits, Nutstash, eNuts, etc.)
- Pasted into a Cashu-compatible app as a last resort

**The backup format is interoperable, not proprietary.**

#### In Options Page (Full Tab)

```
Sidebar: Wallet Backup

┌──────────────────────────────────────────────────┐
│  Wallet Backup                                    │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  ✅ Auto-Backup Active                      │  │
│  │  Your wallet is synced to your Nostr relays │  │
│  │  Last sync: 2 minutes ago                   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Manual Backup                                   │
│  ─────────────                                   │
│  Save a backup file to your device. This file    │
│  contains your wallet tokens and can be used to  │
│  restore your funds in any Cashu wallet app.     │
│                                                  │
│  Balance: 5,000 sats                             │
│  Mints: mint.minibits.cash                       │
│                                                  │
│  [💾 Download Backup File]                        │
│                                                  │
│  Restore from Backup                             │
│  ──────────────────                              │
│  Import a previously saved backup file.          │
│                                                  │
│  [📂 Import Backup File]                          │
│                                                  │
│  ⚠️ Importing a backup will merge tokens with     │
│  your current wallet. Duplicate tokens are       │
│  automatically detected.                         │
└──────────────────────────────────────────────────┘
```

### 4.4 Backup Nudges (Non-Blocking)

The extension gently reminds users to backup without ever blocking them:

| Trigger | Nudge | Dismissable? |
|---------|-------|-------------|
| Balance > 1,000 sats for first time | Toast: "Nice! Your wallet has over 1,000 sats. Consider saving a backup." + [Backup Now] button | Yes, once |
| Balance > 10,000 sats | Info banner on WalletHome: "You have a significant balance. Backup recommended." | Yes, stays dismissed |
| 30 days since last manual backup | Subtle dot indicator on settings icon | Yes |
| Never backed up + balance > 0 | One-time nudge on options page | Yes |

**Rules:**
- Nudges are **never modal** (no popups, no blocking dialogs)
- Each nudge can be dismissed **permanently** (stored in chrome.storage)
- Auto-backup to relays is always active — nudges are for manual backup only
- Nudges reference "backup" not "ecash" or "proofs" or "tokens"

### 4.5 Disaster Recovery Flows

| Scenario | Recovery Path | User Effort |
|----------|--------------|-------------|
| Extension reinstalled, same browser | Unlock → auto-restore from relay | Zero — automatic |
| New device, has mnemonic/nsec | Import account → auto-restore from relay | Just import key |
| New device, has backup file | Import account → import backup file | Import key + file |
| Relays lost data, has backup file | Import backup file → re-publish to relays | One button |
| Lost everything, no backup | Funds are lost (bearer token reality) | N/A |
| Mint goes offline permanently | Proofs unspendable until mint returns | Wait or claim via mint recovery |

---

## Phase 5: Lightning Bridge

> This makes the Cashu wallet fully Lightning-compatible. Users can pay any Lightning invoice and receive from any Lightning wallet.

### 5.1 Receive via Lightning (Mint)

```
User taps "Receive" → Extension asks mint for a Lightning invoice
→ Shows QR code → Someone pays → Mint issues proofs → Balance updates
```

**Implementation:**
1. `CashuMint.createMintQuote(amount)` → returns `{ quote, request (bolt11) }`
2. Show bolt11 as QR + copy
3. Poll `CashuMint.checkMintQuote(quote)` every 3s
4. When `state === 'PAID'` → `CashuMint.mintProofs(quote, blindedMessages)` → store proofs
5. Publish kind 7374 quote event while in-flight (track pending)
6. Delete quote event when complete

### 5.2 Send via Lightning (Melt)

```
User pastes Lightning invoice → Extension asks mint to pay it
→ Proofs burned → Invoice paid → Recipient gets sats
```

**Implementation:**
1. `CashuMint.createMeltQuote(bolt11)` → returns `{ quote, amount, fee_reserve }`
2. Show confirmation: "Pay X sats + Y sats fee?"
3. Select proofs ≥ amount + fee
4. `CashuMint.meltProofs(quote, proofs)` → returns `{ paid, change }`
5. Store change proofs, delete spent proofs
6. Publish history event

### 5.3 Fee Display

```
┌──────────────────────────────┐
│  Pay 1,000 sats              │
│  + 2 sats network fee        │
│  ─────────────────────       │
│  Total: 1,002 sats           │
│                              │
│  [Cancel]     [Confirm]      │
└──────────────────────────────┘
```

Fees are shown transparently. No hidden costs. The "network fee" label avoids jargon — it's not called "melt fee" or "Lightning routing fee."

---

## Phase 6: NWC Coexistence

### 6.1 Wallet Switcher

Users can have both Cashu and NWC wallets. The existing wallet switcher works:

```
Wallet selector dropdown:
  ┌──────────────────────┐
  │ ✅ My Wallet (Cashu)  │  ← default, auto-created
  │    5,000 sats         │
  ├──────────────────────┤
  │    Alby (NWC)         │  ← user-added
  │    Connected          │
  ├──────────────────────┤
  │  + Connect NWC wallet │
  └──────────────────────┘
```

### 6.2 "Connect NWC Wallet" Moves to Advanced

The NWC connection flow moves from the default empty state to:
- Wallet settings (gear icon on WalletHome)
- Options page → Wallet section
- Settings dropdown → "Add wallet"

It's still **one tap away** but not the first thing a new user sees.

### 6.3 WebLN Routing

When a website calls `webln.sendPayment(invoice)`:
1. Check active wallet type
2. **Cashu:** melt proofs at mint to pay invoice
3. **NWC:** existing flow (pay via NWC relay)

Same for `webln.makeInvoice()`:
1. **Cashu:** create mint quote, return bolt11
2. **NWC:** existing flow

**The website never knows the difference.** WebLN API is identical.

---

## 7. Error Handling Matrix

Every error a user can encounter, and how to handle it:

| Error | User Sees | Recovery | Technical |
|-------|-----------|----------|-----------|
| Mint unreachable | "Wallet is temporarily offline. Your balance is safe." | Auto-retry every 30s, show last known balance from cache | `fetch()` timeout → fall back to cache |
| Proofs already spent | "Some funds were spent from another device. Syncing..." | Auto-sync from relays, update local cache | `checkProofState()` → remove spent → sync |
| Insufficient proofs for send | "Not enough balance. You need X sats, you have Y." | Show "Top up" button → receive flow | Balance check before spend attempt |
| Mint returns error on melt | "Payment failed. Your funds are still in your wallet." | Proofs not burned on failure — no loss | Melt is atomic: fail → proofs returned |
| Lightning invoice expired | "This invoice has expired. Ask for a new one." | User gets new invoice from recipient | Check bolt11 expiry before attempting melt |
| Relay sync failed | (Silent — user never sees this) | Retry with exponential backoff | Background sync, local cache is source of truth |
| Backup file corrupted | "This backup file couldn't be read. Make sure it's a valid Buho wallet backup." | Try again with different file | JSON parse + schema validation |
| Token already redeemed | "These tokens have already been used." | No action needed — balance correct | Mint returns "already spent" on receive |
| Mint quote expired | "This receive request expired. Tap Receive to create a new one." | New receive flow | Quote timeout (typically 10 minutes) |
| Account switch mid-transaction | Transaction is cancelled cleanly | User retries after switch | Atomic state: no partial spends |
| Extension crashes during send | Proofs are safe in local cache + relay backup | Restart extension, balance intact | Token events aren't deleted until spend confirmed |
| Storage quota exceeded | "Storage is full. Please free up browser data." | Clear old history, compact proofs | `chrome.storage.local` quota management |

**Key principle: No error can lose funds.** The worst case is "temporarily can't send" — never "money disappeared."

---

## 8. Backup UX Deep Dive

### 8.1 Language — Zero Jargon

| Technical Term | User-Facing Term |
|---------------|-----------------|
| Cashu proofs | "wallet funds" or "your sats" |
| Ecash tokens | "wallet backup" |
| Mint | "payment server" (or never mentioned) |
| NIP-60 | Never mentioned |
| Relay sync | "cloud backup" or "auto-backup" |
| Token event | Never mentioned |
| Melt | "pay" or "send" |
| Mint (verb) | "receive" |

### 8.2 Backup File Naming

```
buho-wallet-backup-2026-03-25.json
```

Not: `nip60-cashu-proofs-export.json`

### 8.3 Restore Flow

```
Options Page → Wallet Backup → Import Backup File

┌──────────────────────────────────────────────────┐
│  Import Wallet Backup                             │
│                                                  │
│  [  Drop file here or click to browse  ]         │
│                                                  │
│  Supported: .json backup files from Buho Jump    │
│  or Cashu token strings from any wallet app.     │
└──────────────────────────────────────────────────┘

After file selected:
┌──────────────────────────────────────────────────┐
│  ✅ Backup file valid                              │
│                                                  │
│  Found: 5,000 sats across 3 tokens               │
│  Mint: mint.minibits.cash                         │
│                                                  │
│  This will merge with your current wallet.       │
│  Duplicate tokens are skipped automatically.     │
│                                                  │
│  [Cancel]          [Import 5,000 sats]           │
└──────────────────────────────────────────────────┘

After import:
┌──────────────────────────────────────────────────┐
│  ✅ Import complete                                │
│                                                  │
│  Added: 5,000 sats                               │
│  Skipped: 0 duplicates                           │
│  New balance: 5,000 sats                         │
│                                                  │
│  [Done]                                          │
└──────────────────────────────────────────────────┘
```

### 8.4 Paste Cashu Token

In addition to file import, users can paste raw Cashu tokens:

```
Options Page or Extension Popup → "Redeem ecash"

┌──────────────────────────────┐
│  Paste a Cashu token to      │
│  add it to your wallet.      │
│                              │
│  [cashuA...]                 │
│                              │
│  [Redeem]                    │
└──────────────────────────────┘
```

This handles the case where someone sends an ecash token via DM, email, or any other channel.

---

## 9. Security Model

### 9.1 Proof Storage

| Layer | Protection |
|-------|-----------|
| Local (chrome.storage) | Proofs encrypted with master password (AES-256-GCM, matching existing wallet.js pattern) |
| Relay (kind 7375) | Proofs NIP-44 encrypted to self (only user's secret key can decrypt) |
| Backup file | Contains standard Cashu V4 tokens (bearer — anyone with the file can redeem) |
| In-memory | Proofs decrypted only during active session, cleared on lock |

### 9.2 Mint Trust

- Default mint: `mint.minibits.cash` (established, audited)
- Future: user can add custom mints via options page
- UI shows mint info on options page (not in popup — avoid confusion)
- Mint URL is stored but **never shown to new users** unless they go to settings

### 9.3 Proof Validity

- On every unlock: check proof state with mint (background, non-blocking)
- If proofs are spent (double-spend from another device): sync from relays, update balance
- Display: show cached balance immediately, update silently when check completes

### 9.4 Backup File Warning

When downloading backup:
```
⚠️ Anyone with this file can spend these funds.
   Store it safely, like a password.
   [I understand — Download]
```

One-time warning, not shown again for subsequent downloads.

---

## 10. Migration & Rollout

### 10.1 Existing Users (Have NWC Wallet)

- **No change.** Their NWC wallet continues to work.
- A Cashu wallet is NOT auto-created for existing users with an active NWC wallet.
- They can opt in via "Add Cashu wallet" in settings.

### 10.2 Existing Users (No Wallet)

- On next unlock after update, auto-create Cashu wallet silently.
- Wallet tab now shows "0 sats" instead of "No Wallet Connected."
- One-time toast: "Your wallet is ready! Tap Receive to add funds."

### 10.3 New Users (Fresh Install)

- Cashu wallet created during account setup.
- Seamless — they never see the empty state.

### 10.4 Feature Flag

```js
// lib/feature-flags.js
export const CASHU_WALLET_ENABLED = true  // flip to false to disable
```

Single flag to disable the entire Cashu feature. When disabled:
- No auto-creation
- NoWalletHome shown as before
- NWC-only path

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Mint goes offline | Can't send/receive until mint returns | Low (established mints) | Show offline banner, proofs are safe, support multiple mints later |
| Mint rug pull (steals funds) | Loss of all ecash at that mint | Very low (use trusted mints) | Default to audited mints, cap auto-created balance, add mint reputation later |
| Relay loses NIP-60 events | Backup lost (local cache still works) | Low | Publish to 3+ relays, local cache is primary |
| User loses device + no backup | Funds lost forever | Medium | Aggressive but non-blocking backup nudges, relay backup as safety net |
| Double-spend from multiple devices | Balance discrepancy | Medium | Proof state check on every unlock, relay sync on every transaction |
| cashu-ts bundle size | Extension size increases | Certain | Tree-shake, lazy-load Cashu engine only when needed |
| Regulatory concerns | Ecash may face legal scrutiny | Unknown | Feature flag to disable, no KYC on extension side (mint's responsibility) |

---

## File Inventory

### New Files

```
lib/cashu-engine.js          — Proof management, spend, receive, melt, mint
lib/cashu-sync.js            — Relay sync for NIP-60 events
lib/cashu-backup.js          — Export/import backup files + Cashu token strings
composables/useCashuBackup.js — Reactive backup state for UI
components/wallet/CashuReceiveToken.vue — Paste/scan ecash token input
components/options/WalletBackupPage.vue — Full backup management page
```

### Modified Files

```
lib/wallet.js                — Add type field, cashuState storage
entrypoints/background.js    — Cashu handlers + wallet router
composables/useWallet.js     — Route to correct engine based on wallet type
components/wallet/WalletHome.vue — Wallet type indicator (minimal)
components/wallet/SendFlow.vue   — Melt path for Cashu (backend only)
components/wallet/ReceiveFlow.vue — Mint path for Cashu
entrypoints/options/App.vue  — Add Wallet Backup sidebar section
package.json                 — Add @cashu/cashu-ts dependency
locales/*.json               — New i18n keys for Cashu UI strings
```

### Dependencies

```
@cashu/cashu-ts              — Cashu protocol client (mint API, proof operations)
```

---

## Summary

This plan turns Buho Jump from a "connect your own wallet" extension into a "wallet that works out of the box" extension. The core insight is: **users don't want to configure a wallet, they want to have a wallet.**

The Cashu ecash approach is ideal because:
1. No server to run (mints are public infrastructure)
2. No account registration (proofs are bearer tokens)
3. Lightning-compatible (mint/melt bridge)
4. Nostr-native backup (NIP-60 encrypted events)
5. Works with the secret key the user already has

The user never needs to know the word "Cashu." They just see sats.
