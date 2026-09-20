# Buho Jump UX Review

Reviewed 2026-09-20 against commit `ed80231` (main). Scope: every user-facing screen of the popup, the permission and unlock prompt, the full settings tab, the content bridge, and all 17 locale files. Lens: the four tester reports plus the Apple Human Interface Guidelines (clarity, deference, consistency, legibility, hit targets, progressive disclosure, terminology).

The findings and line numbers below describe the original commit. Implementation status was updated on 2026-09-20; see [decisions and validation](docs/UX_DECISIONS.md).

Line numbers refer to the files at that commit. Fix the whole family listed under "Also appears in", not only the screen the tester saw.

Priorities: **P0** the tester reports and anything that blocks a plain sign-in. **P1** consistency and legibility problems a beta user hits within a day. **P2** polish and drift.

---

## 1. Tester reports, mapped

### R1. Inactive accounts cannot be identified (P0)

**What the tester saw:** the "Switch account" list shows a coloured "?" circle, a "Lokal" badge and a truncated npub. No picture, no name, no NIP-05.

**Why:**
- `GET_ACCOUNTS` returns only `id, name, npub, mode` (`lib/accounts.js:361`). The kind-0 profile (picture, display name, NIP-05) is fetched for the active account only (`entrypoints/popup/App.vue:225-239`, `:487-491`).
- `name` is empty for imported and recovered accounts because the wizard passes `undefined` (`components/IdentityWizard.vue:351`, `:270-276`) and the store defaults to `''` (`lib/accounts.js:142, 174, 235, 290, 318`). The avatar letter is `(acc.name || '?')[0]`, so the row shows "?".
- Remote-signer accounts are named with a hardcoded English "Remote Signer" (`IdentityWizard.vue:82`, `:373`).

**Where:**
- [x] Popup account list `entrypoints/popup/App.vue:1128-1174`
- [x] Options account list `components/options/AccountPage.vue:598-636`
- [x] Switch confirmation sheet `popup/App.vue:1177-1207`, `AccountPage.vue:646-670`
- [x] Delete confirmation sheet `popup/App.vue:1210-1283`, `AccountPage.vue:673-688`
- [x] Recovery candidate list already shows the profile name (`IdentityWizard.vue:1021-1046`); the prompt account card already fetches the picture (`entrypoints/prompt/App.vue:665-684`). Reuse that.

**Fix:** batch-fetch kind-0 profiles for every stored account (the contact profile cache in `composables/useContacts.js` already does this for chat) and render picture, display name and NIP-05 with the npub as a third line. Seed `name` from the profile at import time so lists never fall back to "?". Name remote-signer accounts after the signer's profile.

### R2. "Always trust" takes too many clicks and the window is too small (P0)

**What the tester saw:** the common choice "immer vertrauen" is hidden behind "More options", and the prompt always has to be scrolled to reach it.

**Measured** (built extension at `.output/chrome-mv3`, Chromium window sizes from `entrypoints/background.js:387-389`; the outer height includes the title bar, so the viewport is about 28 px shorter):

| Prompt | Window | Viewport | Content height | Overflow | "Not now" starts at | "More options" starts at |
|---|---|---|---|---|---|---|
| Sign event, kind 1 | 420 x 600 | 420 x 572 | 668 px | 96 px | 562 px (cut) | 616 px (off screen) |
| Sign in (getPublicKey) | 420 x 520 | 420 x 492 | 627 px | 135 px | 521 px (off screen) | 575 px (off screen) |

Screenshots: `prompt-signevent-572.png`, `prompt-getpublickey-492.png` (attached to the review page).

