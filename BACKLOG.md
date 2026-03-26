# Buho Jump — Full Audit Backlog

> Generated: 2026-03-24 | Audit round: 1
> Checkboxes: `[ ]` = pending, `[x]` = done, `[~]` = partial / in progress

---

## Phase 0 — Ship Blockers (Background.js Hardening)

### P0-A: Error Boundary & Response Guarantee

- [x] **P0-A1** — Wrap top-level message handler in try-catch (`background.js:1225`)
  - Added `.catch()` on `handle()` promise so `sendResponse` always fires

- [x] **P0-A2** — Add try-catch to all wallet handlers (`background.js:921-972`)
  - Added `classifyError()` to outer catch — maps raw errors to structured codes (NO_WALLET, WALLET_DISCONNECTED, TIMEOUT, WRONG_PASSWORD, LOCKED, PERMISSION_DENIED, INSUFFICIENT_BALANCE)

- [x] **P0-A3** — Add try-catch to zap handler (`background.js:975-1015`)
  - Wrapped fallback payment path with `classifyError()` fallback to ZAP_FAILED

- [x] **P0-A4** — Add try-catch to profile handlers (`background.js:840-856`)
  - Covered by outer catch + `classifyError()`

- [x] **P0-A5** — Add try-catch to relay handlers (`background.js:1079-1121`)
  - Covered by outer catch + `classifyError()`

- [x] **P0-A6** — Fix fire-and-forget in `START_NOSTR_CONNECT` (`background.js:802-827`)
  - Added `nip46LastError` state, `.catch()` stores error (skipping AbortError)
  - `GET_NIP46_STATUS` now returns `error` field (one-shot, cleared after read)

- [x] **P0-A7** — Await prompt event cleanup (`background.js:1193`)
  - Added `await` to `chrome.storage.local.remove()`
  - Added startup sweep for stale `prompt_event_*` keys in `defineBackground()`

### P0-B: Race Conditions

- [x] **P0-B1** — Guard account switch against in-flight requests (`background.js:714`)
  - Added `_accountSwitching` flag, checked in `ensureNWC()` — throws if switching

- [x] **P0-B2** — Fix concurrent unlock prompt race (`background.js:206-246`)
  - Second waiter now re-checks `isUnlocked()` after shared promise resolves

- [x] **P0-B3** — Cancel previous NIP-46 listener before starting new one (`background.js:802`)
  - Already handled by existing `_nostrConnectAbort.abort()` call before new listener

- [x] **P0-B4** — Fix NWC notification subscription leak (`background.js:384-406`)
  - Now always tears down existing sub before creating new one
  - Added stale-client guard via captured `client` reference

- [x] **P0-B5** — Fix NWC cleanup order (`background.js:351`)
  - Extracted `teardownNwc()` helper — unsub first, then close, then null
  - Replaced all 6 scattered cleanup sites with `teardownNwc()`

### P0-C: BOLT-11 & Payment UX

- [x] **P0-C1** — Use nostr-core `decodeBolt11()` to parse invoices locally
  - Replaced hand-rolled regex parser with `safeDecode11()` → `decodeBolt11()`
  - Full invoice data now available (amount, expiry, description, payee, network)

- [x] **P0-C2** — Use nostr-core `parseSuccessAction()` after LNURL-pay
  - SendFlow.vue: captures `successAction` from LNURL-pay response after payment
  - Displays message/url/aes in result screen

- [x] **P0-C3** — Use nostr-core `decryptAesSuccessAction()` for encrypted success actions
  - Auto-decrypts AES success actions using payment preimage
  - Displays decrypted content inline in result screen

---

## Phase 1 — Enterprise Hardening

### P1-A: Structured Logging

- [x] **P1-A1** — Create `lib/logger.js` with error codes + context
  - Ring buffer (max 200), debounced flush (5s), levels: error/warn/info/debug
  - Entries: `{ t, l, m, c, d }` — compact, no secrets

- [x] **P1-A2** — Replace silent `catch {}` blocks with logger calls
  - background.js: outer error boundary, NIP-46 reconnect, NWC notif sub, relay auth, zap fallback, proactive reconnect, account cleanup
  - notificationPoller.js: poll failure, storage reads, relay queries, timestamp write

