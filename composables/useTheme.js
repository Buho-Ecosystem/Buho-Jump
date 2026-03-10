/**
 * Theme composable — manages theme and light/dark mode.
 * Applies CSS custom properties to :root and persists choice.
 */

import { ref, watch, onMounted } from 'vue'
import { themes, defaultTheme, defaultMode, themeIds } from '../themes/tokens.js'

const currentTheme = ref(defaultTheme)
const currentMode = ref(defaultMode)

function applyTheme() {
  const theme = themes[currentTheme.value]
  if (!theme) return

  const tokens = theme[currentMode.value]
  if (!tokens) return

  const root = document.documentElement
  root.setAttribute('data-theme', currentTheme.value)
  root.setAttribute('data-mode', currentMode.value)

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value)
  }
}

async function loadSavedTheme() {
  try {
    const data = await chrome.storage.local.get(['theme', 'mode'])
    if (data.theme && themes[data.theme]) currentTheme.value = data.theme
    if (data.mode && (data.mode === 'light' || data.mode === 'dark')) currentMode.value = data.mode
  } catch {
    // Use defaults
  }
  applyTheme()
}

async function persistTheme() {
  try {
    await chrome.storage.local.set({
      theme: currentTheme.value,
      mode: currentMode.value,
    })
  } catch {
    // Ignore storage errors
  }
}

export function useTheme() {
  onMounted(() => {
    loadSavedTheme()
  })

  watch([currentTheme, currentMode], () => {
    applyTheme()
    persistTheme()
  })

  function setTheme(themeId) {
    if (themes[themeId]) currentTheme.value = themeId
  }

  function setMode(mode) {
    if (mode === 'light' || mode === 'dark') currentMode.value = mode
  }

  function toggleMode() {
    currentMode.value = currentMode.value === 'dark' ? 'light' : 'dark'
  }

  function cycleTheme() {
    const idx = themeIds.indexOf(currentTheme.value)
    currentTheme.value = themeIds[(idx + 1) % themeIds.length]
  }

  return {
    currentTheme,
    currentMode,
    themes,
    themeIds,
    setTheme,
    setMode,
    toggleMode,
    cycleTheme,
  }
}
