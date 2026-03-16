# Buho Jump — nostr-core Migration Backlog

> Goal: Build the extension exclusively on nostr-core v0.6.0 (latest for now).
> Remove all hand-rolled protocol code. Keep only extension-specific logic (storage, permissions, UI).
> Straightforward UI. No technical jargon. Friendly for new users.

---

## Current State

nostr-core is the sole Nostr dependency (no nostr-tools). Phase 1 and Phase 2 are complete.
All hand-rolled protocol code has been replaced. Mnemonic backup, LNURL-withdraw, and
payment success actions are implemented.

---

## Phase 1 — Replace Hand-Rolled Protocol Code

These tasks swap existing manual implementations for nostr-core equivalents.
Each is self-contained and can be shipped independently.

### T01 · Replace `lib/lnurl.js` with nostr-core lnurl module
**Files:** `lib/lnurl.js`, `lib/utils.js` (detectPaymentInput), `entrypoints/background.js`
**What:** Delete the 120-line manual bech32/LNURL implementation. Import from nostr-core:
- `decodeLnurl`, `isLnurl`, `resolveUrl` (handles bech32 + LUD-17 schemes)
- `fetchPayRequest`, `requestInvoice` (replaces `fetchLnurlPayParams` + `fetchLnurlPayInvoice`)
- `parseLnurlMetadata` (replaces manual metadata parsing)
**Why:** nostr-core covers LUD-01 through LUD-21 (withdraw, verify, AES success actions, payer data).
Our version only covers LUD-06/16/17.
**Keep:** `detectPaymentInput()` in utils.js — update it to call nostr-core's `isLnurl`/`decodeLnurl`.
**Test:** Send to Lightning Address, scan LNURL QR, LUD-17 scheme links.

### T02 · Replace NIP-65 code in `lib/relays.js` with nostr-core nip65
**Files:** `lib/relays.js`
**What:** Replace `parseNip65Event()`, `createNip65Event()`, `fetchNip65()` with:
- `nip65.parseRelayList(event)` → read/write relay extraction
- `nip65.createRelayListEvent(relayMap, pubkey)` → event creation
- `nip65.getReadRelays(event)`, `nip65.getWriteRelays(event)`
**Keep:** Storage layer (per-account relay config with 3 pools), `validateRelayUrl()`, caching logic.
**Test:** Publish relay list, fetch relay list for a pubkey, inbox/outbox resolution.

### T03 · Replace NIP-11 fetch in `lib/relays.js` with nostr-core nip11
**Files:** `lib/relays.js` (`fetchRelayInfo` function)
**What:** Replace manual HTTP fetch + NIP-11 parsing with `nip11.fetchRelayInfo(url)` and
`nip11.supportsNip(info, nipNumber)`.
**Keep:** 30-min cache wrapper around the call.
**Test:** Relay info modal in RelaySettings shows name, description, supported NIPs.

### T04 · Replace NIP-17 wrapping in `useChat.js` with nostr-core nip17
**Files:** `composables/useChat.js`
**What:** Replace the manual rumor→seal→wrap chain with:
- `nip17.wrapDirectMessage(content, senderSecretKey, recipientPubkey)` → returns wrapped event
- `nip17.unwrapDirectMessage(wrap, recipientSecretKey)` → returns decrypted content
Currently useChat manually calls `nip59.createRumor` → `nip59.createSeal` → `nip59.createWrap`.
The nostr-core `nip17` module does this in one call.
**Keep:** NIP-04 fallback path for NIP-46 accounts (no secret key for wrapping).
**Keep:** Account-scoped storage, subscription management, message status tracking.
**Test:** Send DM (local account), receive DM, account switch resets chat state.

### T05 · Replace `lib/profile.js` with nostr-core nip24 + direct pool usage
**Files:** `lib/profile.js`
**What:** Use `nip24.buildMetadataContent(profile)` for content construction.
Use pool.publish() directly with `finalizeEvent()` (already close to this).
Consider using `nip24.parseExtendedMetadata(event)` for profile fetching.
**Small change** — profile.js is only 85 lines and already uses nostr-core. This is a cleanup.
**Test:** Edit profile, publish, fetch profile for display.