- [x] **P1-A3** — Add debug log handlers in background.js
  - `GET_DEBUG_LOG`, `CLEAR_DEBUG_LOG`, `EXPORT_DEBUG_LOG` handlers for options page

### P1-B: Storage Robustness

- [x] **P1-B1** — Add write-verify pattern to `lib/accounts.js`
  - Created shared `lib/storage.js` with `verifiedSet()` — write + readback + retry

- [x] **P1-B2** — Add write-verify pattern to `lib/wallet.js`
  - Uses `verifiedSet()` from `lib/storage.js`

- [x] **P1-B3** — Add write-verify pattern to `lib/allowances.js`
  - All 3 write paths now use `verifiedSet()` — throws on write failure

- [x] **P1-B4** — Add write-verify pattern to `lib/relays.js`
  - All 4 write paths now use `verifiedSet()`

- [x] **P1-B5** — Add startup integrity check
  - `defineBackground()` calls `getActiveAccount` + `getActiveWallet` after session load
  - Logs `ACCOUNTS_INTEGRITY_FAILED` / `WALLETS_INTEGRITY_FAILED` on failure

### P1-C: Session & Browser Compat

- [x] **P1-C1** — Add `chrome.storage.session` fallback in `lib/session.js`
  - Auto-detects API availability, falls back to `chrome.storage.local`
  - `clearSession()` clears both backends

- [x] **P1-C2** — Handle service worker restart gracefully
  - `getSession()` returns null on failure (try-catch added)
  - `ensureSessionLoaded()` logs when no session found

### P1-D: Connection Health

- [x] **P1-D1** — Add relay pool status method
  - `getRelayStatus()` in `relayPool.js` — returns Map<url, connected>

- [x] **P1-D2** — Add NWC connection health indicator
  - `GET_NWC_STATUS` handler in background.js — returns `{ connected }`

- [x] **P1-D3** — Improve `withNwcRetry()`
  - Extracted `isConnectionError()` helper
  - 1s backoff before retry, logs retry attempts via logger

### P1-E: Content Script Security

- [x] **P1-E1** — Add origin check to `window.postMessage` responses
  - Changed from `'*'` to `window.location.origin`

- [x] **P1-E2** — Add `onerror` handler to injected scripts
  - Logs warning to console on injection failure

- [x] **P1-E3** — Handle `chrome.runtime.lastError` + context invalidation
  - Guards against `chrome.runtime.id` being null (extension unloaded)
  - Checks `chrome.runtime.lastError` after `sendMessage`
  - Fixed type check on `res.error.includes()` (ensured string)

### P1-F: Test Coverage Expansion

- [x] **P1-F1** — `tests/wallet.test.js` — 14 tests: CRUD, encryption, summaries, re-encrypt
- [x] **P1-F2** — `tests/allowances.test.js` — 13 tests: budget, spend, cumulative, reset, validation
- [x] **P1-F3** — `tests/relays.test.js` — 12 tests: config, pools, add/remove, URL validation
- [x] **P1-F4** — `tests/session.test.js` — 5 tests: save/restore, overwrite, clear
- [x] **P1-F8** — `tests/storage.test.js` — 4 tests: verifiedSet, verifiedGet
- [x] **P1-F9** — `tests/logger.test.js` — 5 tests: all levels, flush, clear
- [x] **P1-F5** — `tests/accountSwitch.test.js` — 7 tests: switch, cleanup, error resilience
- [x] **P1-F6** — `tests/lnurl.test.js` — 3 tests: encode/decode round-trip, isLnurl validation
- [ ] **P1-F7** — `tests/nip46-bridge.test.js` — connection, timeout, reconnection (requires relay mock)

---

## Phase 1.5 — Comprehensive Test Coverage

> Goal: Every lib module and composable has tests. **Done:** 22/22 lib modules tested, 8/16 composables tested.
> Test count at start of phase: 157 tests across 13 files. **After: 384 tests across 27 files (+227 tests, +14 files).**

### P1.5-A: Untested Lib Modules

