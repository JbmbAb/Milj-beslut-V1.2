import '../../server/loadEnvFirst';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mintGovernanceReviewerGrant } from '../../server/services/governanceReviewerGrantService';

function requiredOption(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? '' : process.argv[index + 1]?.trim() || '';
  if (!value) throw new Error(`REJECT_GOVERNANCE_REVIEWER_GRANT: ${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('REJECT_GOVERNANCE_REVIEWER_GRANT: refusing to issue without --execute');
  const grant = await mintGovernanceReviewerGrant({
    subjectUserId: requiredOption('--subject-user-id'),
    issuerRef: {
      artifact_id: requiredOption('--issuer-artifact-id'),
      artifact_type: requiredOption('--issuer-artifact-type'),
    },
  });
  console.log(JSON.stringify({ artifact_id: grant.artifact_id, content_hash: grant.content_hash.value, role: grant.payload.granted_role }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
