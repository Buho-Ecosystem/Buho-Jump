# NWC Deep Link Integration — NUTbits

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
     |                   [Page auto-redirects to              |
     |                    callback?value={nwc_string}]        |
     |                         |                              |
     |                         |--- tabs.onUpdated fires ---->|
     |                         |                              |
     |                         |   [Intercepts URL, extracts  |
     |                         |    NWC string, stores wallet]|
     |                         |                              |
     |                   [Tab navigates to                    |
     |                    nwc-callback.html?success=1]        |
     |                         |                              |
     |                   [Confirmation page auto-closes]      |
```

### Step-by-step

1. User clicks the **NUTbits** card in `WalletConnect.vue`
2. Popup sends `NUTBITS_CONNECT` message to `background.js`
3. Background builds the deep link URL and opens it in a new tab
4. The URL points to `{nutbitsApiUrl}/connect?appname=...&appicon=...&callback=...`
5. NUTbits API creates a **dedicated** NWC connection (0 sats balance) and returns a self-contained animated HTML page
6. The page auto-redirects to `callback?value={nwc_string}` after a brief animation
7. `chrome.tabs.onUpdated` in background.js intercepts the redirect URL
8. Background extracts and validates the NWC URI
9. Stores the wallet via `addWallet()` and initializes NWC
10. Navigates the tab to `nwc-callback.html?success=1` (confirmation page)
11. Confirmation page shows success, auto-closes after 3 seconds

## Why a Dummy Callback URL?

Chrome blocks web pages from redirecting to `chrome-extension://` URLs. When the NUTbits page tries `window.location.href = 'chrome-extension://...'`, Chrome mangles it to `chrome-extension://invalid/` and the NWC value is lost.

**Solution:** We use a dummy HTTP callback URL (`http://127.0.0.1:19816/buho-nwc-callback`). Nothing listens there, but `chrome.tabs.onUpdated` fires with the full URL — including the `?value=` parameter — before the page fails to load. Background intercepts it and navigates to the real extension confirmation page.

## Dedicated Connections

NUTbits creates all deep link connections as **dedicated** — they have their own isolated balance (starts at 0 sats). The user must fund the connection through NUTbits (`POST /api/v1/connections/:pubkey/fund`).

- `get_balance` returns the dedicated balance, not the global wallet
- `pay_invoice` deducts from the dedicated balance
- `make_invoice` credits the dedicated balance

## Files

| File | Role |
|------|------|
| `lib/nutbits.js` | Constants + `buildNutbitsDeepLink()` |
| `components/wallet/WalletConnect.vue` | NUTbits button in wallet type picker |
| `entrypoints/background.js` | `NUTBITS_CONNECT` handler (tab + intercept) |
| `entrypoints/nwc-callback/` | Confirmation page (success/error states) |
| `public/NUTbits/` | NUTbits logo assets |
| `locales/*.json` | `nutbits.*` i18n keys |

## Deep Link URL Format

```
{nutbitsApiUrl}/connect?appname=Buho+Jump&appicon={extensionIconUrl}&callback={callbackUrl}
```

- **appname** — matched against NUTbits app registry for pre-configured permissions/budgets
- **appicon** — `chrome.runtime.getURL('logo/icon-256x256.png')`
- **callback** — dummy HTTP URL intercepted by `tabs.onUpdated`

## Configuration

The NUTbits API URL is in `lib/nutbits.js`:

```js
export const NUTBITS_URL = 'http://localhost:3338'
```

## Error Handling

| Error | Trigger |
|-------|---------|
| `no_value` | NUTbits redirected without a `value` parameter |
| `invalid` | Value doesn't start with `nostr+walletconnect://` |
| `connect_failed` | `addWallet()` or NWC init threw an error |

Background navigates to `nwc-callback.html?error={code}` for each case.

A 2-minute safety timeout cleans up the tab listeners if nothing happens (e.g. NUTbits API is unreachable).