- [x] **P1.5-A1** — `tests/utils.test.js`
  - `cn()` — class merging
  - `truncateKey()` — key shortening
  - `msatsToSats()` / `satsToMsats()` / `formatSats()` — unit conversions
  - `cleanMessageContent()` — protocol marker stripping
  - `formatTimestamp()` — relative time formatting (just now, minutes ago, hours ago, days)
  - `formatFullDate()` — full datetime
  - `detectPaymentInput()` — invoice / lnurl / lnaddress / merchant / unknown detection

- [x] **P1.5-A2** — `tests/merchantQR.test.js`
  - `isSARetailerQR()` — EMVCo Phase 1 detection
  - `isConvertibleQR()` — convertible QR check
  - `getMerchantInfo()` — retailer name, color, logo extraction
  - `getMerchantInitials()` — avatar fallback
  - `parseZARFromMetadata()` / `parseZARFromDescription()` — ZAR amount extraction

- [x] **P1.5-A3** — `tests/avatarColor.test.js`
  - Deterministic color from pubkey
  - Returns valid CSS color
  - Same input → same output (idempotent)

- [x] **P1.5-A4** — `tests/relayPool.test.js`
  - `getPool()` — returns singleton
  - `resetAuthedRelays()` — clears auth set
  - `getRelayStatus()` — returns Map when no pool exists

- [x] **P1.5-A5** — `tests/notificationPoller.test.js`
  - `startNotificationPoller()` — creates alarm
  - Alarm listener registered
  - Skip poll when locked (no password)

- [x] **P1.5-A6** — `tests/lnurl.test.js` — expand existing
  - `executeLnurlPay()` — min/max validation (mock fetchPayRequest)
  - `fetchLnurlPayParams()` — msats→sats conversion
  - `fetchLnurlPayInvoice()` — successAction passthrough

- [x] **P1.5-A7** — `tests/nip46-bridge.test.js`
  - `createNostrConnectURI()` — URI format validation
  - `parseConnectionURI()` — re-export works
  - Connection timeout handling (mock relay)

### P1.5-B: Composable Tests

> Composables wrap background messaging + reactive state. Tests mock `useMessaging`
> and verify reactive state updates. No browser or Vue mount needed for most.

- [x] **P1.5-B1** — `tests/useMessaging.test.js`
  - `send()` — returns result on success
  - `send()` — throws with error code on failure
  - `send()` — translates known error codes to `errors.*` i18n keys
  - `send()` — timeout after 15s (default) / 45s (slow ops)

- [x] **P1.5-B2** — `tests/useToast.test.js`
  - `success()` / `error()` / `info()` — add to toasts array
  - `dismiss()` — removes by id
  - Auto-dismiss after duration

- [x] **P1.5-B3** — `tests/useFiat.test.js`
  - `toFiat()` / `fiatToSats()` — conversion math
  - `currencyInfo()` — returns symbol + name for all 19 currencies
  - `toggleDenomination()` — switches sats/fiat
  - Currency persistence to storage

- [x] **P1.5-B4** — `tests/useTheme.test.js`
  - `setTheme()` / `setMode()` — updates reactive state
  - `toggleMode()` — light ↔ dark
  - `cycleTheme()` — cycles through themes

- [x] **P1.5-B5** — `tests/useLock.test.js`
  - `setup()` — sets password, unlocks
  - `unlock()` — verifies password, sets locked = false
  - `lock()` — sets locked = true, clears session
  - Failed attempts tracking + progressive delay
  - Auto-lock countdown

- [x] **P1.5-B6** — `tests/usePermissions.test.js`
  - `load()` — populates domains + policies
  - `revokeDomain()` — removes all permissions for a domain
  - `revokeMethod()` — removes single method permission

- [x] **P1.5-B7** — `tests/useMuteList.test.js`
  - `mute()` / `unmute()` — adds/removes pubkeys
  - `isMuted()` — checks membership
  - `reset()` — clears list
  - Account-scoped storage

- [x] **P1.5-B8** — `tests/useOnline.test.js`
  - Tracks `navigator.onLine`
  - Reacts to online/offline events

### P1.5-C: Integration / Edge Case Tests

- [x] **P1.5-C1** — `tests/crypto.test.js` — expand existing
  - `changePassword()` — old password invalid after change
  - `encryptData` / `decryptData` — wrong password throws
  - Empty data handling
  - Large data (10KB+ payload)

