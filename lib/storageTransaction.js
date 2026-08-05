/**
 * Run a multi-key storage migration with best-effort transactional rollback.
 * This is used for password rotation so a partial write cannot strand vaults
 * under different passwords.
 */
export async function withStorageRollback(storage, keys, operation) {
  const uniqueKeys = [...new Set(keys.filter(key => typeof key === 'string' && key))]
  const snapshot = await storage.get(uniqueKeys)

  try {
    return await operation()
  } catch (migrationError) {
    const restore = {}
    const remove = []
    for (const key of uniqueKeys) {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) restore[key] = snapshot[key]
      else remove.push(key)
    }

    try {
      if (Object.keys(restore).length > 0) await storage.set(restore)
      if (remove.length > 0) await storage.remove(remove)
    } catch (rollbackError) {
      throw new AggregateError(
        [migrationError, rollbackError],
        'Password change failed and the previous vault state could not be fully restored',
      )
    }
    throw migrationError
  }
}
