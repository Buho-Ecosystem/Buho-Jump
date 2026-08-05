# Releasing to Firefox Add-ons (AMO)

Builds are produced by CI, not by hand. `.github/workflows/release.yml` runs on
every push to `main`: it installs, tests, builds all three store packages, and
lints the Firefox package with `web-ext`. When the version in `package.json` has
no GitHub Release yet, it also publishes one with the packages attached.

Always submit the CI artifacts, never a local build. The AMO reviewer rebuilds
from source and diffs the result, and CI pins the toolchain that the reviewer
notes below describe.

## Cutting a release

1. Bump `version` in `package.json`. That is the only place it lives: WXT reads
   it into the manifest, and CI tags `v<version>` from it.
2. Merge to `main`.
3. Wait for the **Release** workflow. It attaches four files to the new release:

   | File | Goes to |
   | --- | --- |
   | `buho-jump-<version>-firefox.zip` | AMO, as the extension package |
   | `buho-jump-<version>-sources.zip` | AMO, as the source code upload |
   | `buho-jump-<version>-chrome.zip` | Chrome Web Store |
   | `buho-jump-<version>-edge.zip` | Microsoft Edge Add-ons |

A version containing a hyphen (`1.1.0-beta.1`) is published as a prerelease.
Pushing to `main` without bumping the version still builds and validates, and
keeps the packages as workflow artifacts for 30 days.

## Submitting to AMO

1. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
   2FA is mandatory for developer accounts. Submit from the org account: the
   extension ID `@buho-jump` is permanently bound to whoever uploads first.
2. **Submit a New Add-on**, choose **On this site** (listed and reviewed).
3. Upload `buho-jump-<version>-firefox.zip`.
4. Answer **yes** to "Do you use minified, concatenated or machine-generated
   code?" and upload `buho-jump-<version>-sources.zip`. This is required because
   the extension is bundled with Vite. See Mozilla's
   [source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
   policy.
5. Paste the reviewer notes below into the notes field.
6. Fill the listing from [STORE_LISTING.md](../STORE_LISTING.md): description,
   category Privacy & Security, screenshots, support URL, and a publicly
   reachable privacy policy URL.

Buho Jump declares `financialAndPaymentInfo` and `authenticationInfo` data
collection, so it gets a manual human review. Expect days, not hours.

## Reviewer notes

```
Build environment: Node 24, npm 10+
1. npm ci
2. npm run build:firefox
Output: .output/firefox-mv3/ (matches the uploaded package)

Build tool: WXT (https://wxt.dev), a wrapper around Vite. All build tooling is
open source and cross-platform. package-lock.json is included in the sources.

Code is minified for size only. No obfuscation is used.

The web-ext UNSAFE_VAR_ASSIGNMENT warning in chunks/main-*.js comes from the
Vue 3 runtime-dom internals (insertStaticContent / patchElement), not from
application code. Buho Jump does not assign untrusted data to innerHTML.

Source layout:
  entrypoints/  background worker, content script, popup, options, prompt
  lib/          protocol and wallet logic
  components/   Vue single-file components
```

## Firefox specifics worth remembering

- `strict_min_version` is `140.0` (Android `142.0`) because
  `data_collection_permissions` is only honoured from those versions on. Lowering
  it means users below 140 never see the data consent screen AMO requires.
- Firefox runs the MV3 background as an event page, not a service worker. After
  any background change, retest the locked-extension sign and pay flow, NWC
  reconnect, and the auto-lock alarm on a real Firefox profile.
- The Firefox manifest name is shortened to stay under the AMO 45 character cap.
