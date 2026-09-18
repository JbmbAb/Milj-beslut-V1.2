/** Global C1 composition. It composes A, B, Viewer and C; it creates no new authority format. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { assertAllTargetsEmpty, type CeremonyKeypairTarget } from '../../server/security/ceremonyKeypairBootstrap';
import { bootstrapLuExecutionAuthorityCeremony, LU_EXECUTION_AUTHORITY_ISSUER_FAMILY, LU_EXECUTION_AUTHORITY_ROOT_FAMILY } from '../../server/security/luExecutionAuthorityBootstrapCeremony';
import { bootstrapViewerAuthority, cleanRoomViewerBootstrapInput, type ViewerBootstrapInput } from './bootstrap-viewer-authority-persistent';
import { ceremonyTargets, executeCeremonyKeypairBootstrap } from './bootstrap-ceremony-keypairs-v1';
import { createSourceRegistryTrustedKeyring, loadVerifiedSourceRegistry } from '../../packages/mps-data-governance/src/SourceRegistry';

const VIEWER_TARGETS: readonly CeremonyKeypairTarget[] = [
  { family: 'viewer-identity-issuer-v1', keyId: 'ed25519:viewer-identity-issuer-v1' },
  { family: 'viewer-capability-issuer-v1', keyId: 'ed25519:viewer-capability-issuer-v1' },
];

export type GlobalC1CleanRoomInput = {
  readonly secretsRoot: string;
  readonly mimersRoot: string;
  readonly productReleaseIssuerKeyId: string;
  readonly projectContextBindingIssuerKeyId: string;
  readonly luRootKeyId: string;
  readonly luIssuerKeyId: string;
  readonly viewer: ViewerBootstrapInput;
  readonly sourceRegistryPath: string;
  readonly sourceRegistryTrustedKeysPath: string;
};

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`REJECT_C1_CONFIGURATION: ${name} is required`);
  return value;
}

function requiredOption(name: string, argv: readonly string[] = process.argv): string {
  const index = argv.indexOf(name);
  return required(index < 0 ? '' : argv[index + 1] ?? '', name);
}

function trustedKeyring(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('REJECT_C1_SOURCE_REGISTRY_TRUST_SEED');
  return createSourceRegistryTrustedKeyring(new Map(Object.entries(raw)));
}

export async function bootstrapGlobalC1CleanRoom(input: GlobalC1CleanRoomInput) {
  required(input.secretsRoot, 'secretsRoot');
  required(input.mimersRoot, 'mimersRoot');
  required(input.productReleaseIssuerKeyId, 'productReleaseIssuerKeyId');
  required(input.projectContextBindingIssuerKeyId, 'projectContextBindingIssuerKeyId');
  required(input.luRootKeyId, 'luRootKeyId');
  required(input.luIssuerKeyId, 'luIssuerKeyId');
  required(input.sourceRegistryPath, 'sourceRegistryPath');
  required(input.sourceRegistryTrustedKeysPath, 'sourceRegistryTrustedKeysPath');
  if (input.viewer.secretsDir !== input.secretsRoot) throw new Error('REJECT_C1_VIEWER_SECRETS_ROOT_MISMATCH');
  // C is verify-only and runs before any private key is created.
  const registry = await loadVerifiedSourceRegistry({ registryPath: input.sourceRegistryPath, trustedKeyring: trustedKeyring(input.sourceRegistryTrustedKeysPath) });
  const aEnv = {
    PRODUCT_RELEASE_ISSUER_KEY_ID: input.productReleaseIssuerKeyId,
    PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID: input.projectContextBindingIssuerKeyId,
  } as NodeJS.ProcessEnv;
  const aTargets = ceremonyTargets(aEnv);
  const allTargets = [
    ...aTargets,
    { family: LU_EXECUTION_AUTHORITY_ROOT_FAMILY, keyId: input.luRootKeyId },
    { family: LU_EXECUTION_AUTHORITY_ISSUER_FAMILY, keyId: input.luIssuerKeyId },
    ...VIEWER_TARGETS,
  ];
  // One graph-level preflight prevents a known/partial node from creating a mixed bootstrap.
  assertAllTargetsEmpty(input.secretsRoot, allTargets);
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: input.mimersRoot, MIMERS_REQUIRED: '1' }, forceMimers: true });
  const a = executeCeremonyKeypairBootstrap(input.secretsRoot, aTargets);
  const b = await bootstrapLuExecutionAuthorityCeremony({
    secretsRoot: input.secretsRoot,
    keyIds: { rootKeyId: input.luRootKeyId, issuerKeyId: input.luIssuerKeyId },
    repository: mimers.artifactRepository,
  });
  const viewer = await bootstrapViewerAuthority({ input: input.viewer, artifactRepository: mimers.artifactRepository });
  await mimers.rebuildIndex();
  return { sourceRegistryEntries: registry.sources.length, a, b, viewer };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) throw new Error('REJECT_C1_EXECUTION: refusing to write without --execute');
  const result = await bootstrapGlobalC1CleanRoom({
    secretsRoot: requiredOption('--secrets-root'),
    mimersRoot: requiredOption('--mimers-root'),
    productReleaseIssuerKeyId: requiredOption('--product-release-issuer-key-id'),
    projectContextBindingIssuerKeyId: requiredOption('--project-context-binding-issuer-key-id'),
    luRootKeyId: requiredOption('--lu-root-key-id'),
    luIssuerKeyId: requiredOption('--lu-issuer-key-id'),
    viewer: cleanRoomViewerBootstrapInput(),
    sourceRegistryPath: requiredOption('--source-registry-path'),
    sourceRegistryTrustedKeysPath: requiredOption('--source-registry-trusted-keys-file'),
  });
  console.log(JSON.stringify({
    ceremony: 'ROOT-OF-TRUST-BOOTSTRAP-CEREMONY-V1/D',
    source_registry_entries: result.sourceRegistryEntries,
    lu_issuer_artifact_id: result.b.issuer.artifact_id,
    viewer_capability_artifact_id: result.viewer.capability.artifact_id,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