**Why:**
- Level-1 actions are "Allow for this visit" and "Not now"; "Always allow" and "Always deny" sit behind a "More options" toggle at 11 px (`entrypoints/prompt/App.vue:743-782`, `:763-781`).
- "Always allow" is stored per method and, for signing, per event kind (`background.js:3292-3294`, `lib/permissions.js:47-52`). Trusting a site therefore means separate approvals for sign-in, each post type, encrypt, decrypt and wallet connect. A one-shot `allow_all` decision exists in the background (`background.js:340-345`, `:3278-3283`) and its strings exist in every locale (`prompt.allowAll*`), but no screen uses it. `PRODUCT_TREE.md:460` lists it as deferred while the docs screenshot `public/Images/Request_permission.png` still shows it.
- The window is a fixed 420 x 520 or 600 (`background.js:387-389`), 400 x 440 for unlock (`:477`), never resized to content and never clamped to the screen (`lib/browser/capabilities.js:35-52`).
- Content above the buttons is padded with things that are not decisions: full origin line (`prompt/App.vue:562`), risk pill plus kind pill (`:585-594`), explanatory paragraph (`:640-642`), "Technical details" toggle row always visible (`:645-662`), an account card (`:666-684`), a hint sentence under the primary button (`:754`).

**Fix:**
- Level 1 shows three choices without scrolling: primary "Sign in" or "Allow", secondary "Always allow on jumble.social" (maps to `allow_all` for non-payment methods), tertiary "Not now". Keep per-kind rules in Site details, not in the prompt.
- Pin the action group to the bottom of the window (sticky footer) so decisions never scroll away; let only the content area scroll.
- Size the window to content: the prompt reports its `scrollHeight` and the background calls `chrome.windows.update`, or open at 420 x 680 and design the content to fit 560 px in the common case.
- Collapse the explanatory paragraph and the JSON toggle into one "Details" disclosure; drop the origin line into the site header; replace the account card with one line (avatar, name).

**Also appears in:** the unlock prompt opens as a second window before the permission window (`background.js:455-485`), so a locked user sees two popups in a row for one sign-in. Consider unlocking inside the permission window.

### R3. The extension window must always be big enough (P0)

Rules the review derived so this stops recurring:

| Surface | Current size | Constraint | Where |
|---|---|---|---|
| Permission prompt | 420 x 520 / 600 fixed | Size to content or 420 x 680; actions pinned bottom | `background.js:387-389` |
| Unlock prompt | 400 x 440 fixed | Fits today; keep actions pinned | `background.js:477` |
| Toolbar popup | 380 x 520 to 600 | Chrome caps popups at 600 px, so every popup screen must put its primary action within the first 500 px (header 52 px, tab bar 40 px) | `assets/main.css:108-116` |
| Detached popup window | 400 x 640 | Fine | `entrypoints/popup/App.vue:540-546` |
| Bottom sheets | content max 55 vh (about 330 px inside the popup) | Wallet selector with three wallets scrolls inside the sheet; reduce sheet padding, allow 70 vh | `components/BottomSheet.vue:77` |
| Send and receive panels | max 92 vh | Fine | `components/SlidePanel.vue:28` |
| Wizard recovery list | max 310 px | Fine | `components/IdentityWizard.vue:1020` |

- [x] Add a size contract to `CONTRIBUTING.md` and a test that renders each prompt variant at its window size and asserts no vertical overflow (the Playwright harness from the July tester bugs can drive it).

### R4. Wording is too technical; the core job is a simple sign-in (P0)

**Sign-in framing.** The most common prompt (a site asking for the public key) says "wants to access your account", "See your public profile", "Read only" (`prompt/App.vue:146-153`, `:557`; `locales/en.json prompt.wantsAccess, permPublicLabel, permPublicWhat, permPublicDetail, permPublicRisk`). Users know this moment as "Log in with Buho".
- [x] Headline "Sign in to Jumble?" with one sentence: "Jumble will see your public profile. Nothing is posted without asking you." Primary button "Sign in".
- [x] Same treatment for the two other login kinds already labelled "Sign in" (`prompt.actionLoginLabel`, `prompt.kindRelayAuth`, `prompt.kindHttpAuth`).

**Jargon inventory** (each item: where it is shown, then the plain replacement):

