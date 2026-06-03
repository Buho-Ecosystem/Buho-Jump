/**
 * Pre-mount background guard — sets the page background colour and `data-mode`
 * from the stored theme before Vue mounts, to avoid a white flash in dark mode.
 *
 * Lives in a module (not an inline <script>) so it runs under the MV3 default
 * Content-Security-Policy (`script-src 'self'`), which blocks inline scripts.
 */

// theme -> [darkBg, lightBg]
const BASES = {
  'buho-green':     ['#0C0C0C', '#FFFFFF'],
  'copper-dusk':    ['#0C0B0A', '#FAF8F6'],
  'oxford-night':   ['#0A0A0A', '#EEF2F7'],
  'charcoal-vault': ['#0A0A0A', '#F3F3F3'],
  'apple-indigo':   ['#000000', '#F5F5FF'],
  'nostr-purple':   ['#0A080C', '#F8F5FA'],
}

export async function applyThemeBackground() {
  try {
    const { mode, theme } = await chrome.storage.local.get(['mode', 'theme'])
    const dark = mode !== 'light'
    const [darkBg, lightBg] = BASES[theme] || ['#0C0C0C', '#FFFFFF']
    document.documentElement.style.backgroundColor = dark ? darkBg : lightBg
    document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light')
  } catch {
    // storage unavailable — Vue's useTheme() sets the theme on mount
  }
}
