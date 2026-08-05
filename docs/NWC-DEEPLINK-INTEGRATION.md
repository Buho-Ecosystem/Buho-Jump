# NWC Deep Link Integration - NUTbits

One-click wallet connection between Buho Jump and NUTbits via deep link redirect.

## How It Works

```
Buho Jump popup          NUTbits API (/connect)         Background.js
     |                         |                              |
     |-- NUTBITS_CONNECT ----->|                              |
     |   (background opens tab)|                              |
     |                         |                              |
     |                   [API creates dedicated               |
     |                    NWC connection (0 sats)]            |
     |                         |                              |
     |                   [Renders animated HTML page]         |
     |                         |                              |
     |                   [Page redirects to the extension's   |
     |                    nwc-callback.html                   |
     |                    ?value={nwc_string}&token={token}]  |
     |                         |                              |
     |                   [Callback page sends                 |
     |                    NUTBITS_CALLBACK -----------------> |
     |                         |                              |
     |                         |   [Verifies token, stores    |
     |                         |    wallet, initializes NWC]  |
     |                         |                              |
     |                   [Callback page shows success]        |
```

### Step-by-step

1. User clicks the **NUTbits** card in `WalletConnect.vue`
2. Popup sends `NUTBITS_CONNECT` message to `background.js`
3. Background builds the deep link URL and opens it in a new tab
4. The URL points to `{nutbitsApiUrl}/connect?appname=...&appicon=...&callback=...`
5. NUTbits API creates a **dedicated** NWC connection (0 sats balance) and returns a self-contained animated HTML page
6. The page redirects to the extension's `nwc-callback.html?value={nwc_string}&token={session_token}` after a brief animation
7. The callback page reads `value` and `token` and sends a `NUTBITS_CALLBACK` message to background
8. Background verifies the session token (then rotates it) and validates the NWC URI
9. Stores the wallet via `addWallet()` and initializes NWC
10. The callback page shows the success state

## How the Callback Works

The callback URL is the extension's own `nwc-callback.html` page. Two things make this possible:

- The manifest lists `nwc-callback.html` as a **web accessible resource** for `https://nutbits.drshift.dev/*`, so the NUTbits page is allowed to redirect to the `chrome-extension://` URL.
- `lib/nutbits.js` appends a random **per-session token** to the callback URL. Background verifies the token (constant-time compare) before accepting the NWC string, and rotates it after use, so a stray or replayed redirect cannot inject a wallet connection.

## Dedicated Connections

NUTbits creates all deep link connections as **dedicated** - they have their own isolated balance (starts at 0 sats). The user must fund the connection through NUTbits (`POST /api/v1/connections/:pubkey/fund`).

- `get_balance` returns the dedicated balance, not the global wallet
- `pay_invoice` deducts from the dedicated balance
- `make_invoice` credits the dedicated balance

## Files

| File | Role |
|------|------|
| `lib/nutbits.js` | Constants, `buildNutbitsDeepLink()`, callback token create/verify/rotate |
| `components/wallet/WalletConnect.vue` | NUTbits button in wallet type picker |
| `entrypoints/background.js` | `NUTBITS_CONNECT` handler (tab + intercept) |
| `entrypoints/nwc-callback/` | Confirmation page (success/error states) |
| `public/NUTbits/` | NUTbits logo assets |
| `locales/*.json` | `nutbits.*` i18n keys |

## Deep Link URL Format

```
{nutbitsApiUrl}/connect?appname=Buho+Jump&appicon={extensionIconUrl}&callback={callbackUrl}
```

- **appname** - matched against NUTbits app registry for pre-configured permissions/budgets
- **appicon** - `chrome.runtime.getURL('logo/icon-256x256.png')`
- **callback** - the extension's `nwc-callback.html` URL with the per-session token

## Configuration

The NUTbits API URL is in `lib/nutbits.js`:

```js
export const NUTBITS_URL = 'https://nutbits.drshift.dev'
```

## Error Handling

The callback page (`entrypoints/nwc-callback/App.vue`) shows an error state when:

| Case | Trigger |
|------|---------|
| Missing value | NUTbits redirected without a `value` parameter |
| Invalid request | The session token is missing or does not match (`INVALID_REQUEST`) |
| Connect failed | `addWallet()` or NWC init threw; the wallet entry is rolled back |