- [x] **P1.5-C2** — `tests/accounts.test.js` — expand existing
  - Re-encrypt with wrong old password fails
  - Remove last account — activeAccountId cleared
  - Import duplicate nsec — handled gracefully
  - Mnemonic account — verify derived pubkey is deterministic

- [x] **P1.5-C3** — `tests/wallet.test.js` — expand existing
  - Remove active wallet — next wallet auto-activates (or null)
  - Legacy single-wallet migration
  - Wrong password returns empty store (not throws)

- [x] **P1.5-C4** — `tests/permissions.test.js` — expand existing
  - Per-kind signEvent permissions (e.g., signEvent:4)
  - `clearAllPermissions()` — wipes everything for a profile
  - Prototype pollution protection (`__proto__` as host)

- [x] **P1.5-C5** — `tests/notifications.test.js` — expand existing
  - Quiet hours edge: start > end (wraps midnight)
  - Throttle resets after interval
  - Dedup window expiry

---

## Phase 2 — UX Polish

### P2-A: Unified Error System

- [x] **P2-A1** — Error hierarchy established
  - Toast: success, copy confirmations (useToast)
  - Banner: ErrorBanner.vue (error/warning/info with retry + dismiss)
  - Inline: validation hints on inputs

- [x] **P2-A2** — Created `ErrorBanner.vue` component
  - Props: type, message, dismissable, retryLabel. Emits: dismiss, retry. Has `role="alert"`

- [x] **P2-A3** — Surface `useContacts` errors in ContactPicker
  - Added `contactsError` import, shows ErrorBanner with retry when follow list fails

- [x] **P2-A4** — Surface fiat rate failures in SendFlow
  - `fiatRateUnavailable` ref set on conversion error, shows warning hint below input

- [x] **P2-A5** — Show QR generation failure toast in ReceiveFlow
  - `toast.error(t('wallet.qrFailed'))` on catch

### P2-B: Loading States

- [x] **P2-B1** — WalletConnect already has `connecting` loader on button — no skeleton needed
- [x] **P2-B2** — ChatThread loads from local storage (instant) — no skeleton needed
- [x] **P2-B3** — Added countdown timer to NIP-46 polling in `IdentityWizard.vue`
  - 90s countdown with mm:ss display, "Connection timed out" on expiry
- [x] **P2-B4** — Used `EmptyState` component in `TransactionHistory.vue`
  - Receipt icon + "Transactions will appear here" description
- [x] **P2-B5** — Refresh toast now shows balance diff (`+500` / `-200`)

### P2-C: Input Validation

- [x] **P2-C1** — Added `maxlength="50"` to display name inputs (new + recover modes)
- [x] **P2-C2** — Added nsec/hex format validation in IdentityWizard
  - `isValidKeyInput()` checks nsec1 prefix or 64-char hex, `importKeyError` computed for inline hint
- [x] **P2-C3** — Added validation error message to mnemonic input
  - Shows "Invalid recovery phrase" when 12+ words entered but `validateMnemonic` fails
- [x] **P2-C4** — Added character count to chat textarea (`ChatThread.vue`)
  - `maxlength="5000"`, counter shows at 4500+, red at 4900+
- [x] **P2-C5** — Added live `amountError` computed — shows "too low" or "insufficient balance" inline
- [x] **P2-C6** — Added password strength indicator to password change (`PreferencesPage.vue`)
  - 3-bar strength meter with weak/fair/strong labels, matching LockScreen pattern

### P2-D: Confirmation & Safety

- [x] **P2-D1** — Added duplicate key detection on import
  - `importAccount()` checks if pubkey already exists, switches to existing instead of creating duplicate
- [x] **P2-D2** — Backup gate already existed — `backupConfirmed` checkbox gates Continue button
- [x] **P2-D3** — Backup reminder banner after 7 days if never exported
  - `CHECK_BACKUP_STATUS` handler, `backupExported_{id}` flag set on `EXPORT_NSEC`
- [x] **P2-D4** — Merchant countdown already shows expired overlay and hides Pay button
- [x] **P2-D5** — LNURL-withdraw already shows min/max range, description, fiat conversion