### T06 · Use nostr-core nip02 for contact/follow list parsing
**Files:** `composables/useContacts.js`
**What:** Replace manual kind-3 tag parsing with:
- `nip02.parseFollowList(event)` → extract followed pubkeys with relay hints
- `nip02.getFollowedPubkeys(event)` → just the pubkey list
- `nip02.isFollowing(event, pubkey)` → check if someone is followed
**Keep:** Batch profile fetching, search, caching logic.
**Test:** Contact list loads, search works, new chat picks from contacts.

### T07 · Use nostr-core nip05 for identity verification
**Files:** `composables/useContacts.js`, profile display components
**What:** Add NIP-05 verification badges using:
- `nip05.queryNip05(address)` → resolve address to pubkey + relays
- `nip05.verifyNip05(pubkey, address)` → confirm match
Currently NIP-05 is displayed as text but never verified.
**UI:** Small checkmark next to verified NIP-05 addresses. No technical label — just a check icon.
**Test:** Profile with valid NIP-05 shows checkmark, invalid/missing does not.

---

## Phase 2 — New Features Unlocked by nostr-core

These were previously on the backlog but blocked by missing protocol support.
nostr-core v0.6.0 now provides everything needed.

### T08 · Mnemonic backup & recovery (NIP-06)
**Files:** New: `components/MnemonicBackup.vue`, `components/MnemonicRestore.vue`.
Update: `lib/accounts.js`, `components/options/AccountPage.vue`, `IdentityWizard.vue`
**What:** Use nostr-core's nip06 module:
- `nip06.generateMnemonic(12)` → 12-word seed phrase
- `nip06.validateMnemonic(phrase)` → verify on restore
- `nip06.mnemonicToKey(phrase)` → derive keypair
**UI flow (backup):**
1. In Account settings → "Back up recovery words"
2. Show 12 words in a clean grid (no "mnemonic" or "seed phrase" jargon)
3. "Write these down. They restore your account if you lose access."
4. Optional: confirm by picking 3 random words
**UI flow (restore):**
1. In IdentityWizard step 1 → add "Recover with words" option alongside Import
2. 12 input fields (or paste all at once)
3. Validate → derive key → show profile preview → done
**Labels:** "Recovery words" (not "mnemonic" or "seed phrase")

### T09 · Zap support (NIP-57)
**Files:** New: `components/ZapFlow.vue`. Update: `composables/useChat.js`, `entrypoints/background.js`
**What:** Use nostr-core's nip57 module:
- `nip57.createZapRequestEvent(params)` → build zap request
- `nip57.fetchZapInvoice(zapRequest, lnurl)` → get invoice from LNURL callback
- `nip57.parseZapReceipt(event)` → decode incoming zaps
- `nip57.validateZapReceipt(receipt)` → verify authenticity
**UI flow:**
1. In ChatThread → tap lightning bolt on a message → enter amount → confirm
2. In profile view → "Zap" button → amount → confirm
3. Show zap receipts inline in chat (already partially implemented)
**Labels:** "Zap" is already known in Nostr community. Keep it. Add tooltip: "Send sats directly"

### T10 · LNURL-withdraw support
**Files:** Update: `lib/utils.js` (detectPaymentInput), `entrypoints/background.js`, `components/SendFlow.vue`
**What:** Use nostr-core's lnurl module:
- `lnurl.fetchWithdrawRequest(input)` → get withdraw params
- `lnurl.submitWithdrawRequest(request, invoice)` → submit our invoice
**UI flow:**
1. User scans withdraw QR or pastes LNURL-withdraw link
2. Show: "Claim [amount] sats" with source info
3. Auto-generate invoice via NWC, submit, show success
**Labels:** "Claim payment" (not "LNURL-withdraw")

