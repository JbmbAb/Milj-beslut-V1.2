import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * Governance signing authority (ADR-042 Level 2).
 * See docs/architecture/GAP-REPORT-harvest-governance-2026-08-10.md, "SPEC TIGHTENED".
 *
 * This Ed25519 key signs `ArtifactAttestation`s that authorize permanent CAS promotions
 * (`server/routes/governance.routes.ts` → `QuarantinePromoter.promote()`). It is deliberately
 * kept separate from `JWT_ACCESS_SECRET`: the JWT secret authenticates sessions/tokens
 * (short-lived, rotates on re-login), while this key is a governance signing authority with
 * direct bearing on audit/replay of permanent, irreversible CAS writes — a different security
 * semantic, not just a different variable name.
 *
 * Rotation contract (documented now, not implemented in this change): rotating this key
 * invalidates verification of attestations signed under the previous `key_id`. A future
 * rotation must introduce the new key under a new `GOVERNANCE_SIGNING_KEY_ID` alongside a
 * multi-key verifier (accept either the current or previous key for a bounded overlap window)
 * before the old key's env vars are removed, so historical attestations remain verifiable for
 * audit. Production is expected to move this behind GCP KMS / HSM via the same
 * `SigningKeyProvider` interface (see `packages/mimers-brunn-core/src/signing/SigningProvider.ts`)
 * rather than PEM material in env vars — not done here.
 */
const REQUIRED_ENV_VARS = ['GOVERNANCE_SIGNING_PRIVATE_KEY_PEM', 'GOVERNANCE_SIGNING_PUBLIC_KEY_PEM'] as const;
const DEFAULT_KEY_ID = 'ed25519:governance-promotion-v1';

let cachedProvider: SigningKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the server's governance signing key provider from env.
 * Deliberately NOT called at module load of governance.routes.ts: routes that don't touch
 * promotion (session/*, stats, cas/artifact, quarantine/candidates) must keep working even
 * when this key isn't configured. The first `promote` request fails closed with a clear error
 * naming the missing env vars, instead of a silently-generated or reused key.
 */
export function getGovernanceSigningProvider(): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing governance signing key configuration: ${missing.join(', ')} (PEM-encoded Ed25519 ` +
        'key pair). This key authorizes permanent CAS promotions and is deliberately separate ' +
        'from JWT_ACCESS_SECRET — see server/security/governanceSigningKey.ts.'
    );
  }

  const keyId = process.env.GOVERNANCE_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedProvider = new LocalPemSigningKeyProvider(
    keyId,
    process.env.GOVERNANCE_SIGNING_PRIVATE_KEY_PEM as string,
    process.env.GOVERNANCE_SIGNING_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetGovernanceSigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
