import type { IntegrityComparison, IntegrityProvider } from './integrityProvider';
import { LegacyIntegrityProvider } from './LegacyIntegrityProvider';
import { MimersV9IntegrityProvider } from './MimersV9IntegrityProvider';

const legacyDefault = new LegacyIntegrityProvider();
const v9Default = new MimersV9IntegrityProvider();

/**
 * Dual-hash comparison for shadow validation / golden tests (ADR-042 Fas bridge).
 * Digests may differ: legacy sorts object trees then JSON.stringify; v9 is RFC8785.
 */
export function compareIntegrity(
  value: unknown,
  legacy: IntegrityProvider = legacyDefault,
  v9: IntegrityProvider = v9Default,
): IntegrityComparison {
  const legacyDigest = legacy.hash(value);
  const v9Digest = v9.hash(value);
  return {
    legacyDigest,
    v9Digest,
    equal: legacyDigest === v9Digest,
  };
}
