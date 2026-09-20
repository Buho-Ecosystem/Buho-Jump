# Application-wide HIG review

Reviewed 2026-09-20. Scope: every user-facing application screen, with representative nested states. UI/UX only. Technical findings are in [TECHNICAL_BUGS.md](TECHNICAL_BUGS.md).

The product should open as a familiar account/login tool. Wallet and chat remain available as clearly named destinations. This review applies Apple's interaction, hierarchy, legibility, and accessibility guidance to a browser extension; it does not claim native SwiftUI behavior or blanket HIG certification.

## Evidence and method

- Inspected all four Vue application entrypoints: popup, permission prompt, settings, and wallet connection callback. Enumerated the eight settings pages and all screen/dialog components beneath them.
- Rendered real Vue components with deterministic synthetic accounts, transactions, messages, and permissions. External HTTP and WebSocket traffic was blocked. Rare states were injected into component state explicitly, without executing real payments or recovery.
- `scripts/review-screens.mjs` generates a screenshot gallery and `evidence.json` in `/private/tmp/buho-hig-screens`. Each case records rendered text, dimensions, unnamed visible controls, small targets, nested buttons, dialog names, and runtime errors. The case definitions are in `scripts/ux-review/fixtures.mjs`.
- Reviewed the screenshot inventory visually and inspected individual problem screens at full resolution. Default isolated-component viewport is 380×700px; the popup retains its own 520–600px container constraints; settings were also rendered at 900/1024px and 390px. German/dark-mode cases cover the main forms, confirmation sheets, and narrow settings navigation. This is representative variation, not every screen in every locale/theme combination.
- Separately, `scripts/check-prompt-layout.mjs` renders the production bundle: 500 prompt/viewport/locale cases, plus trust/block/failure interactions, enlarged text, account sheets, onboarding completion, and eCash dismissal protection. It also blocks external traffic.
- Shared colors are measured in all six themes and both modes. Status foregrounds are tested on three surfaces and their 15% status tints; colored button foregrounds are also tested.
- Decorative illustrations, logos, and the static store promotional tile are assets, not additional application flows. They were considered in their containing screens.

## Design references

The following are the design criteria used below, accessed during this review. Apple's HIG pages were read through their official documentation JSON where the website required JavaScript.

