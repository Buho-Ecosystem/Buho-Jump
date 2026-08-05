# Store Listing - Buho Jump

## Short Description (132 chars max)
Your Nostr identity, encrypted chat, and a Bitcoin Lightning and ecash wallet. All in your browser, all yours. (109 chars)

## Detailed Description (Chrome Web Store + Firefox AMO)

Buho Jump puts your online identity, your messages, and your money back in your hands, right inside your browser.

Sign in to Nostr apps as yourself. Send and receive Bitcoin in one tap. Message anyone with end-to-end encryption. No account with us, no middleman, no tracking.

Setup takes about a minute. Buho Jump creates your identity and a ready-to-use wallet for you, with plain-language steps and no jargon. Everything stays encrypted on your device and unlocks with one password.

**A Bitcoin wallet, ready instantly**
- Three wallet types, your choice: Cashu ecash (works out of the box), Nostr Wallet Connect (Alby Hub, Coinos, Minibits), and LNbits
- Send and receive Lightning payments in seconds
- Create and pay standard Cashu payment requests, so other wallets can pay you (NUT-18 and NUT-26)
- Share large ecash tokens as animated QR codes (NUT-16)
- Restore your list of mints from your recovery words (NUT-27)
- Pay a Lightning invoice, a Lightning Address, an LNURL, or a Nostr profile, all from one box
- Spending budgets and per-site allowances you control
- See amounts in your own currency, 19 supported
- Pay with Bitcoin at South African stores through SnapScan, Zapper, and Scan to Pay

**Private messaging**
- One-to-one chats with NIP-17 end-to-end encryption
- Find people by follow list, NIP-05 name, or relay search
- Send a zap right from the conversation

**One identity, or many**
- A recoverable 12-word identity you can restore anywhere
- Keep several identities and switch in a tap, each with its own wallet, chats, and site permissions
- Bring your own key from another app, or keep your keys on a remote signer like Amber (NIP-46)
- Sign in to any Nostr web app through the standard NIP-07 provider
- Clear, friendly permission prompts that show exactly what a site is asking for, with technical details tucked away

**Yours, and only yours**
- Every key is encrypted on your device with AES-256-GCM
- Master password protected with PBKDF2-SHA256 (600,000 iterations)
- Auto-lock timer, and it locks when the browser closes
- No analytics, no telemetry, no tracking, ever
- Fully open source under the AGPL-3.0 license
- Available in 17 languages

**Identity & Key Management**
- Create a recoverable BIP-39 identity and derive Nostr accounts through NIP-06
- Restore used NIP-06 account paths from the same recovery words
- Lightning Login with private per-website LUD-05 keys and user-approved LUD-04 signatures
- Import standalone Nostr keys with a clear explanation that seed-only features are unavailable
- Connect remote signers like Amber via NIP-46 (QR scan or paste)
- NIP-07 provider - sign in to any Nostr web app seamlessly
- Multiple accounts with easy switching
- Beginner-friendly permission prompts with visit-only defaults and optional technical details
- Request-storm protection combines repeated permission questions without grouping payments

**Lightning Wallet**
- Three wallet types: NWC (Alby Hub, Coinos, Minibits), Cashu (ecash), and LNbits
- Send and receive Bitcoin payments instantly
- Create and pay Cashu payment requests (NUT-18)
- Animated QR codes for large ecash tokens
- Restore your mint list from your recovery words (NUT-27)
- Multiple wallets with one-click switching
- WebLN provider for in-browser payments
- Budget controls and spending allowances per site
- Fiat conversion with 19 currencies
- Shop online with Bitcoin in South Africa - works with MoneyBadger-supported stores via SnapScan, Zapper, and Scan to Pay

**Encrypted Messaging**
- Private 1:1 chats with NIP-17 end-to-end encryption
- Contact search via follow list, NIP-05, or Nostr relay search
- Zap friends directly from the chat