### T11 · Payment verification & success actions
**Files:** Update: `components/SendFlow.vue`, new: `components/PaymentSuccess.vue`
**What:** Use nostr-core's lnurl module:
- `lnurl.verifyPayment(verifyUrl)` → confirm payment landed
- `lnurl.parseSuccessAction(raw)` → handle post-payment actions
- `lnurl.decryptAesSuccessAction(action, preimageHex)` → decrypt AES messages
**UI flow:**
1. After LNURL-pay completes, show success action if present
2. Types: plain message, URL link, or decrypted secret message
3. Clean success screen with animation
**Labels:** "Payment confirmed" with relevant action displayed naturally

---

## Phase 3 — Frontend Polish for New Users

These improve onboarding and everyday UX. No protocol changes — pure frontend.

### T12 · Simplified onboarding flow
**Files:** `components/IdentityWizard.vue`, `components/LockScreen.vue`
**What:** Streamline the 5-step wizard:
- Step 1: "Create new account" (big primary button) / "I already have one" (secondary)
  - Remove NIP-46 from initial wizard — move to Account settings as "Connect remote signer"
- Step 2 (new): Set password (combine with current LockScreen setup)
- Step 3 (new): Show recovery words immediately (integrated, not separate backup flow)
- Step 4 (new): "Connect a wallet" (paste NWC string) or "Skip for now"
- Done. Land on home screen.
**For imports:** "I already have one" → choice: "Paste secret key" / "Recovery words" / "Connect remote signer"
**Labels:** "Your account is ready" / "Set a password to protect it" / "Save these recovery words"
**No mention of:** npub, nsec, NIP-46, bunker, hex keys in the main flow

### T13 · Home screen for walletless users
**Files:** `entrypoints/popup/App.vue`, new: `components/NoWalletHome.vue`
**What:** Currently users without NWC see an empty state. Replace with:
- Identity card (profile pic, display name, npub as "your address")
- "Connect wallet" card with illustration + one-tap flow
- Quick actions: Chat, Settings
- Recent activity (signed events count, connected sites)
**Labels:** "Connect a Lightning wallet to send and receive" (not "Paste NWC URI")

### T14 · Human-readable permission prompts
**Files:** `entrypoints/prompt/App.vue`
**What:** Replace technical method names with plain language:
- `signEvent` → "Sign a message" (with kind-specific detail: "Post", "Like", "Repost", "DM")
- `nip04.encrypt` → "Encrypt a message"
- `nip04.decrypt` → "Read an encrypted message"
- `nip44.encrypt` → "Encrypt a message (secure)"
- `nip44.decrypt` → "Read an encrypted message (secure)"
- `getPublicKey` → "See your public identity"
- `getRelays` → "See your preferred servers"
- `webln_sendPayment` → "Send a payment of [X] sats"
- `webln_makeInvoice` → "Create a payment request"
- `webln_getBalance` → "Check your balance"
**Show:** Site favicon + name prominently. Risk level as color (green/yellow/red), not text.

### T15 · Relay settings UX simplification
**Files:** `components/RelaySettings.vue`, `components/RelayInfoSheet.vue`
**What:** Current 3-tab relay manager (Account/Wallet/Chat) is confusing for new users.
- Default view: single list "Your relays" (merged account + chat)
- Wallet relay managed automatically from NWC connection (hidden unless advanced)
- "Advanced" toggle reveals the 3-pool split
- One-tap "Reset to recommended" button
- Relay status dots (green = connected, red = failed, gray = not connected)
**Labels:** "Relays" → "Connections" or keep "Relays" with subtitle "Servers that store your data"

