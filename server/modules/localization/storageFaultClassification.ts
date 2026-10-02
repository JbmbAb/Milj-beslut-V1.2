/**
 * U20CDF2 (coordinator add-ons 1 and 2; OD-R2/OD-R3): is a storage fault LASTING -- so a retry cannot
 * heal it -- or possibly transient? The same value-based rule M1a-F1 uses for currentness
 * (localizationGeometryCurrentProvider.ts isPersistentStorageIntegrityFault), plus corrupt bytes:
 *  - MIMERS_ARTIFACT_OBJECT_MISSING: the index names a CAS object that is not in the CAS;
 *  - MIMERS_ARTIFACT_INDEX_READ_FAILED with reason MALFORMED: a torn or unparsable index entry;
 *  - CASIntegrityError: the stored bytes do not match their address.
 * matched on the error and its `cause` chain by stable code/name, never by message text. Anything
 * else (EIO, EBUSY, a lock, an index entry that could not be READ) has unknown persistence and is
 * treated as retryable.
 */
export function isPersistentStorageFault(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, reason, name, cause } = current as { code?: unknown; reason?: unknown; name?: unknown; cause?: unknown };
    if (code === 'MIMERS_ARTIFACT_OBJECT_MISSING') return true;
    if (code === 'MIMERS_ARTIFACT_INDEX_READ_FAILED' && reason === 'MALFORMED') return true;
    if (name === 'CASIntegrityError') return true;
    current = cause;
  }
  return false;
}

/** The one Swedish sentence on whether a retry can help. */
export function retrySentenceSv(retryable: boolean): string {
  return retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.';
}
