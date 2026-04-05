# Contributing to Buho Jump

Thanks for your interest! You don't need to be a developer to contribute — some of the most valuable work happens outside of code.

---

## No code needed

### Test and report bugs
Use Buho Jump in your daily workflow and let us know what breaks or feels off. Open an [issue](https://github.com/Buho-Ecosystem/Buho-Jump/issues) with:
- What you expected vs. what happened
- Browser name and version
- Steps to reproduce (if possible)

### Translate
Buho Jump supports 15 languages - and most of them need help. Translation files live in `locales/`. To add or improve a language:
1. Copy `locales/en.json` to your locale code (e.g. `locales/pt.json`)
2. Translate the values (not the keys)
3. Open a PR

> [!TIP]
> Even fixing a single awkward phrase helps. You don't need to translate the entire file.

### Write or improve documentation
Found something confusing in the docs? A missing step? A better way to explain something? PRs for documentation are just as welcome as code changes.

### Share your experience
- Write about Buho Jump on Nostr or your blog
- Record a walkthrough or tutorial
- Help answer questions from other users in issues or on Nostr

### Design and UX feedback
If you spot something that looks off, feels clunky, or could be clearer — open an issue describing the experience. Screenshots or screen recordings are incredibly helpful.

### Suggest features
Have an idea? Open an issue and describe:
- What problem it solves
- Who it helps
- How you imagine it working

We can't build everything, but good ideas shape the roadmap.

---

## For developers

### Quick start

**Requirements:** Node.js 20+, npm 10+

```bash
git clone https://github.com/Buho-Ecosystem/Buho-Jump.git
cd Buho-Jump
npm ci
```

**Chrome:**
```bash
npm run dev
```
Then go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`.

**Firefox:**
```bash
npm run dev:firefox
```
Then go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select any file in `.output/firefox-mv2`.

> [!TIP]
> Dev mode watches for changes and reloads automatically. Just save your file and the extension updates.

**Production builds:**

| Command | Output |
|---------|--------|
| `npm run build` | `.output/chrome-mv3` |
| `npx wxt build --browser firefox` | `.output/firefox-mv2` |

### Code style

- **Vue 3** with `<script setup>` and Composition API
- **Tailwind CSS v4** — use semantic token classes (`bg-surface-card`, `text-text-primary`), never hardcode colors
- **i18n** — all user-facing strings go in `locales/en.json`, use `t('key')` in templates
- Keep files focused — one component, one concern
- Simple and readable wins over clever abstractions

### Pull requests

- Keep PRs focused on one thing
- Include a short description of the change and why
- If it touches UI, mention which screen or flow is affected
- We review PRs as quickly as we can


## Security issues

Please **do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.


## License

By contributing, you agree that your contributions will be licensed under [AGPL-3.0](LICENSE).