### T16 · Unified send flow
**Files:** `components/SendFlow.vue`, `components/wallet/SendFlow.vue`
**What:** One input field that auto-detects everything:
- Lightning invoice → show amount, memo, pay button
- Lightning Address → show recipient, enter amount, pay
- LNURL-pay → resolve, show bounds, enter amount, pay
- LNURL-withdraw → show "Claim" flow (T10)
- Merchant QR → show merchant name + logo, convert, pay
- Nostr npub/nprofile → "Send a zap" (T09)
**Smart paste:** Auto-detect from clipboard on focus. "Paste from clipboard" button.
**Labels:** "Send to anyone" as placeholder. Progress: "Finding recipient..." → "Ready to send"

---

## Phase 4 — Deeper nostr-core Integration

Lower priority. Polish and power-user features.

### T17 · NIP-42 relay authentication
**Files:** `lib/relays.js`, `entrypoints/background.js`
**What:** Use `nip42.createAuthEvent(relayUrl, challenge)` for relay auth challenges.
Some relays require auth for publishing. Handle transparently in background.
**UI:** None for users. Background auto-signs auth challenges.

### T18 · NIP-51 lists (mute, bookmarks, pins)
**Files:** New: `composables/useLists.js`, UI TBD
**What:** Use nostr-core's nip51 module:
- `nip51.createListEvent(kind, items)` → create/update lists
- `nip51.parseList(event)` → read lists
**UI:** Mute list in chat (block sender). Bookmarks in future content views.

### T19 · NIP-50 search
**Files:** Future feature
**What:** Use `nip50.buildSearchFilter(query)` for relay-side search.
Enables searching messages, profiles, content across relays.

### T20 · NIP-98 HTTP auth
**Files:** Future feature
**What:** Use `nip98.createHttpAuthEvent()` + `nip98.getAuthorizationHeader()`.
For authenticating with Nostr-aware HTTP APIs (media uploads, etc.)

### T21 · NIP-13 proof-of-work
**Files:** Future feature
**What:** Use `nip13.minePow(event, difficulty)` for spam resistance on relays that require it.

### T22 · NIP-58 badges
**Files:** Future feature
**What:** Display earned badges on profile using nostr-core nip58 module.

---

## Task Dependency Map

```
T01 (lnurl) ──────────────────→ T10 (withdraw) ──→ T11 (verify/success)
T02 (nip65) ──→ T03 (nip11)
T04 (nip17)
T05 (profile) ─→ T07 (nip05)
T06 (contacts)
T08 (mnemonic) ────────────────→ T12 (onboarding)
T09 (zaps) ────────────────────→ T16 (unified send)
T13 (no-wallet home)
T14 (prompts)
T15 (relay UX)
T17-T22 (independent, low priority)
```

## Priority Order (suggested)

| Order | Task | Effort | Status |
|-------|------|--------|--------|
| 1 | T01 — LNURL replacement | Small | DONE |
| 2 | T02 — NIP-65 replacement | Small | DONE |
| 3 | T03 — NIP-11 replacement | Tiny | DONE |
| 4 | T04 — NIP-17 cleanup | Medium | DONE |
| 5 | T06 — NIP-02 contacts | Small | DONE |
| 6 | T05 — Profile cleanup | Tiny | DONE |
| 7 | T07 — NIP-05 verification | Small | DONE |
| 8 | T08 — Mnemonic backup | Medium | DONE |
| 9 | T10 — LNURL-withdraw | Small | DONE |
| 10 | T11 — Payment success | Small | DONE |
| 11 | T09 — Zaps (NIP-57) | Medium | DONE |
| 12 | T13 — No-wallet home | Small | DONE |
| 13 | T14 — Prompt rewording | Small | DONE (already existed) |
| 14 | T12 — Onboarding flow | Medium | DONE (mnemonic integrated) |
| 15 | T16 — Unified send | Medium | DONE (auto-detect + withdraw) |
| 16 | T15 — Relay UX | Small | TODO |
| 17+ | T17-T22 | Varies | TODO |

---

## Rules

- One task per PR. Test before moving on.
- Never expose NIP numbers, hex keys, or protocol names in UI.
- Every user-facing string goes through i18n.
- Keep the extension under 500KB bundled.
- nostr-core is the single source of truth for all Nostr protocol logic.
