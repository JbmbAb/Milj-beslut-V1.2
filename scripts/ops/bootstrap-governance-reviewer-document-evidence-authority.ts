import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAllTargetsEmpty, createKeypair, type CeremonyKeypairTarget } from '../../server/security/ceremonyKeypairBootstrap';

export const GOVERNANCE_REVIEWER_ISSUER_FAMILY = 'governance-reviewer-role-issuer-v1';
export const DOCUMENT_EVIDENCE_ADMISSION_SIGNER_FAMILY = 'document-evidence-admission-signer-v1';

export function governanceReviewerDocumentEvidenceTargets(): readonly CeremonyKeypairTarget[] {
  return [
    { family: GOVERNANCE_REVIEWER_ISSUER_FAMILY, keyId: 'ed25519:governance-reviewer-role-issuer-v1' },
    { family: DOCUMENT_EVIDENCE_ADMISSION_SIGNER_FAMILY, keyId: 'ed25519:document-evidence-admission-v1' },
  ];
}

export function bootstrapGovernanceReviewerDocumentEvidenceAuthority(secretsRoot: string) {
  const root = secretsRoot.trim();
  if (!root) throw new Error('REJECT_GOVERNANCE_REVIEWER_DOCUMENT_EVIDENCE_CEREMONY: --secrets-root is required');
  const targets = governanceReviewerDocumentEvidenceTargets();
  assertAllTargetsEmpty(root, targets);
  return targets.map((target) => ({ family: target.family, key_id: createKeypair(root, target).keyId }));
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1]?.trim() || '';
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('REJECT_GOVERNANCE_REVIEWER_DOCUMENT_EVIDENCE_CEREMONY: refusing to write without --execute');
  const provisioned = bootstrapGovernanceReviewerDocumentEvidenceAuthority(option('--secrets-root'));
  console.log(JSON.stringify({ ceremony: 'GOVERNANCE-REVIEWER-AUTHORITY-AND-DOCUMENT-EVIDENCE-SIGNER-PROVISIONING-01', provisioned }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