### P2-E: Offline & Network

- [x] **P2-E1** — Added offline check in SendFlow via `useOnline()`
  - ErrorBanner shows "No internet connection" when offline
- [x] **P2-E2** — Added offline ErrorBanner in ChatThread above input bar
- [x] **P2-E3** — Already done via `classifyError()` (P0) + `useMessaging` error code translation (P1)
- [x] **P2-E4** — Already done: querySync has `maxWait: 5000` (contacts), `maxWait: 8000` (profile)
- [x] **P2-E5** — Already done via `withNwcRetry()` with 1s backoff (P1-D3)

### P2-F: Accessibility (WCAG 2.1 AA)

- [x] **P2-F1** — Added `aria-label` to icon-only buttons
  - TransactionDetail close, TransactionHistory back, WalletHome refresh, SendFlow back, GroupThread back, ReceiveFlow back, OpenInBrowserButton
- [x] **P2-F2** — Added focus trap to BottomSheet + SlidePanel
  - `composables/useFocusTrap.js` — Tab/Shift+Tab cycling, Escape to close, focus restore on deactivate
- [x] **P2-F3** — Added arrow key navigation to currency + language pickers
  - `composables/useListKeyboard.js` — ArrowUp/Down/Home/End/Enter, scroll into view, highlight ring
- [x] **P2-F4** — Focus ring already global via `*:focus-visible` in main.css (line 172)
- [x] **P2-F5** — Avatar images use empty `alt=""` — correct for decorative images paired with text names
- [x] **P2-F6** — Added `role="tablist"` + `role="tab"` + `aria-selected` to BottomTabs
- [x] **P2-F7** — Color contrast managed by theme tokens — buho-green passes 4.5:1 on both light/dark modes

### P2-G: Visual Consistency

- [x] **P2-G1** — Global `button:disabled { opacity: 0.4; cursor: not-allowed }` in main.css
- [x] **P2-G2** — Icon size tokens in `:root` + utility classes (`icon-xs` through `icon-xl`)
- [x] **P2-G3** — Replaced `#607D8B` with `var(--text-muted)` in SendFlow merchant card
- [x] **P2-G4** — Replaced `#888` with `var(--text-muted)` in theme dots (popup + PreferencesPage)
- [x] **P2-G5** — `merchantLogoFailed` ref was already wired to `@error` — false positive in audit

### P2-H: Onboarding

- [x] **P2-H1** — Enhanced mode card descriptions with specifics (key pair, recovery phrase, nsec, signer apps)
- [x] **P2-H2** — Added "Your nsec key is in your existing Nostr app's settings" guidance
- [x] **P2-H3** — NoWalletHome already has feature hints (send, receive, zap); WalletHome has quick actions
- [x] **P2-H4** — Enhanced auto-lock description: "You'll need your password to unlock again"

### P2-I: Session & Lock UX

- [x] **P2-I1** — Auto-lock countdown banner already existed in popup/App.vue
- [x] **P2-I2** — "Stay unlocked" button already existed with `resetAutoLock`
- [x] **P2-I3** — Shows "Last active: Mar 24, 2026, 11:45 PM" on lock screen
  - `lastUnlockedAt` prop on LockScreen, fetched from session fallback key

---

## Phase 3 — nostr-core Full Utilization

### P3-A: Replace Hand-Rolled Code

- [x] **P3-A1** — Added `convertSatsToFiat()` async helper using nostr-core `satsToFiat()`
- [x] **P3-A2** — Replaced relay URL normalization with nostr-core `normalizeURL()`
- [x] **P3-A3** — Already done — no direct `@noble/hashes` imports exist
- [x] **P3-A4** — Added `nostr:` URI format (4th pubkey display option) using `nip21.encodeNostrURI()`
- [x] **P3-A5** — Added `addAltTag()` to profile publishing events

### P3-B: Payment Features

- [x] **P3-B1** — LNURL-withdraw already implemented in SendFlow (P0 sprint)
- [x] **P3-B2** — LUD-21 payment verification via `verifyLnurlPayment()` after LNURL-pay
  - Non-blocking verify after payment, shows "Payment verified by service" indicator
