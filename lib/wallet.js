/**
 * NWC wallet connection management.
 * Connection URIs are encrypted at rest with the user's session password.
 */

import { encryptData, decryptData } from './crypto.js'

/**
 * Get wallet config, decrypting the connection URI.
 * Returns null if no config or decryption fails (locked / wrong password).
 */
export async function getWalletConfig(password) {
  const data = await chrome.storage.local.get('walletConfig')
  const config = data.walletConfig
  if (!config) return null

  // Legacy: unencrypted config (migrate on next save)
  if (config.connectionUri) return config

  // Encrypted config
  if (!config.encrypted || !password) return null
  try {
    const decrypted = await decryptData(config.encrypted, password)
    return decrypted
  } catch {
    return null
  }
}

/**
 * Save wallet config, encrypting the connection URI.
 */
export async function saveWalletConfig(config, password) {
  if (!password) throw new Error('Password required to save wallet config')
  const encrypted = await encryptData(config, password)
  await chrome.storage.local.set({ walletConfig: { encrypted } })
}

export async function clearWalletConfig() {
  await chrome.storage.local.remove('walletConfig')
}

export async function isWalletConnected(password) {
  const config = await getWalletConfig(password)
  return config?.connectionUri ? true : false
}
