# Built Different

## The technical architecture behind Buho Jump

---

This one's for the developers. If you want to understand how Buho Jump is built, what decisions we made, and why — here's the full picture.

### The stack

**WXT** (Web Extension Toolkit) for the build system. Handles manifest generation, hot reload, multi-browser builds (Chrome MV3, Firefox MV2, Edge), and entrypoint routing. One config file, four browser targets.

**Vue 3** with Composition API for all UI. No Options API anywhere. Reactive state via `ref()` and `computed()`. Composables for shared logic.

**Tailwind CSS v4** with CSS custom properties for theming. No hardcoded colors in components — everything goes through semantic tokens (`--brand-primary`, `--surface-card`, `--text-muted`). Theme switching is a `setProperty` loop on `:root`.

**nostr-core** (our own library) for all Nostr protocol logic. NIPs, crypto, NWC client, LNURL, BOLT-11 parsing, relay management. The extension is a UI layer on top of nostr-core. If you want to build a different Nostr app, you can use nostr-core directly.

**Vitest** for testing. 563 tests across 27 files covering every lib module and most composables.

### Architecture: five entrypoints

The extension has five entrypoints, each with a distinct role:

**1. Background service worker** (`background.js`, ~1400 lines)
The brain. Handles all state management, NWC connections, NIP-46 signing, permission enforcement, crypto operations. All message handlers follow a pattern:

```
case 'ACTION_NAME': {
  // validate input
  // do work
  // return { result } or { error: classifyError(err) }
}
```

Every handler is wrapped in a try-catch. Errors go through `classifyError()` which maps raw messages to structured codes (`NO_WALLET`, `TIMEOUT`, `INSUFFICIENT_BALANCE`). The outer boundary has a `.catch()` on the `handle()` promise so `sendResponse` always fires — the frontend never hangs.

**2. Content script** (`content.js`)
Injects `window.nostr` and `window.webln` into web pages. Bridges page-level events to background via `chrome.runtime.sendMessage`. All messages go through the `PUBLIC` route, separated from internal routes. Validates `chrome.runtime.id` to detect extension context invalidation. Posts responses to `window.location.origin` (not `*`) to prevent iframe interception.

**3. Popup** (`popup/App.vue`)
The main UI. 380px wide, tabbed (wallet, chat, identity). Communicates with background exclusively through `useMessaging.send()` which adds timeouts (15s default, 45s for relay ops) and translates error codes to i18n keys.

**4. Prompt window** (`prompt/App.vue`)
Separate window for permission requests and unlock prompts. Opened by the background when a site needs approval. Shows site metadata (favicon, title, domain), the specific permission being requested, and — for kind 27235 events — a formatted HTTP auth display instead of raw JSON.

**5. Options page** (`options/App.vue`)
Full browser tab with sidebar navigation. Deep-linked via `?page=` query params. Covers accounts, wallets, relays, messaging, preferences, and about. Reuses the same lock screen as the popup.

### State management

No Vuex. No Pinia. State lives in two places:

**Composables** — singleton reactive state shared across components. `useWallet()`, `useChat()`, `useAccounts()`, etc. Each composable owns its domain. They talk to the background via `useMessaging.send()`.

**chrome.storage.local** — persistent state. Encrypted secrets (accounts, wallets), relay configs, chat messages, permissions, settings. All writes go through `verifiedSet()` which writes then reads back to confirm persistence. If the write fails, it retries once and then throws.

### Security layers

1. **AES-256-GCM** for secrets at rest. PBKDF2 with 100k iterations for key derivation.
2. **Session password** — exists only in service worker memory. Wiped on lock/close. Fallback to `chrome.storage.local` for browsers without `chrome.storage.session`.
3. **Per-domain permissions** — granular per-method, per-event-kind. Anti-spam rejects an origin after a permission denial until page reload.
4. **Content script isolation** — all page requests go through the `PUBLIC` route. Internal routes (`GET_ACCOUNTS`, `EXPORT_NSEC`) are only accessible from extension pages.
5. **Input sanitization** — custom emoji rendering HTML-escapes content before inserting `<img>` tags. Success action URLs only render as links for `https://`. Relay URLs reject non-`wss://` protocols.

### Error handling philosophy

Three levels:

**Background → Frontend:** Structured error codes via `classifyError()`. The frontend gets `NO_WALLET`, not "Cannot read property 'getBalance' of null".

**Frontend → User:** Error codes mapped to i18n keys via `useMessaging`. The user sees "No wallet connected" in their language, not a code.

**Silent failures → Logger:** `lib/logger.js` captures errors in a ring buffer (200 entries). Debounced writes every 5 seconds. Exportable as JSON for bug reports. Every catch block that used to be silent now logs with module name, error code, and context.

### Chat architecture

Messages are stored per-account in `chrome.storage.local` under `chatMessages_{pubkey}`. O(1) dedup via ID sets. Dirty tracking — only writes to storage when messages actually change. Timestamp-based subscription scoping so EOSE queries don't re-fetch the entire history.

Three group types share the same UI but different protocols:
- Private groups: NIP-17 gift wraps to each member (E2E encrypted)
- Relay communities: NIP-29 relay-enforced access (kinds 9, 9000-9005)
- Open channels: NIP-28 public events (kinds 40, 41, 42)

Account switching triggers a full reset: close NWC, disconnect signer, clear relay auth, reset chat subscriptions, load new account's messages. The `performAccountSwitch()` function handles this atomically with a `_accountSwitching` flag that blocks in-flight NWC requests.

### What we'd do differently

Honestly? Not much. The composable architecture scales well. nostr-core as a separate library was the right call — protocol changes don't require extension changes. WXT handles the multi-browser build better than any alternative we tried.

If we started over, we might use a typed RPC layer between popup and background instead of the string-based `type` + `params` pattern. But that's a refactor, not a redesign.

### Contributing

MIT license. Fork it, read the code, send PRs. The test suite runs in under 2 seconds. The build takes under 3 seconds. There's a `BACKLOG.md` with 151 items tracking everything from the original audit to Phase 5 hardening.

The codebase is intentionally readable. Short functions. Clear naming. Comments explain *why*, not *what*. No abstractions for the sake of abstractions.

---

*Built with WXT + Vue 3 + Tailwind CSS v4 + nostr-core. 1.9 MB build. 563 tests. Ships for Chrome, Firefox, Edge, and Brave.*
