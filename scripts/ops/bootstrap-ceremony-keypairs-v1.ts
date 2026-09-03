import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAllTargetsEmpty, createKeypair, type CeremonyKeypairTarget } from '../../server/security/ceremonyKeypairBootstrap';

const DEFAULT_SECRETS_ROOT = 'C:/Users/jimmy/.mimers/secrets/ceremony-v1';
const fixed = (family: string, keyId: string) => ({ family, keyId });
function requiredKeyId(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`REJECT_CEREMONY_CONFIGURATION: ${name} is required`);
  return value;
}
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }

export function ceremonyTargets(env: NodeJS.ProcessEnv = process.env): readonly CeremonyKeypairTarget[] {
  return [
    fixed('admin-role-issuer', 'ed25519:product-admin-role-issuer-v1'),
    fixed('governance-signing', 'ed25519:governance-promotion-v1'),
    fixed('legal-corpus-materialization-signing', 'ed25519:legal-corpus-materialization-v1'),
    fixed('product-release-issuer', requiredKeyId(env, 'PRODUCT_RELEASE_ISSUER_KEY_ID')),
    fixed('project-context-binding-issuer', requiredKeyId(env, 'PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID')),
  ];
}

export function resolveSecretsRoot(argv: readonly string[] = process.argv): string {
  const index = argv.indexOf('--secrets-root');
  if (index < 0) return DEFAULT_SECRETS_ROOT;
  const value = argv[index + 1]?.trim();
  if (!value) throw new Error('REJECT_CEREMONY_CONFIGURATION: --secrets-root requires a path');
  return value;
}

export function executeCeremonyKeypairBootstrap(root: string, targets: readonly CeremonyKeypairTarget[]) {
  assertAllTargetsEmpty(root, targets);
  return targets.map((target) => ({ family: target.family, key_id: createKeypair(root, target).keyId }));
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('REJECT_CEREMONY_EXECUTION: refusing to write without --execute');
  const result = executeCeremonyKeypairBootstrap(resolveSecretsRoot(), ceremonyTargets());
  console.log(JSON.stringify({ ceremony: 'ROOT-OF-TRUST-BOOTSTRAP-CEREMONY-V1/A', provisioned: result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
