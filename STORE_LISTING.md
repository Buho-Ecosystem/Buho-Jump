# Store Listing — Buho Jump

## Short Description (132 chars max)
Your Bitcoin Lightning wallet and companion for Nostr apps, social identity, encrypted messaging and instant payments.

## Detailed Description (Chrome Web Store + Firefox AMO)

Buho Jump is your all-in-one Nostr companion for the browser. Manage your digital identity, send Bitcoin Lightning payments, and chat with end-to-end encryption — all from a single extension.

**Identity & Key Management**
- Create or import Nostr accounts (nsec, mnemonic seed phrase)
- Connect remote signers like Amber via NIP-46 (QR scan or paste)
- NIP-07 provider — sign in to any Nostr web app seamlessly
- Multiple accounts with easy switching
- Per-site permission control — you decide who gets access

**Lightning Wallet**
- Connect any NWC-compatible wallet (Buho Wallet, Alby, Coinos, Minibits, and more)
- Send and receive Bitcoin payments instantly
- Multiple wallet support with one-click switching
- WebLN provider for in-browser payments
- Budget controls and spending allowances per site
- Fiat conversion with 19 currencies

**Encrypted Messaging**
- Private 1:1 chats with NIP-17 end-to-end encryption
- Group chats: Private groups, relay communities (NIP-29), and open channels (NIP-28)
- Contact search via follow list, NIP-05, or Nostr relay search
- Zap friends directly from the chat

**Security First**
- All keys encrypted at rest with AES-256-GCM
- Master password with PBKDF2 key derivation (100k iterations)
- Session unlocked during browser session, locks on close
- No analytics, no telemetry, no tracking
- Fully open source (AGPL-3.0 License)

**Built with nostr-core**
22 Nostr protocol implementations (NIP-02, 04, 05, 06, 07, 11, 17, 19, 24, 28, 29, 42, 44, 46, 47, 50, 51, 57, 59, 65) — all powered by nostr-core.

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
| Content script on all URLs | Inject the NIP-07 (window.nostr) and WebLN (window.webln) provider APIs so Nostr and Lightning web apps can interact with the extension. The content script only bridges messages — it does not read or modify page content. |

## Privacy Declarations (Chrome Dashboard)

**Does your extension collect personal or sensitive user data?** Yes

| Data type | Collected? | Sent externally? |
|---|---|---|
| Authentication info | Yes (Nostr keys, stored locally encrypted) | Only signed events to user-configured relays |
| Financial and payment info | Yes (NWC wallet connection, stored locally encrypted) | Payment requests to user's wallet provider |
| Personal communications | Yes (encrypted chat messages, stored locally) | Encrypted messages sent to user-configured relays |
| Website activity | No | No |
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

## Screenshots Needed (1280x800 px)

1. **Lock screen** — clean password entry with Buho Jump branding
2. **Identity card** — profile with NIP-05, pubkey, connected sites
3. **Wallet home** — balance card with send/receive + recent transactions
4. **Chat view** — conversation list with DMs and groups
5. **Group chat** — group thread with multi-sender bubbles

## Promotional Tile (440x280 px)
Buho Jump logo + tagline: "Your Nostr Identity & Lightning Wallet"