| # | Term as shown | Where | Plain replacement |
|---|---|---|---|
| J1 | "Extension" / "Remote Signer" badge on every account (German: "Lokal" / "Extern") | `popup/App.vue:719-733`, `:987-995`, `:1154-1159`; `AccountPage.vue:344-350`, `:620-623`; `prompt/App.vue:681-683`; keys `account.local, onThisDevice, external, externalSigner` | No badge for normal accounts; "Signer app" only for NIP-46 |
| J2 | npub / hex / nprofile / nostr: format cycler | `popup/App.vue:92-118`, `:1023-1028` | Show npub only, copy button; other formats under Advanced in settings |
| J3 | Placeholders `nsec1... or hex key`, `bunker://... or nostrconnect://...`, `wss://relay.example.com`, `LNURL1... or keyauth://...`, `nostr+walletconnect://...`, `admin key`, `https://your-lnbits.com` | `wizard.backupKeyPlaceholder`, `wizard.connectionPlaceholder`, `relay.addPlaceholder`, `lightningLogin.codePlaceholder`; `WalletConnect.vue:196, 251, 267` | "Paste your secret key", "Paste the link from your signer app", "Paste the server address" |
| J4 | "NIP-05 address" | `account.profileNip05`, `AccountPage.vue:446` | "Verified name (name@domain)" |
| J5 | "kind 1" suffix on visit permissions; raw `signEvent` fallback | `SiteDetail.vue:219`, `:48-59` | Use `eventKindLabel` everywhere; never show a kind number |
| J6 | "Encrypt messages (v2)" / "Read messages (v2)" | `sites.methodLabel_nip44_*` | Merge into "Send private messages" / "Read private messages" |
| J7 | "Recovery-word identity", "Single-key identity", "Remote signer identity", derivation path `m/44'/…` | `AccountPage.vue:368-388`, keys `account.identityType…` | "Backed up with 12 words" / "Backed up with a secret key"; path under Advanced |
| J8 | "Relay Settings", "wss://", "Publish relay list", "Fetch from network", NIP number list with English-only names | `RelaySettings.vue:196, 207-211, 319-359`; `RelayInfoSheet.vue:29-37` | The app already says "server" elsewhere (`prompt.kindRelayList`, `relay.empty`). Use "Servers" everywhere; move NIP list under Details |
| J9 | "Payment hash", "Preimage", "Payment proof", hardcoded "LUD-21 verify URL" | `TransactionDetail.vue:261-264`; `SendFlow.vue:1883-1891` | Keep under "Technical details" only; label "Delivery check link" |
| J10 | "Supported NUTs", "NUT-{nuts}", "proofs", "deterministic proofs" | `cashu.supportedNuts`, `cashu.mintMissingRequired`, `wallet.backupReadyDesc`, `wallet.relayBackupReadyDesc`, `wallet.restoreFromWordsDesc` | "This mint is missing required safety features"; "saved eCash"; "eCash created from your recovery words" |
| J11 | "Admin Key", "NWC", "Nostr Wallet Connect", "LNbits URL" | `WalletConnect.vue:150, 176, 245-256` | Keep product names, explain in one line what to paste and where to find it |
| J12 | "keysend … directly to a node" | `prompt.permKeysendWhat` | "Send sats directly, without an invoice" |
| J13 | "Copy address" (copies an npub), "User npub…" placeholder names | `ChatThread.vue:158-165`, `:466-471`; `ContactPicker.vue:171-178`; `ConversationItem.vue:57-64`; `MessagingPage.vue:84-89` | "Copy profile link"; placeholder "Unknown user" until the profile loads |
| J14 | "Published to {n} relays" pill on every sent bubble | `ChatBubble.vue:210-218` | Single check; relay list under long-press |
| J15 | Protocol line "NIP-07 · NIP-44" and raw JSON | `prompt/App.vue:341-348`, `:650-662` | Fine behind Details; the toggle row itself should not be visible by default |

**Terminology drift** (one concept, three words): "Add Account", "Switch account", "Remove identity", "Create New Identity", "I Already Have an Account", "Account & Identity", German "Konto" and "Identität" side by side (`en.json account.*, wizard.*, options.account`; `de.json` same keys).
- [x] Decide: "account" is the thing you switch and remove; "profile" is the public information. Apply across all 17 locales.

---

## 2. Findings from the full review

### L. Localization (P0)