- [x] **P3-B3** — NWC `getBudget()` displayed in WalletHome below balance
  - Shows used/total budget from wallet-side (non-blocking, optional)
- [x] **P3-B4** — Zap goals: library support via `lib/nostrEvents.js` (createZapGoalEvent, parseZapGoal, calculateProgress)

### P3-C: Chat Enhancements

- [x] **P3-C1** — NIP-25 reactions: `SEND_REACTION` handler in background.js
- [x] **P3-C2** — NIP-27 content references: `nostr:` links in chat messages
  - `lib/nostrLinks.js` — `parseNostrLinks()` + `hasNostrLinks()` using nostr-core `extractReferences`
  - ChatBubble renders mentions as clickable `@npub1abc…xyz` links → njump.me
- [x] **P3-C3** — NIP-40 expiring messages
  - `sendMessage` accepts `{ expiresAt }` option, adds expiration tag to rumor
  - `getMessages` filters out expired messages
  - Incoming messages store `expiresAt` from expiration tag
- [x] **P3-C4** — NIP-09 event deletion
  - `DELETE_EVENT` handler in background.js using `nip09.createDeletionEvent()`
  - Publishes kind 5 deletion event to account relays
- [x] **P3-C5** — NIP-30 custom emoji: `lib/messageEnrich.js` — `getCustomEmojis()` + `renderCustomEmojis()`
- [x] **P3-C6** — NIP-36 content warnings: `lib/messageEnrich.js` — `getWarning()`
- [x] **P3-C7** — NIP-10 thread parsing: `lib/messageEnrich.js` — `getThreadRef()`

### P3-D: Identity & Discovery

- [x] **P3-D1** — NIP-58 badges: `lib/badges.js` — `fetchProfileBadges()` with definition resolution
- [x] **P3-D2** — NIP-56 reports: `REPORT_EVENT` handler (spam/abuse types, publishes kind 1984)
- [x] **P3-D3** — NIP-50 search: `lib/search.js` — `searchEvents()` with `buildSearchFilter()`
- [x] **P3-D4** — NIP-98 HTTP auth: `SIGN_HTTP_AUTH` handler, returns auth header

### P3-E: Media & Storage

- [~] **P3-E1** — Blossom media: removed — out of scope for extension
- [~] **P3-E2** — Blossom server list: removed — out of scope for extension

### P3-F: Advanced Features

- [ ] **P3-F1** — NIP-60 Cashu ecash — deferred to Phase 4 (needs full UI)
- [~] **P3-F2** — NIP-13 PoW: removed — impractical in extension context
- [~] **P3-F3** — NIP-22 comments: removed — out of scope for extension
- [~] **P3-F4** — NIP-23 long-form: removed — out of scope for extension
- [~] **P3-F5** — NIP-18 reposts: removed — out of scope for extension
- [~] **P3-F6** — NIP-52 calendar: removed — out of scope for extension

---

## Phase 4 — Enterprise UI/UX for Wired Features

> These features have backend handlers and library support but need UI to be user-facing.

### P4-A: Chat UX Completion

- [x] **P4-A1** — Reaction picker: `MessageActions.vue` — 5 quick emoji reactions (❤️👍👎😂⚡)
- [x] **P4-A2** — Message deletion: context menu → `DELETE_EVENT` handler
- [x] **P4-A3** — Expiring messages: Timer toggle (Off/5m/1h/24h), toolbar indicator
- [x] **P4-A4** — Content warning: CW toggle + reason input in compose toolbar
- [x] **P4-A5** — Custom emoji rendering in bubbles (NIP-30 tags → inline images, XSS-safe)
- [x] **P4-A6** — N/A — NIP DMs don't support editing
- [x] **P4-A7** — Reply: preview bar above input → `replyTo` sent with message → shown in bubble
- [x] **P4-A8** — Forward: copies text to clipboard (full flow needs contact picker)
- [x] **P4-A9** — Reactions: 5-emoji picker in context menu → `SEND_REACTION`
- [x] **P4-A10** — Relay pill: count next to timestamp, click expands relay URL list

### P4-B: Reporting & Moderation

- [x] **P4-B1** — `ReportDialog.vue` — type selector (5 types), reason text, submit → `REPORT_EVENT`
- [x] **P4-B2** — Block + report: "Also block" checkbox in ReportDialog → auto-mute

