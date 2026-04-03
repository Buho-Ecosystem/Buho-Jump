# NWC Deep Link Integration — NUTbits

One-click wallet connection between Buho Jump and NUTbits via deep link redirect.

## How It Works

```
Buho Jump popup                 NUTbits instance              Callback page
     |                               |                             |
     |-- user clicks "NUTbits" ----->|                             |
     |   (opens tab with deep link)  |                             |
     |                               |-- user approves wallet ---->|
     |                               |   (redirects to callback)   |
     |                               |                             |
     |<---------- background.js receives NWC URI via message ------|
     |   (stores wallet, closes tab)                               |
```

### Step-by-step

1. User clicks the **NUTbits** card in `WalletConnect.vue`
2. `handleConnectNutbits()` builds a deep link URL and opens it in a new tab
3. The deep link points to `{nutbitsUrl}/connect?appname=...&appicon=...&callback=...`
4. The `callback` param is the extension's `nwc-callback.html` page
5. NUTbits shows its approval screen; user authorizes the connection
6. NUTbits redirects to `nwc-callback.html?value={nwc_uri}`
7. The callback page (`App.vue`) reads the `value` query param
8. It validates the URI starts with `nostr+walletconnect://`
9. It sends `NWC_DEEPLINK_CONNECT` message to `background.js`
10. Background stores the wallet via `addWallet()` and initializes NWC
11. Callback page shows success, auto-closes after 2 seconds

## Files

| File | Role |
|------|------|
| `lib/nutbits.js` | Builds the deep link URL (`buildNutbitsDeepLink`) |
| `components/wallet/WalletConnect.vue` | NUTbits button in wallet type picker |
| `entrypoints/nwc-callback/index.html` | WXT entrypoint (opens in tab) |
| `entrypoints/nwc-callback/main.js` | Vue app bootstrap |
| `entrypoints/nwc-callback/App.vue` | Callback page UI + logic |
| `entrypoints/background.js` | `NWC_DEEPLINK_CONNECT` handler (reuses `CONNECT_WALLET`) |
| `public/NUTbits/` | NUTbits logo assets (pixel-nut SVG + PNGs) |
| `locales/*.json` | `nutbits.*` i18n keys |

## Deep Link URL Format

```
{nutbitsUrl}/connect?appname=Buho+Jump&appicon={extensionIconUrl}&callback={callbackUrl}
```

- **appname** — displayed to the user in NUTbits approval screen
- **appicon** — `chrome.runtime.getURL('logo/icon-256x256.png')`
- **callback** — `chrome.runtime.getURL('nwc-callback.html')`

## Callback URL Format

NUTbits redirects back with the NWC connection string:

```
chrome-extension://{id}/nwc-callback.html?value={encoded_nwc_uri}
```

The `value` parameter is a URL-encoded `nostr+walletconnect://` URI.

## Configuration

The NUTbits instance URL is configured in `lib/nutbits.js`:

```js
export const NUTBITS_URL = 'http://localhost:8080'
```

For production, update this to the user's NUTbits instance URL or make it configurable via settings.

## Error Handling

The callback page handles three failure cases:

1. **No value param** — NUTbits redirected without a connection string
2. **Invalid URI** — value doesn't start with `nostr+walletconnect://`
3. **Background error** — `addWallet()` or NWC init failed

Each shows an error screen with a close button.

## i18n Keys

All strings are under the `nutbits` namespace in locale files:

- `nutbits.oneClick` — badge label on the button
- `nutbits.connectDesc` — button description text
- `nutbits.callbackConnecting` — connecting spinner text
- `nutbits.callbackWait` — connecting subtitle
- `nutbits.callbackSuccess` — success message
- `nutbits.callbackClosing` — auto-close notice
- `nutbits.callbackFailed` — error title
- `nutbits.callbackNoValue` — missing value error
- `nutbits.callbackInvalid` — invalid URI error

## Future Improvements

- [ ] Make NUTbits instance URL configurable in Options page (Preferences)
- [ ] Support multiple NUTbits instances
- [ ] Add NUTbits connection status indicator in wallet list