| ID | Finding | Where | Fix |
|---|---|---|---|
| L1 | Half the app is still English in most locales. Multi-word strings identical to English: de 238, es 239, fr 239, hi 238, th 241; cs, da, fi, it, ja, nl, no, pt, ru, sv, zh about 488 each (of 1078 keys). For a German tester the prompt's primary button "Allow for this visit", its hint, "More options" and "Technical details" are English. Whole areas untranslated: every `prompt.action*` headline (the kind-specific "Publish a post" etc.), Lightning Login, eCash recovery, Branta, mobile money, budgets, the profile editor, backup verification. | `locales/de.json` keys `prompt.allowForVisit, prompt.allowForVisitHint, common.more, prompt.technicalDetails, prompt.hideTechnicalDetails, prompt.action*`; all other locale files | Translate; extend `scripts/locales.mjs --check` to fail when a value equals English |
| L2 | Hardcoded English outside the locale files | `TransactionHistory.vue:157` "tx"; `popup/App.vue:1054` and `AccountPage.vue:409` "LNURL set"; `SendFlow.vue:1165` "Unknown", `:1486` "Retailer", `:1134` "This retailer"; `IdentityWizard.vue:1084, 1142, 1213` "Anonymous", `:82, 373` "Remote Signer"; `ChatThread.vue:70-75` expiry labels; `MessageActions.vue:23-29` reaction labels; `RelayInfoSheet.vue:29-37` NIP names; `popup/App.vue:623, 778, 1169` title attributes | Move to locale keys |
| L3 | Browser notifications are English only: "New Message", "Payment Received", "You received {n} sats", "{n} sats auto-approved" | `lib/notifications.js` notifyDm, notifyPayment, notifyBudgetSpend | Localize in the background with the stored locale |
| L4 | 59 unused locale keys, including the whole `prompt.allowAll*` set and `wallet.removeWalletWarning` | `locales/en.json` | Delete or wire up (the allowAll set is needed for R2) |

### T. Typography and legibility (P1)

| ID | Finding | Where | Fix |
|---|---|---|---|
| T1 | 115 uses of 7 to 9 px text and 274 uses of 10 px across the UI. HIG floor for legible text is about 11 pt; captions 12. Worst files: `popup/App.vue` (26), `TransactionDetail.vue` (10), `SiteDetail.vue` (10), `AccountPage.vue` (9), `NotificationSettings.vue` (9). Examples: account badge 7 px (`popup/App.vue:720, 724`), fiat pill 8 px (`TransactionItem.vue:122, 128`), wizard step labels 8 px (`IdentityWizard.vue:545-548`), section eyebrows 9 to 10 px everywhere | all components | Define a type scale (caption 12, body 13 to 14, title 15 to 17) as Tailwind theme sizes and forbid `text-[…px]` under 12 with a lint rule |
| T2 | Muted text fails contrast: dark `#6D6D6D` on `#0C0C0C` is 3.78:1, on cards 3.36:1; light `#9CA3AF` on white is 2.54:1. The primary button in light mode (white on `#059573`) is 3.78:1 at 13 to 14 px bold. WCAG AA needs 4.5:1 for text under 18 px | `themes/tokens.js` text-muted and brand-primary (light) for all six themes | Lift text-muted to about `#8A8A8A` dark and `#6B7280` light; darken light brand to about `#047A5E` for button fills |
| T3 | Capitalization is mixed: 74 Title Case labels ("Set Password", "Add Account", "Connect Wallet", "Send Payment") against 352 sentence case ("Allow for this visit", "Not now") | `locales/en.json` | Pick sentence case for everything except product names; apply to all locales |

### H. Hit targets and discoverability (P1)

| ID | Finding | Where | Fix |
|---|---|---|---|
| H1 | 37 icon buttons with `p-0.5` or `p-1` padding and 12 to 14 px icons give about 20 px targets. HIG minimum is 28 pt on macOS, 44 pt for touch | `SiteDetail.vue:221-226, 242-247` revoke; `popup/App.vue:1029-1036` QR and copy; `WalletHome.vue:169-179` refresh; `OpenInBrowserButton.vue:19-26`; `RelaySettings.vue:268-274`; sheet close buttons | Minimum 32 x 32 px targets (`p-2` with 16 px icons) |
| H2 | Essential controls only appear on hover: delete account, rename and remove wallet, remove relay. Invisible on touch screens, for keyboard users and for anyone who does not hover | `popup/App.vue:1164-1172`; `AccountPage.vue:628-634`; `WalletSelector.vue:209`; `WalletPage.vue:219`; `RelaySettings.vue:270` | Always-visible secondary control or a row menu |
| H3 | The delete-account control is a `<span role="button">` with no `tabindex` or key handler | `popup/App.vue:1164-1172`, `AccountPage.vue:628-634` | Real `<button>` |
| H4 | "More options" (29 px tall, 11 px text) and the "Technical details" toggle (11 px) are the smallest controls on the most important screen | `prompt/App.vue:763-767`, `:645-649` | Covered by R2 |
| H5 | Chat message actions require a 500 ms long press or right click; nothing on the bubble hints at it | `ChatBubble.vue:28-40`, `:127-130` | Show a small "…" on hover and focus; keep long press |

