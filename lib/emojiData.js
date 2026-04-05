/**
 * Compact emoji dataset for autocomplete.
 * Top ~120 commonly used emojis with searchable short names.
 */
export const EMOJI_LIST = [
  // Faces
  ['😀', 'grinning'], ['😃', 'smiley'], ['😄', 'smile'], ['😁', 'grin'],
  ['😆', 'laughing'], ['😅', 'sweat_smile'], ['🤣', 'rofl'], ['😂', 'joy'],
  ['🙂', 'slightly_smiling'], ['😉', 'wink'], ['😊', 'blush'], ['😇', 'innocent'],
  ['🥰', 'smiling_hearts'], ['😍', 'heart_eyes'], ['🤩', 'star_struck'], ['😘', 'kissing_heart'],
  ['😋', 'yum'], ['😛', 'stuck_out_tongue'], ['😜', 'stuck_out_tongue_winking'],
  ['🤪', 'zany'], ['🤨', 'raised_eyebrow'], ['🧐', 'monocle'],
  ['🤓', 'nerd'], ['😎', 'sunglasses'], ['🥳', 'partying'],
  ['😏', 'smirk'], ['😒', 'unamused'], ['😞', 'disappointed'], ['😔', 'pensive'],
  ['😟', 'worried'], ['😕', 'confused'], ['🙁', 'frowning'],
  ['😢', 'cry'], ['😭', 'sob'], ['😤', 'triumph'], ['😠', 'angry'],
  ['🤬', 'cursing'], ['😱', 'scream'], ['😰', 'cold_sweat'],
  ['😥', 'sad_relieved'], ['🤗', 'hugging'], ['🤔', 'thinking'],
  ['🫣', 'peeking'], ['🤫', 'shushing'], ['🫡', 'saluting'],
  ['🤭', 'hand_over_mouth'], ['😑', 'expressionless'], ['😐', 'neutral'],
  ['🫠', 'melting'], ['🙄', 'rolling_eyes'], ['😬', 'grimacing'],
  ['🤥', 'lying'], ['😴', 'sleeping'], ['🤮', 'vomiting'],
  ['🤧', 'sneezing'], ['😷', 'mask'], ['🤒', 'sick'],
  // Gestures
  ['👍', 'thumbsup'], ['👎', 'thumbsdown'], ['👌', 'ok_hand'],
  ['✌️', 'peace'], ['🤞', 'crossed_fingers'], ['🤟', 'love_you'],
  ['🤘', 'metal'], ['🤙', 'call_me'], ['👋', 'wave'],
  ['🙏', 'pray'], ['🤝', 'handshake'], ['👏', 'clap'],
  ['💪', 'muscle'], ['🫶', 'heart_hands'],
  // Hearts & symbols
  ['❤️', 'heart'], ['🧡', 'orange_heart'], ['💛', 'yellow_heart'],
  ['💚', 'green_heart'], ['💙', 'blue_heart'], ['💜', 'purple_heart'],
  ['🖤', 'black_heart'], ['💔', 'broken_heart'], ['💯', 'hundred'],
  ['💥', 'boom'], ['💫', 'dizzy'], ['✨', 'sparkles'],
  ['🔥', 'fire'], ['⭐', 'star'], ['🌟', 'glowing_star'],
  // Objects
  ['⚡', 'zap'], ['🎉', 'tada'], ['🎊', 'confetti'],
  ['🎁', 'gift'], ['🏆', 'trophy'], ['🥇', 'first_place'],
  ['🎯', 'dart'], ['🎵', 'musical_note'], ['🎶', 'notes'],
  ['💰', 'money_bag'], ['💸', 'money_with_wings'], ['🪙', 'coin'],
  ['🍕', 'pizza'], ['🍺', 'beer'], ['☕', 'coffee'],
  ['🚀', 'rocket'], ['🌈', 'rainbow'], ['☀️', 'sun'],
  ['🌙', 'moon'], ['⛈️', 'storm'],
  // Animals
  ['🦉', 'owl'], ['🐱', 'cat'], ['🐶', 'dog'],
  ['🦊', 'fox'], ['🐻', 'bear'], ['🦁', 'lion'],
  // Misc
  ['✅', 'check'], ['❌', 'x'], ['⚠️', 'warning'],
  ['💡', 'bulb'], ['🔑', 'key'], ['🔒', 'lock'],
  ['👀', 'eyes'], ['🧠', 'brain'], ['💬', 'speech_bubble'],
]

/**
 * Search emojis by name. Returns top N matches.
 * @param {string} query — partial name (e.g. "smi" matches "smile", "smirk")
 * @param {number} limit
 * @returns {Array<[string, string]>} — [emoji, name] pairs
 */
export function searchEmojis(query, limit = 8) {
  if (!query) return []
  const q = query.toLowerCase()
  return EMOJI_LIST.filter(([, name]) => name.includes(q)).slice(0, limit)
}
