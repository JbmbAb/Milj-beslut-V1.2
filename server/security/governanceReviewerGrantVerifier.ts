import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

const PUBLIC_KEY_ENV = 'GOVERNANCE_REVIEWER_ISSUER_PUBLIC_KEY_PEM';
const KEY_ID_ENV = 'GOVERNANCE_REVIEWER_ISSUER_KEY_ID';
const DEFAULT_KEY_ID = 'ed25519:governance-reviewer-role-issuer-v1';

/** Verification-only boundary: deliberately has no private-key environment dependency. */
export function getGovernanceReviewerGrantVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  const publicKey = env[PUBLIC_KEY_ENV]?.trim();
  if (!publicKey) throw new Error(`REJECT_GOVERNANCE_REVIEWER_ISSUER_CONFIGURATION: ${PUBLIC_KEY_ENV} is required`);
  return new LocalPemVerificationKeyProvider(env[KEY_ID_ENV]?.trim() || DEFAULT_KEY_ID, publicKey);
}