### P. Hierarchy and progressive disclosure (P1)

| ID | Finding | Where | Fix |
|---|---|---|---|
| P1 | Frequent actions hidden, rare ones exposed: "Always allow" hidden (R2) while "Disconnect Wallet" sits on the wallet home, "Publish relay list" and "Fetch from network" on the relay page, the eCash share link under Send | `WalletHome.vue:305-311`; `RelaySettings.vue:319-359`; `SendFlow.vue:1311-1318` | Move destructive and advanced actions to the settings tab or a row menu |
| P2 | The Account view is reached only by tapping your own name in the header; the tab bar has Wallet and Chat only. "Switch account" and "Add account" are effectively hidden | `popup/App.vue:180-182, 701-737`; `components/popup/BottomTabs.vue`; key `tabs.account` exists unused | Third tab "Account", or an avatar button with a visible caret and menu |
| P3 | The 380 px header holds avatar, name (max 90 px), mode badge, wallet chip (max 140 px) with balance, pop-out button and gear. Names truncate to "ZapTracker - …" and "My LNb…" | `popup/App.vue:699-870` | Header: avatar, page title, gear. Wallet name and balance belong in the wallet tab |
| P4 | Settings dropdown mixes theme dots, currency, language, lock and deep links, with "All settings" as a 10 px footer link | `popup/App.vue:783-868` | Dropdown: Lock, Settings. Everything else in Preferences |
| P5 | Onboarding runs nine screens before the first sign-in: welcome (2), password, choose mode, name, show words, verify words, profile, done. Then the first site visit adds unlock plus permission windows | `WelcomeScreen.vue`, `LockScreen.vue`, `IdentityWizard.vue` | Default path: name, then done. Move word verification behind the existing backup reminder banner (`lock.backupReminder`); make the profile step opt-in |

### C. Consistency (P1)

| ID | Finding | Where | Fix |
|---|---|---|---|
| C1 | Same action, two words: "Disconnect Wallet" on the wallet home vs "Remove" in the selector and Wallets page. `wallet.disconnectDesc` says "paste your wallet connection link again", which is wrong for the built-in eCash wallet | `WalletHome.vue:310`; `WalletSelector.vue:253`; `WalletPage.vue:275`; keys `wallet.disconnectWallet, disconnectDesc, removeWalletDesc` | One verb ("Remove wallet") and copy per wallet type; eCash removal must mention the balance |
| C2 | Delete-account sheets differ: the popup one warns about backup and the owned eCash wallet and offers "Back up key in Settings"; the options one has a single sentence, although Settings is where the backup lives | `popup/App.vue:1210-1283` vs `AccountPage.vue:673-688` | One shared `DeleteAccountSheet` component |
| C3 | Five back-button styles: `p-1` arrow (`SiteDetail.vue:194`), `w-8 h-8` box (`SendFlow.vue:1014-1020`), text link "Back" (`IdentityWizard.vue:638`), round 20 px arrow (`ChatThread.vue:439`), text link inside a card (`LightningLogin.vue:145`) | as listed | One `BackButton` component |
| C4 | The options relay page shows two headings: the page's own and the shared component's | `entrypoints/options/App.vue:125-151`; `RelaySettings.vue:196` | `hideBack` should also hide the inner header |
| C5 | Currency and theme pickers differ between popup and Preferences (code only vs code plus name; dark-only dots vs both swatches) | `popup/App.vue:794-805, 1409-1427`; `PreferencesPage.vue:141-164, 225-242` | Shared picker components |
| C6 | Mobile-money rows use an emoji (📱) in the list and a Lucide icon in the receipt | `TransactionItem.vue:99` vs `TransactionDetail.vue:76` | Lucide icon in both |
| C7 | Status colour semantics: a local account is success green, a connected remote signer is warning amber | `popup/App.vue:725-731, 987-995`; `AccountPage.vue:344-350` | Amber only for "reconnecting" or errors |
| C8 | Version "1.0.0" hardcoded twice | `popup/App.vue:866`; `AboutPage.vue:35` | Read `chrome.runtime.getManifest().version` |
| C9 | Two unlock designs: the popup lock screen and the prompt's unlock mode | `components/LockScreen.vue` vs `prompt/App.vue:449-534` | One component |
| C10 | Popup and options each re-implement the notification toggles | `NotificationSettings.vue` vs `PreferencesPage.vue:245-368` | Shared component |