### P4-C: NIP-98 HTTP Auth UX

- [x] **P4-C1** — HTTP auth display in prompt — kind 27235 shows method + URL instead of raw JSON

### P4-D: NIP-60 Cashu Ecash (Pending - not planned for initinal release)

- [ ] **P4-D1** — Cashu wallet tab in WalletHome
  - Show ecash balance (sum of kind 7375 token proofs)
  - Mint selector (configured mints)
  - Receive: paste token / scan QR
  - Send: create cashu token, share via QR/copy

- [ ] **P4-D2** — Cashu ↔ Lightning swap
  - Melt: convert ecash to Lightning invoice (pay out)
  - Mint: convert Lightning payment to ecash (receive in)

- [ ] **P4-D3** — Cashu backup to relays
  - Publish encrypted wallet event (kind 17375)
  - Restore from relay on new device

### P4-E: Search & Discovery

- [x] **P4-E1** — Chat search extended to message content (deep search across all messages per conversation)
- [x] **P4-E2** — Profile badges on identity card + BadgeBox link in About page
  - `lib/badges.js` recreated, badges fetched on profile load, shown as pills
  - BadgeBox ecosystem link in options About page

### P4-F: Visual Polish (Enterprise Grade)

- [x] **P4-F1** — Micro-interactions: `slide-up` Vue transition, `.tap-highlight` CSS class
- [x] **P4-F2** — Error recovery: covered by ErrorBanner `retryLabel` + `@retry` across all views
- [x] **P4-F3** — Empty state SVG illustrations: EmptyWallet, EmptyChat, EmptyTransactions (brand-colored inline SVGs)

---

## Audit Checklist (Round 2 Verification)

> Use this section to verify each phase after implementation.

### Phase 0 Verification
- [x] Every background.js handler returns `{ error }` on failure (never hangs)
- [x] No unhandled promise rejections in background.js
- [x] Account switch is atomic (no in-flight request uses stale client)
- [x] Unlock prompt handles concurrent requests correctly
- [x] NIP-46 reconnection cancels previous listener
- [x] NWC subscriptions don't leak on repeated calls
- [x] BOLT-11 invoice details shown before payment confirmation
- [x] LNURL success action displayed after payment

### Phase 1 Verification
- [x] Logger captures errors with codes and context (13 calls in background.js)
- [x] Silent `catch {}` blocks replaced — remaining ones are cleanup/best-effort
- [x] Storage writes verified (verifiedSet in accounts, wallet, allowances, relays)
- [x] `allowances.recordSpend()` throws on write failure (via verifiedSet)
- [x] Session works on Firefox (fallback to chrome.storage.local)
- [x] Service worker restart doesn't cause silent null password (logs + returns locked)
- [x] Relay pool health check available (getRelayStatus)
- [x] NWC shows "reconnecting" status — pulsing amber dot + "Reconnecting…" label in WalletHome
- [x] Content script validates message origins (window.location.origin + chrome.runtime.id guard)
- [x] All lib/ modules have test coverage (27 test files, 563 tests)

### Phase 2 Verification
- [x] Error toasts/banners/inline messages are consistent across all views
- [x] Every async view has loading skeleton or spinner
- [x] Every list view has proper empty state
- [x] All form inputs have validation + max length + error messages
- [x] Destructive actions have confirmation dialogs
- [x] Offline state surfaced in payment + chat flows
- [x] All icon buttons have `aria-label`
- [x] Modals trap focus (useFocusTrap in BottomSheet + SlidePanel)
- [x] Keyboard navigation works on pickers (useListKeyboard)
- [x] Disabled buttons styled consistently (global CSS rule)
- [x] Onboarding explains account types (enhanced mode descriptions)
- [x] Auto-lock countdown visible in UI (banner + "Stay unlocked" button)

### Phase 3 Verification
- [x] No hand-rolled code duplicating nostr-core functions
- [x] LNURL-withdraw flow works end-to-end
- [x] Payment verification (LUD-21) runs after LNURL-pay
- [x] Chat reactions (NIP-25) send via SEND_REACTION handler
- [x] `nostr:` links parsed in chat messages (parseNostrLinks → @npub links)
- [x] Expiring messages expire and hide (getMessages filters by expiresAt)
- [x] Message deletion works (DELETE_EVENT → kind 5)

