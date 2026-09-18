import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAllTargetsEmpty, createKeypair, type CeremonyKeypairTarget } from '../../server/security/ceremonyKeypairBootstrap';

export const DOCUMENT_FACT_REVIEW_SIGNER_FAMILY = 'document-fact-review-signer-v1';
export const DOCUMENT_PROPERTY_REVIEW_SIGNER_FAMILY = 'document-property-review-signer-v1';

export function documentReviewAuthorityTargets(): readonly CeremonyKeypairTarget[] {
  return [
    { family: DOCUMENT_FACT_REVIEW_SIGNER_FAMILY, keyId: 'ed25519:document-fact-review-v1' },
    { family: DOCUMENT_PROPERTY_REVIEW_SIGNER_FAMILY, keyId: 'ed25519:document-property-review-v1' },
  ];
}

export function bootstrapDocumentReviewAuthority(secretsRoot: string) {
  const root = secretsRoot.trim();
  if (!root) throw new Error('REJECT_DOCUMENT_REVIEW_AUTHORITY_CEREMONY: --secrets-root is required');
  const targets = documentReviewAuthorityTargets();
  assertAllTargetsEmpty(root, targets);
  return targets.map((target) => ({ family: target.family, key_id: createKeypair(root, target).keyId }));
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1]?.trim() || '';
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('REJECT_DOCUMENT_REVIEW_AUTHORITY_CEREMONY: refusing to write without --execute');
  const provisioned = bootstrapDocumentReviewAuthority(option('--secrets-root'));
  console.log(JSON.stringify({ ceremony: 'GOVERNANCE-REVIEW-SIGNER-PROVISIONING-01', provisioned }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
