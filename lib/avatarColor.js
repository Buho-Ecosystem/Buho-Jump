/**
 * Deterministic avatar background color from pubkey.
 * Telegram-style palette — 7 distinct hues mapped via last byte.
 */
const AVATAR_COLORS = ['#E17076', '#FAA74A', '#A695E7', '#7BC862', '#6EC9CB', '#65AADD', '#EE7AAE']

export function getAvatarColor(pubkey) {
  const idx = parseInt(pubkey.slice(-2), 16) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}