| Code | Source | Application to this extension |
| --- | --- | --- |
| N | [Navigation and search](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search), [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | Stable labelled destinations, clear current location, compact navigation when width is limited. |
| T | [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | System font, readable hierarchy, text resizing, contrast, spoken control names, keyboard access. |
| F | [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | Labels remain understandable after typing; controls describe their actions and provide adequate targets. |
| S | [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) | Named task surfaces, predictable dismissal, focused confirmations, explicit destructive consequences. |
| O | [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding), [Writing](https://developer.apple.com/design/human-interface-guidelines/writing) | Help people reach the task quickly, explain only what they need now, describe results plainly. |
| L | [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Adapt to available space and translated text, preserve content and essential controls. |
| D | [Nostr Design: sign in/sign up](https://nostrdesign.org/docs/how-to/sign-in-sign-up/), [impostor prevention](https://nostrdesign.org/docs/how-to/impostor-prevention/) | Account-first framing, optional advanced setup, and no claim that a profile address proves a person's identity. |

## Changes made in this pass

| Finding and evidence | UI change | Criteria |
| --- | --- | --- |
| Popup opened on Wallet; Account was the last tab. Profile header toggled between unrelated destinations. | Account is first and opens by default. Header consistently opens Account; explicit wallet/chat links still select their destinations. Arrow keys and Home/End operate the tab bar; tabs identify their content panel. | N, O, D |
| At narrow settings widths, eight navigation buttons extended into a horizontal strip. | A labelled native destination picker replaces the narrow strip. Wide settings retain a sidebar with current-page semantics. | N, L, T |
| Custom font and hover lifts made utility controls feel more decorative. | System font stack, restrained press feedback, no primary-button/card hover translation. Existing reduced-motion support remains. | T, F |
| Several light status colors measured below 4.5:1; warnings reached approximately 2.46:1 on one surface. | Separate status foreground tokens preserve readable messages without changing the meaning of background colors. Contrast tests cover every theme and both modes. | T |
| Notification/payment-safety switches were 36×20px pointer targets. Several small actions were only 12–16px high. | Reusable switch with a 44px target; shared desktop button minimum 32px, touch minimum 44px. These are this product's web target choices, not a claim that HIG requires one size on all platforms. | T, F |
| Setup/profile/wallet/chat fields and icon actions lacked accessible names. Profile/password/wallet-name fields depended on placeholders. | Associated persistent labels where placeholders were the only labels; spoken names matching the task elsewhere; named reveal, remove, save, cancel, and copy controls. | T, F |
| German recovery step labels overflowed the 380px frame. Optional backup/profile screens misleadingly showed the Done step. | Numbered progress with the current translated step below it; optional follow-up screens omit completed setup progress. | L, O |
| Account capability text said “Backed up with 12 words” while the same card said “Backup needed.” | Use the existing translated “Recovery words” label for the recovery method. Actual verification status stays separate. | O, D |
| Relay information implemented its own overlay without the shared dialog/focus behavior. Sheets displayed a grabber without drag behavior. | Reuse BottomSheet, retain a visible close action, add missing confirmation titles, remove the misleading grabber, and constrain long sheets to the viewport. | S, T |
| Relay and secondary-wallet rows nested action buttons inside another button. | Independent row-selection and management buttons, with explicit spoken action names. | T, F |
| Chat search text overlapped its search icon because unlayered input CSS defeated padding utilities. | Put the reusable input style in the component layer so layout utilities can reserve icon space. | F, L |
| Chat history collapsed in popup/settings. The component had multiple roots and conflicting height classes. | One layout root with usable flex sizing; the settings height and popup constraints now reach the message region. Rendered regression checks require more than 200px of message-history space in both contexts. | L |
| Chat content-warning reveal and profile-menu triggers used non-keyboard controls. | Native buttons, expanded state, named dismissal, and Escape handling for the conversation menu. | T, F |
| Wallet callback success automatically disappeared after three seconds. | Keep success visible until Done, giving people time to read the outcome. | O, S |
| German Lightning Login approval still said “Approve.” | “Anmelden.” | O |

## Screen-by-screen review

Each checked row was reviewed in rendered form. “Retained” means the current pattern was suitable for this pass; it does not certify every possible state or interaction. Case names identify screenshots and fixtures. Shared improvements above also apply to retained screens.

| Reviewed | Screen / surface | Evidence cases | HIG comparison and outcome |
| --- | --- | --- | --- |
| [x] | Welcome and initial language selection | `WelcomeScreen`, `welcome-language` | O, F: one entry action, short capability explanation, language available before setup. Retained. |
| [x] | Create password, strength/mismatch errors | `setup-password`, `setup-password-error` | F, T, O: persistent labels, reveal control, requirement and recovery limitation visible. Retained; shared focus/system typography improvements. |
| [x] | Unlock / incorrect password / originating website | `LockScreen`, `unlock-error`, production unlock variants | F, S: focused password task and explicit cancellation; origin remains readable. Retained. |
| [x] | Add account / advanced choices | `IdentityWizard`, `wizard-choose-advanced` | O, D: create/import prominent; recovery and signer choices secondary. Retained. |
| [x] | New account name | `wizard-new`, German variant | O, F: short form, named input, clear next action. Progress improved. |
| [x] | Import key / scanner entry | `wizard-import`, `camera-unavailable` | F, D: secret-key purpose and source explained; reveal and scanner controls named. |
| [x] | Recover with words / account number | `wizard-recover`, German variant | O, F, L: privacy explanation stays adjacent to recovery; progress no longer overflows. |
| [x] | Select recovered account | `wizard-recover-select` | D, F: names and public identifiers distinguish choices before importing. Retained. |
| [x] | Signer link / QR / connected screen | `wizard-remote`, `wizard-remote-qr`, `wizard-remote-done` | O, D: separate advanced route, connection outcome visible. Retained; input named. |
| [x] | Save and verify account backup | `wizard-backup`, `wizard-backup-verify` | O, S: deliberate reveal, explicit loss warning and verification. Optional task no longer claims to be setup completion. |
| [x] | Optional profile / recovered profile | `wizard-profile`, `wizard-recover-profile` | O, F: skippable profile step with named inputs. Retained. |
| [x] | Account completion / import completion | `wizard-done`, `wizard-import-done` | O: primary completion action precedes optional backup/profile/toolbar guidance. Retained. |
| [x] | Popup account / details / account navigation | `popup-account`, `popup-details`, German variant; production account list | N, D: Account first/default, consistent header behavior, names and copy action available. |
| [x] | Popup settings menu | `popup-settings` | N, F: short menu for locking and all settings. Retained. |
| [x] | Account settings / profile editor | `AccountPage`, `profile-edit`, `settings-account` | F, D: persistent profile labels; recovery capability no longer claims completed backup. |
| [x] | Switch / remove account | `account-switch`, `delete-account`, German variant; production switch sheet | S: named account and consequences before confirmation, cancellation available. Retained with shared sheet changes. |
| [x] | Export account backup: authenticate, reveal, verify, done | `account-backup-auth`, `account-backup-show`, `account-backup-verify`, `account-backup-done` | S, F: secret reveal and backup verification are deliberate; labelled password and confirmation fields. |
| [x] | Lightning Login: unavailable, enter, confirm, result, error | `LightningLogin`, `lightning-unavailable`, `lightning-input`, `lightning-confirm`, `lightning-result`, `lightning-error` | O, D: optional separate flow with website origin before approval; German primary action corrected. |
| [x] | Connected sites, popup/settings | `ConnectedSitesPage`, `popup-sites`, `settings-sites` | N, D: website list leads to its permissions; named back/search controls. |
| [x] | Site permissions, budget, revocation | `site-detail`, `revoke-site`, `SiteContextBar` | S, F: permissions and payment budget remain distinct; revocation has a named confirmation and individually named controls. |
| [x] | Permission requests / event previews / payments / unlock | 500 production cases in `check-prompt-layout.mjs` | S, L, O: primary choice, visible website trust option, cancellation, scrollable details; actions remain visible at measured prompt sizes and enlarged text. Existing pattern retained. |
| [x] | Wallet home / no wallet / site spending context | `WalletHome`, `NoWalletHome`, `popup-wallet`, `SiteContextBar` | N, O: wallet is an optional destination with explicit send/receive actions and actionable empty state. Retained. |
| [x] | Wallet picker / rename / remove | `wallet-switch`, `wallet-rename`, `wallet-remove` | S, F: separate selection/management targets and named save/cancel; removal consequences visible. |
| [x] | Wallet connection choices / NWC / LNbits | `WalletConnect`, `connect-nwc`, `connect-lnbits`, German variant | O, F: provider-specific instructions remain on their own screens; wallet-name/connection fields have labels. |
| [x] | Wallet settings | `WalletPage`, `settings-wallets` | N, F: account wallet management and backup grouped together; named rename field. |
| [x] | Mint details / change / confirmation / explanation / access | `mint-details`, `mint-change`, `mint-confirm`, `mint-explainer`, `mint-permission` | S, F: advanced change stays deliberate; service host and balance consequences visible; close/input controls named. |
| [x] | Wallet file / network / word recovery | `CashuBackupSection`, `backup-password`, `backup-import`, `backup-relay`, `backup-words` | S, O: preview and permission step before restoring; recovery routes explained. Retained with readable status text. |
| [x] | Send input / errors / confirmation | `SendFlow`, `send-error`, `send-confirm` | F, S: review before payment, recipient visible, protocol detail secondary; fields named. |
| [x] | Retail quote / expired quote / withdrawal / eCash request | `send-merchant-confirm`, `send-quote-expired`, `send-withdraw-confirm`, `send-request-confirm` | S, O: amount and consequence precede action; expired quote offers a concrete recovery action. Retained. |
| [x] | Share eCash / failed delivery / payment result | `send-ecash-share`, `send-fallback`, `send-result`; production eCash guard | S: token remains recoverable, delivery failure is distinct from success, explicit completion. Retained. |
| [x] | Receive form / eCash / invoice / request / new mint / success / close | `ReceiveFlow`, `receive-ecash`, `receive-invoice`, `receive-request`, `receive-mint-review`, `receive-success`, `receive-close`, `receive-error` | F, S: named amount/memo inputs, copy alongside QR, explicit unresolved-request dismissal and mint review. |
| [x] | Transaction list / receipt states / activity | `TransactionHistory`, `receipt-settled`, `receipt-pending`, `receipt-failed`, `receipt-expired`, `ActivityPage`, `settings-activity` | N, T: text and icons identify status; details and private note remain secondary; note/wallet selector named. |
| [x] | Chat list / empty / contacts / search | `ChatHome`, `chat-empty`, `ContactPicker`, `contacts-results`, `popup-chat` | O, F: actionable empty state, visible search text clear of its icon, named fields. |
| [x] | Conversation / reply / compose options / tip / message actions | `ChatThread`, `chat-menu`, `chat-compose-options`, `chat-zap`, `message-actions`, `chat-reply`, `popup-thread` | N, L, F: usable history height, keyboard-accessible menu/reveal controls, named composer and tip amount. |
| [x] | Sensitive-message reveal / public report | `chat-content-warning`, `ReportDialog`, `chat-report-sheet`, German variant | S, T: reveal is a real button; report explains public disclosure before submission; selection state is announced. |
| [x] | Settings conversations / contacts / thread | `settings-messages`, `settings-contacts`, `settings-thread` | N, L: same conversation pattern as popup; corrected height propagation. |
| [x] | Servers / details / technical metadata / remove / reset | `RelaySettings`, `relay-info`, `relay-technical`, `relay-remove`, `relay-reset`, `settings-relays` | S, F: shared named sheet/focus handling, separate row actions, advanced details secondary. |
| [x] | Preferences / language / theme / currency / password change | `PreferencesPage`, `LanguagePicker`, `ThemePicker`, `currency-picker`, `password-change`, `settings-preferences`, `settings-narrow` | N, F, T: compact narrow navigation, persistent password labels, reusable accessible switches. |
| [x] | Notification categories / quiet-hours controls | `NotificationSettings`, `notifications-quiet`, embedded preferences | T, F: 44px switch targets with spoken state; time controls named. |
| [x] | About | `AboutPage`, `settings-about` | O: product/version first, credits and implementation references secondary. Retained. |
| [x] | Wallet connection callback: waiting, success, error | `callback-connecting`, `callback-success`, `callback-error` | O: clear outcome; success now waits for Done instead of closing on a timer. |
| [x] | Shared feedback, scanner, QR, sheets, panels, loading | `toast-success`, `error-retry`, `camera-unavailable`, payment/backup/report cases and production panel checks | T, S: nonblocking feedback, actionable errors, copy alternative to QR, named/dismissible task surfaces. |

## Verification and remaining limits

| Check | Result |
| --- | --- |
| Rendered inventory | 151 cases passed; 41 distinct mounted screen/component types, with shared child components reviewed in context. Six targeted form cases were rerun after final label alignment. |
| Visible controls / dialogs | No unnamed visible controls, unnamed rendered dialogs, or nested buttons in the final inventory. |
| Horizontal layout | No document overflow in the final cases, including the three enlarged-text cases. |
| Keyboard | Account tabs operate with arrows/Home; relay details retain focus inside the dialog. |
| Conversation layout | Popup and settings message regions each exceed 200px in the rendered fixtures. |
| Production prompt suite | 500 cases passed, plus trust/block/failure, enlarged-text, account, onboarding, and eCash dismissal assertions. |
| Locale / color checks | Locale validation and 34 targeted tests passed. |
| Production build | Chrome MV3 build passed. Existing bundle-size/dynamic-import advisory warnings remain. |


The local browser evidence is reproducible; it is not a live-service integration test. Verify real signer, wallet, relay, camera-permission, and recovery interactions separately before release. Native-language proofreading and a human VoiceOver pass remain appropriate release checks; this review does not claim either was performed.

The remaining technical finding is documented separately. No background, content-script, permissions, wallet-engine, signing, or storage implementation was changed in this UI pass. Earlier uncommitted work in those files predates this review and was preserved.

To reproduce:

```sh
npm run build
node scripts/review-screens.mjs
npm run test:ui
npm run locales:check
npm test -- tests/ux-contract.test.js tests/locales.test.js
```

The visual runner requires a local Chromium installation supported by Playwright, or `BROWSER_PATH`. It serves only local files and blocks external requests. `UX_SCREENSHOTS` overrides its output directory; `UX_FILTER` (or the first CLI argument) selects case IDs by regular expression. A second CLI argument selects a separate evidence directory for targeted follow-up checks. The review-only host and documents are excluded from WXT source release archives.
