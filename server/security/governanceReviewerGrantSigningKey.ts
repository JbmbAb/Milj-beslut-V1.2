import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

const PRIVATE_KEY_ENV = 'GOVERNANCE_REVIEWER_ISSUER_PRIVATE_KEY_PEM';
const PUBLIC_KEY_ENV = 'GOVERNANCE_REVIEWER_ISSUER_PUBLIC_KEY_PEM';
const KEY_ID_ENV = 'GOVERNANCE_REVIEWER_ISSUER_KEY_ID';
const DEFAULT_KEY_ID = 'ed25519:governance-reviewer-role-issuer-v1';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`REJECT_GOVERNANCE_REVIEWER_ISSUER_CONFIGURATION: ${name} is required`);
  return value;
}

/** Owner-side only. Runtime reviewer resolution imports the verifier, never this module. */
export function getGovernanceReviewerGrantSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  return new LocalPemSigningKeyProvider(
    env[KEY_ID_ENV]?.trim() || DEFAULT_KEY_ID,
    required(env, PRIVATE_KEY_ENV),
    required(env, PUBLIC_KEY_ENV),
  );
}
