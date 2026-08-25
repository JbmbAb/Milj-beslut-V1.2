import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';
import {
  LU_EXECUTION_AUTHORITY_ISSUER_FAMILY,
  LU_EXECUTION_AUTHORITY_ROOT_FAMILY,
  bootstrapLuExecutionAuthorityCeremony,
  verifyLuExecutionAuthorityCeremony,
} from '../../server/security/luExecutionAuthorityBootstrapCeremony';
import { LU_EXECUTION_AUTHORITY_ISSUER_TYPE } from '../../packages/mps-lu/src/artifacts/LuExecutionAuthorityArtifact';
import { readFileSync, existsSync } from 'node:fs';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || null : null;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`REJECT_LU_ROOT_ISSUER_CEREMONY: ${name} is required`);
  return value;
}

async function integration(mimersRoot: string) {
  return MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: mimersRoot, MIMERS_REQUIRED: '1' }, forceMimers: true });
}

async function main(): Promise<void> {
  const secretsRoot = requiredOption('--secrets-root');
  const mimersRoot = requiredOption('--mimers-root');
  const keyIds = {
    rootKeyId: requiredOption('--root-key-id'),
    issuerKeyId: requiredOption('--issuer-key-id'),
  };
  const mimers = await integration(mimersRoot);

  if (process.argv.includes('--execute')) {
    const result = await bootstrapLuExecutionAuthorityCeremony({
      secretsRoot,
      keyIds,
      repository: mimers.artifactRepository,
    });
    console.log(JSON.stringify({ root_artifact_id: result.root.artifact_id, issuer_artifact_id: result.issuer.artifact_id, verified: true }, null, 2));
    return;
  }

  if (process.argv.includes('--verify')) {
    const rootPaths = keypairPaths(secretsRoot, LU_EXECUTION_AUTHORITY_ROOT_FAMILY);
    const issuerPaths = keypairPaths(secretsRoot, LU_EXECUTION_AUTHORITY_ISSUER_FAMILY);
    if (existsSync(rootPaths.privatePath) || existsSync(issuerPaths.privatePath)) {
      throw new Error('REJECT_LU_ROOT_ISSUER_CEREMONY: --verify requires a public-only trust root');
    }
    const issuerRef = {
      artifact_id: requiredOption('--issuer-artifact-id'),
      artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
    };
    await verifyLuExecutionAuthorityCeremony({
      issuerRef,
      repository: mimers.artifactRepository,
      rootPublicPem: readFileSync(rootPaths.publicPath, 'utf8'),
      issuerPublicPem: readFileSync(issuerPaths.publicPath, 'utf8'),
      keyIds,
    });
    console.log(JSON.stringify({ issuer_artifact_id: issuerRef.artifact_id, verified: true, private_key_available: false }, null, 2));
    return;
  }

  throw new Error('REJECT_LU_ROOT_ISSUER_CEREMONY: use --execute or --verify');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