**Security First**
- All keys encrypted at rest with AES-256-GCM
- Master password with PBKDF2-SHA256 key derivation (600,000 iterations)
- Session unlocked during browser session, locks on close
- No analytics, no telemetry, no tracking
- Fully open source (AGPL-3.0 License)

**Built with nostr-core**
Identity, signing, relay, private messaging, wallet, and safety protocols are powered by nostr-core. This includes NIP-47 wallet connections and NIP-60 encrypted Cashu wallet backups.

---

## Category
- **Chrome**: Privacy & Security
- **Firefox**: Privacy & Security, Other

## Tags / Keywords
nostr, bitcoin, lightning, wallet, nip-07, webln, encrypted messaging, privacy, identity

## Permission Justifications

| Permission | Justification |
|---|---|
| `storage` | Store encrypted keys, wallet connections, chat messages, site permissions, and user preferences locally on the device. No data is sent to external servers. |
| `tabs` | Open the full settings page in a new browser tab. Required by the options page. |
| `windows` (Chrome only) | Display permission approval prompts in a popup window when websites request access to your Nostr identity or Lightning wallet. |
| `notifications` | Show browser notifications for incoming encrypted messages and Lightning payments. |
| `alarms` | Power the optional auto-lock security timer that locks the extension after inactivity. |
| `https://mint.minibits.cash/*` | Connect the built-in eCash wallet to its default mint. Other mint origins are not granted at installation. |
| `https://guardrail.branta.pro/*` | Perform optional strict-privacy merchant verification. The setting can be disabled and verification never blocks a payment. |
| `https://api.coingecko.com/*` | Load the public Bitcoin exchange rate for the fiat currency selected in Jump. No wallet or identity data is included. |
| Optional HTTPS website access | Requested for an exact confirmed origin when the user uses Lightning Login, a custom mint, LNbits, a Lightning Address, LNURL, or another user-selected payment service. It is not granted at installation. |
| Content script on all URLs | Inject the NIP-07 (window.nostr) and WebLN (window.webln) provider APIs so Nostr and Lightning web apps can interact with the extension. The content script only bridges messages - it does not read or modify page content. |

## Privacy Declarations (Chrome Dashboard)

**Does your extension collect personal or sensitive user data?** Yes

| Data type | Collected? | Sent externally? |
|---|---|---|
| Authentication info | Yes (Nostr keys and recovery words, stored locally encrypted) | Signed Nostr events to user-configured relays and user-approved LUD-04 responses to the displayed website |
| Financial and payment info | Yes (NWC wallet connection, stored locally encrypted) | Payment requests to user's wallet provider |
| Personal communications | Yes (encrypted chat messages, stored locally) | Encrypted messages sent to user-configured relays |
| Website activity | Yes (approved Nostr sites and Lightning Login domains, stored locally) | Only the signed login response to the website the user approves |
| Location | No | No |
| Health info | No | No |
| Web browsing history | No | No |
| User identifiers | No | No |

**Is data shared with third parties?** No
**Is data sold?** No

## Firefox Data Collection Permissions

```json
"data_collection_permissions": {
  "required": [
    "authenticationInfo",
    "financialAndPaymentInfo",
    "personalCommunications"
  ],
  "optional": []
}
```

## Screenshots (1280x800 px), generated, in store-assets/screenshots/

1. `01-welcome-1.png` - "Your keys. Your Bitcoin." welcome and onboarding
2. `02-wallet-home.png` - "A wallet, ready instantly." wallet home with balance
3. `03-receive-invoice.png` - "Get paid in seconds." Lightning invoice with QR
4. `04-receive-request.png` - "Request ecash payments." Cashu payment request with QR
5. `05-send-detect.png` - "Send to anyone." send box with smart detection
6. `06-chat-or-sites.png` - "Private by default." encrypted messaging

Regenerate with the Playwright script in scratchpad if the UI changes. Clean 400x600 popup captures are in store-assets/raw/.

## Promotional Tile (440x280 px)
Buho Jump logo + tagline: "Your Nostr Identity & Lightning Wallet"
