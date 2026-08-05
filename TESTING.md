# Testing Buho Jump

This guide is for testers who want to try Buho Jump before it lands in the
browser stores. You do **not** need to be a developer and you do **not** need to
build anything. Every release ships ready-to-load extension packages.

By the end you will have Buho Jump running in your browser toolbar, ready to test.

There are two ways to get there:

1. **[Load the prebuilt package](#1-load-the-prebuilt-package-recommended)** (recommended, no tools required).
2. **[Build from source](#2-build-from-source)** (only if you want the very latest code or plan to make changes).

Both load Buho Jump as an **unpacked** (Chrome) or **temporary** (Firefox)
extension. That is the normal way to test an unreleased extension. It behaves
exactly like the store version.

---

## Before you start

You need the extension package files. Download them from the latest
[GitHub Release](https://github.com/Buho-Ecosystem/Buho-Jump/releases):

- `buho-jump-<version>-chrome.zip` (Chrome, Brave, Edge, Opera, Vivaldi, Arc)
- `buho-jump-<version>-firefox.zip` (Firefox)

> [!NOTE]
> You will unzip that browser package in the steps below. Loading an extension
> always points at a **folder**, never at the `.zip` itself, so unzipping is
> required.

Pick your browser and follow the matching section.

---

## 1. Load the prebuilt package (recommended)

### Chrome, Brave, Edge, Opera, Vivaldi, Arc

These all use the same engine, so the steps are identical. The address differs
per browser (shown below).

1. **Unzip** the chrome package (for example `buho-jump-1.0.0-chrome.zip`). This
   creates a folder. Keep this folder somewhere permanent. The browser
   loads the extension live from it, so if you delete or move it, the extension
   stops working.
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
   - Opera / Vivaldi / Arc: their own `...://extensions` page, or use the menu
3. Turn on **Developer mode**. In Chrome, Brave, Opera, Vivaldi, and Arc it is a
   toggle in the **top right**. In Edge it is a toggle on the **left sidebar**.
4. Click **Load unpacked**.
5. In the file picker, select the **unzipped folder** (the one that directly
   contains `manifest.json`). Click **Select** / **Open**.
6. Buho Jump appears in the list and in your toolbar. Click the puzzle piece icon
   in the toolbar and **pin** Buho Jump so it stays visible.

> [!TIP]
> If **Load unpacked** is missing or greyed out, Developer mode is still off. Turn
> it on first (step 3), then the button appears.

### Firefox

1. **Unzip** the firefox package (for example `buho-jump-1.0.0-firefox.zip`).
2. In the address bar, go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**
4. In the file picker, open the unzipped folder and select the **`manifest.json`**
   file inside it.
5. Buho Jump appears under "Temporary Extensions" and in your toolbar.

> [!IMPORTANT]
> A **temporary** add-on is removed every time you **restart Firefox**. This is a
> Firefox rule for unsigned add-ons, not a bug. To test again after a restart,
> just repeat steps 2 to 4. Firefox **140 or newer** is required.

> [!TIP]
> Want it to survive restarts? Use Firefox **Developer Edition** or **Nightly**,
> set `xpinstall.signatures.required` to `false` in `about:config`, then install
> the `.zip` from the gear menu on `about:addons`.

---

## 2. Build from source

Only needed if you want the latest unreleased code or plan to change it.
**Requirements:** Node.js 20 or newer, npm 10 or newer.

```bash
git clone https://github.com/Buho-Ecosystem/Buho-Jump.git
cd Buho-Jump
npm ci
```

**Chrome:** run `npm run dev`, then load `.output/chrome-mv3` with **Load
unpacked** (see the Chrome steps above).

**Firefox:** run `npm run dev:firefox`, then load
`.output/firefox-mv3/manifest.json` with **Load Temporary Add-on** (see the
Firefox steps above).

Dev mode rebuilds and reloads automatically when you edit a file. To produce
store style packages instead, run `npm run zip:all`, which writes
`.output/buho-jump-1.0.0-{chrome,edge,firefox}.zip`.

Full developer setup lives in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Confirm it works

You have succeeded when the popup opens and you can sign in to a Nostr app. Run
this quick pass:

- [ ] Click the Buho Jump toolbar icon. The popup opens.
- [ ] Create a new account or import one, and set a master password.
- [ ] Lock the extension, then unlock it with your password.
- [ ] Open a Nostr web app (for example primal.net, iris.to, or snort.social),
      choose "log in with extension", and approve the permission prompt. The app
      logs you in.
- [ ] Optional: connect a wallet (NWC, Cashu, or LNbits) and confirm the balance
      loads.

> [!NOTE]
> When the extension is locked and a site asks to sign or pay, Buho Jump should
> first prompt you to **unlock**, then continue to the approval. If a request
> does nothing while locked, note it in your bug report.

---

## Updating to a newer test build

When you receive a newer package:

- **Chrome and Chromium browsers:** unzip the new package over the old folder (or
  into a new folder and re-point), then on the extensions page click the **reload**
  icon on the Buho Jump card.
- **Firefox:** unzip the new package, then load the new `manifest.json` again via
  **Load Temporary Add-on**.

To check which version you are running, open the extension's details and look at
the version number (the current package is `1.0.0`).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Load unpacked** is greyed out or missing | Turn on **Developer mode** first. |
| "Manifest file is missing or unreadable" | You selected the wrong folder. Select the folder that **directly contains** `manifest.json`. Some unzip tools nest it one level deeper. |
| You picked the `.zip` and nothing loaded | Unzip it first, then select the **folder** (Chrome) or the `manifest.json` (Firefox). |
| Firefox: "appears to be corrupt" | Select the `manifest.json` inside the unzipped folder, not the `.zip` and not the parent folder. |
| Extension is not in the toolbar | Click the puzzle piece icon and **pin** Buho Jump. |
| Firefox add-on vanished after restart | Expected for temporary add-ons. Load it again from `about:debugging`. |
| Popup is blank or shows an error | On the extensions page, click **reload** on the Buho Jump card, then reopen the popup. |
| Buho Jump stopped working after you moved files | The unzipped folder must stay in place. Restore it or load it again from the new location. |

---

## Reporting bugs

Open an [issue](https://github.com/Buho-Ecosystem/Buho-Jump/issues) with:

- What you expected versus what happened
- **Browser name and version** (for example Firefox 128, Chrome 126)
- Steps to reproduce, if you can
- A screenshot or screen recording, which helps a lot

For security issues, please do **not** open a public issue. See
[SECURITY.md](SECURITY.md) for private disclosure.

Thanks for testing 🦉