### S. Feedback, states and safety (P1)

| ID | Finding | Where | Fix |
|---|---|---|---|
| S1 | "Report" in the message long-press menu does nothing: the thread emits `report`, the popup never listens, and `ReportDialog.vue` is never imported | `ChatThread.vue:225-228, 514`; `ChatBubble.vue:121`; `MessageActions.vue:110-114`; `popup/App.vue:1354-1359` | Mount the dialog in a bottom sheet from the thread |
| S2 | Tapping the backdrop closes the Send or Receive panel mid-flow. Send's back button protects a freshly created eCash token; the panel close does not. Receive's back button discards a live invoice with no confirmation | `popup/App.vue:1378-1385`; `SlidePanel.vue:23`; `SendFlow.vue:954-965`; `ReceiveFlow.vue:491` | Panel asks the flow before closing; confirm when money or a live invoice is on screen |
| S3 | The QR scanner never tries the camera inside the extension, including the settings tab and the detached window where it would work; the text "Camera is not available in extension popups" appears everywhere | `QrScanner.vue:16-23` | Detect the popup context by window type, not by `chrome.runtime.id` |
| S4 | "Block this site" has no UI. The background supports `deny_all` and a blocklist, the product tree says Live, the docs screenshot shows it | `background.js:3284-3288`; `lib/blocklist.js`; `PRODUCT_TREE.md:147`; `public/Images/Request_permission.png` | Add "Block" under the prompt's Details and in Site details |
| S5 | After one "Not now", the page bridge refuses every further request until the page is reloaded and the site gets "Access denied. Reload the page to try again." The user is never told | `entrypoints/content.js:69, 80-83, 110-113` | Reset after a cooldown or show a toast from the popup; at minimum explain in Site details |
| S6 | Toasts render over the header and cover the gear and wallet controls | `ToastContainer.vue:25` | Bottom of the popup, above the tab bar |
| S7 | `getRelays` has no lock or permission gate unlike every other page method | `background.js:547-565` | Gate like the siblings |
| S8 | The Messaging settings page lists conversations and contacts but rows are not clickable | `MessagingPage.vue:126-145, 157-170` | Open the thread in the full page, or drop the page |

### D. Documentation drift (P2)

| ID | Finding | Where |
|---|---|---|
| D1 | Product tree claims "Block unwanted websites" and "Combine simultaneous permission requests" as Live; screenshots show the old "Connect this site" prompt | `PRODUCT_TREE.md:143-149`; `public/Images/Request_permission.png` |
| D2 | Popup screenshot in the store assets shows the truncated header (P3) | `public/Images/Extension_social_identity.png` |

---

## 3. Fix list by priority

**P0 — implemented**
- [x] R2 Prompt: level-1 "Always allow on {site}" via `allow_all`, sticky action footer, window sized to content, content diet.
- [x] R4 Sign-in framing: "Sign in to {site}?" headline and "Sign in" primary for getPublicKey and the two login kinds.
- [x] L1 Translate the prompt strings and `prompt.action*` in all 16 locales; then the rest.
- [x] R1 Account rows: profile picture, display name, NIP-05; seed `name` on import; remote-signer naming.
- [x] R3 Size contract plus overflow test for every prompt variant.
- [x] J1 Remove the "Extension" badge from normal accounts.