---

## Phase 5 — Release Hardening & Verification

> Walk through every verification checklist item. Fix any that fail. Close the last P1 item.

### P5-A: Code Cleanup (from audit)

- [x] **P5-A1** — Remove 5 unused icon imports from popup/App.vue

### P5-B: Remaining P1 item

- [ ] **P5-B1** — P1-F7: `tests/nip46-bridge.test.js` — test `createNostrConnectURI` + `parseConnectionURI`

### P5-C: NWC Reconnecting Visual

- [x] **P5-C1** — NWC status in WalletHome: polls every 10s, pulsing amber dot + "Reconnecting…" when disconnected

### P5-D: Verification Checklist Pass

- [x] **P5-D1** — Phase 0: 8/8 pass
- [x] **P5-D2** — Phase 1: 10/10 pass (NWC visual fixed)
- [x] **P5-D3** — Phase 2: 12/12 pass
- [x] **P5-D4** — Phase 3: 7/7 pass

### P5-E: Pre-Release Polish

- [x] **P5-E1** — Locale check: 14 locales each missing 358 keys (new Phase 2-4 additions). Fallback to English works. Translation is a separate task.
- [x] **P5-E2** — Manifest permissions minimal: storage, tabs, windows (Chrome), notifications, alarms — all required
- [x] **P5-E3** — Build: 1.91 MB, all chunks reasonable, tree-shaking working
- [ ] **P5-E4** — Update version in package.json if needed

### P5-F: Real Locale Translation Pass

> Goal: replace English placeholder content in all non-English locale files with real translations while preserving placeholders and existing localized copy.

#### Acceptance Criteria

- [ ] Every non-English locale has no English placeholder strings left from the fallback sync pass
- [ ] Variable placeholders remain intact: `{count}`, `{name}`, `{host}`, `{shown}`, `{total}`, `{n}`, `{version}`, `user{'@'}domain.com`
- [ ] `npm run locales:check` passes after each batch
- [ ] `tests/locales.test.js` passes after each batch
- [ ] Full `npm test` passes after the final batch

#### Scope Notes

- [ ] Source of truth for untranslated strings identified: current union is 414 English placeholder keys across the 14 locale files
- [ ] Highest-volume areas: `prompt`, `chat`, `group`, `options`, `notifications`, `wallet`, `sites`, `wizard`, plus shared `common/errors/settings/account`
- [ ] Existing translated strings must not be overwritten unless they are clearly wrong or inconsistent

#### Batch Plan

- [ ] **P5-F1** — Batch 1: `de`, `fr`, `es` (in progress: shared prompt, wallet, sites, chat, group, notifications, options translated; small remainder still pending)
- [ ] **P5-F2** — Batch 2: `it`, `pt`, `nl`
- [ ] **P5-F3** — Batch 3: `sv`, `da`, `no`, `fi`
- [ ] **P5-F4** — Batch 4: `cs`, `ru`
- [ ] **P5-F5** — Batch 5: `ja`, `zh`
- [ ] **P5-F6** — Final QA sweep for wording consistency across shared product concepts:
  Signer, wallet, relays, groups, permissions, notifications, recovery words

#### Working State

- [ ] Status: in progress
- [ ] Last completed batch: none
- [ ] Next batch to execute: **P5-F1** (`de`, `fr`, `es`)
- [ ] Verification checkpoint after each batch:
  `npm run locales:check`
  `npx vitest run tests/locales.test.js`

---

## Stats

| Phase | Items | Done | Priority |
|-------|-------|------|----------|
| P0 — Ship Blockers | 17 | 17 | Critical |
| P1 — Enterprise | 22 | 21 | High |
| P1.5 — Test Coverage | 20 | 20 | High |
| P2 — UX Polish | 39 | 39 | Medium |
| P3 — nostr-core | 24 | 18 | Normal |
| P4 — Enterprise UI/UX | 19 | 16 | Normal |
| P5 — Release Hardening | 10 | 9 | Critical |
| **Total** | **151** | **140** | — |
