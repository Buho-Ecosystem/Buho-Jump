export class VaultIntegrityError extends Error {
  constructor(storeName, cause) {
    super(`${storeName} could not be authenticated or decrypted`, { cause })
    this.name = 'VaultIntegrityError'
    this.code = 'VAULT_INTEGRITY'
  }
}

export function vaultIntegrityError(storeName, cause) {
  return new VaultIntegrityError(storeName, cause)
}
