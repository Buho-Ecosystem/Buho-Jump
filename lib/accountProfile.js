// Public metadata is untrusted. Keep only bounded strings and secure images.
export function accountProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const text = (key, limit) => typeof value[key] === 'string' ? value[key].trim().slice(0, limit) : ''
  let picture = text('picture', 2048)
  try { if (new URL(picture).protocol !== 'https:') picture = '' } catch { picture = '' }
  return { name: text('name', 80), display_name: text('display_name', 80), nip05: text('nip05', 320), picture }
}
