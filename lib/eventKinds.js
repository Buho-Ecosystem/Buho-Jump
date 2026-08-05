/**
 * Human labels for Nostr event kinds, shared by the permission prompt and
 * the connected-sites detail view so a stored rule never renders as a raw
 * "signEvent:4" string.
 *
 * Maps a kind number to the i18n key that names it. Unknown kinds fall
 * back to prompt.kindGeneric ("Event type {kind}").
 */

export const EVENT_KIND_LABEL_KEYS = {
  0: 'prompt.kindProfile',
  1: 'prompt.kindNote',
  3: 'prompt.kindContacts',
  4: 'prompt.kindDM',
  5: 'prompt.kindDeletion',
  6: 'prompt.kindRepost',
  7: 'prompt.kindReaction',
  13: 'prompt.kindPrivateWrap',
  14: 'prompt.kindChatMessage',
  1059: 'prompt.kindPrivateWrap',
  9734: 'prompt.kindZap',
  9735: 'prompt.kindZapReceipt',
  10000: 'prompt.kindMuteList',
  10002: 'prompt.kindRelayList',
  22242: 'prompt.kindRelayAuth',
  27235: 'prompt.kindHttpAuth',
  30023: 'prompt.kindArticle',
  30078: 'prompt.kindAppData',
}

/**
 * Translate a kind number into its human label.
 * @param {number|string} kind
 * @param {Function} t - vue-i18n translate function
 * @returns {string}
 */
export function eventKindLabel(kind, t) {
  const numeric = Number(kind)
  const key = EVENT_KIND_LABEL_KEYS[numeric]
  return key ? t(key) : t('prompt.kindGeneric', { kind })
}