**P1 — implemented**
- [x] J2 to J15 wording pass, then the account/identity/profile decision across locales.
- [x] T1 type scale with a 12 px floor; T2 contrast tokens; T3 sentence case.
- [x] H1 to H5 hit targets, hover-only controls, keyboard access.
- [x] P2 Account tab; P3 header diet; P4 dropdown diet; P1 move rare actions.
- [x] C1, C2, C3, C9, C10 shared components; C4, C5, C6, C7, C8 quick fixes.
- [x] S1 report dialog; S2 panel close guard; S3 camera; S4 block; S5 denial reset; S6 toast position; S7 getRelays gate; S8 messaging rows.
- [x] L2, L3 hardcoded strings and notifications.

**P2 — implemented**
- [x] P5 shorter onboarding.
- [x] L4 unused keys; D1, D2 docs and screenshots.

Suggested order of work: R2 and R4 together (one prompt redesign), then L1, then R1, then the wording table, then everything else by file so each component is touched once.


## 4. Resolution and verification

All listed implementation tasks are addressed. These checkboxes record implementation and the automated checks below; they do not certify a complete native Apple HIG audit or native-speaker review of every translation.

- **R1:** `AccountIdentity.vue` supplies cached profile pictures, names, profile addresses, and public identifiers to all four account-row surfaces. Metadata refresh does not block navigation. Missing metadata has an account icon; imported/remote account names are seeded when profiles arrive.
- **R2/R3/R4:** the prompt has a fixed footer with one-time approval, explicit site trust, and Not now. Content scrolls within the window. Payments never offer site-wide approval. Sign-in wording covers public-profile requests and both authentication kinds. Full origins and authentication destinations remain visible. Window geometry is bounded to the available browser-window geometry; Firefox retains its tab fallback.
- **L1/L2/L3/L4:** all 17 locales have matching keys and variables, no empty values, and no copied multi-word English outside intentional product names/formats. All message templates compile. German, core prompts, and the five remaining Czech/Nordic drafts were written directly; other untranslated passages received a machine draft and a terminology pass. Native-speaker editorial review is still needed. Notifications, reaction labels, and expiry durations use the selected language. Removed 82 obsolete messages per locale across the old prompt, removed screens, and unused copy.
- **T/H:** 12px caption floor; AA contrast for muted, secondary, and brand text across base/card/elevated/hover surfaces in all six themes and both appearances; visible secondary controls, real buttons, shared back controls, keyboard focus, touch targets, and reduced-motion support.
- **P/C:** explicit Account tab, simplified header/settings menu, shared account/removal/unlock/theme/notification components, consistent mobile-money icon, and manifest version. Currency settings have one screen. New account creation goes from name to done; backup and profile editing are optional actions. The backup reminder now appears immediately until verification succeeds. Password protection remains required.
- **S:** the report dialog works and explains that reports are public. Payment-panel dismissal consults the active flow; a fresh eCash token survives Escape/backdrop dismissal and an active incoming request asks before closing. Camera detection distinguishes action popups from tabs/windows. Site blocking clears stale grants and budgets; payment handlers check blocks before spending allowances. Account changes invalidate approvals. `getRelays` requires unlock and approval. Denial cooldown permits retries. Messaging settings opens threads. Toasts appear above the tabs.
- **D:** product tree and prompt/account screenshots updated. `UX_REVIEW.md` and `signal-*.png` are excluded from source release archives.

Validation: 790 unit tests in 58 files; Chrome and Firefox production builds; strict locale checks; 500 rendered prompt cases across 17 locales plus large-text/light-dark checks, slow metadata, account rows/switch confirmation, eCash dismissal, nested receive confirmation, and shortened account creation. Screenshots use synthetic data. No real account, signer, website login, payment, or camera was exercised.

Deliberate interpretations: a Nostr profile address is **not** labelled “verified”; window decoration sizes vary, so the fixed-footer layout is tested at the original 492px and 572px viewports; server delivery details remain available from the visible message status control. Combining unlock and approval into one window was a suggestion in R2, not an implemented change; both now share the same unlock component.
