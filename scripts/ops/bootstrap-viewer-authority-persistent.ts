/**
 * LEGACY / MANUAL. Normal product use provisions ViewerCapability through the
 * dedicated worker. This CLI remains an explicit authority bootstrap surface.
 *
 * Legacy mode preserves the established ORSA/manual invocation. Clean-room mode
 * is selected by --secrets-root and requires every authority-bearing reference
 * and runtime root explicitly; it never reads the live secrets directory.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
  type ProductViewerCapabilityArtifact,
  type ViewerCapabilityIssuerArtifact,
  type ViewerIdentityArtifact,
  type ViewerIdentityIssuerArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestViewerIdentityArtifact,
  attestViewerIdentityIssuerArtifact,
} from '../../server/modules/localization/viewerIdentityAuthority';
import {
  attestProductViewerCapability,
  attestViewerCapabilityIssuerArtifact,
} from '../../server/modules/localization/productViewerCapabilityAuthority';

const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const CONTEXT_BINDING_REF = { artifact_id: 'project-context-binding-32f1ff68cf89421ac4b75d86', artifact_type: 'project_context_binding' } as const;
const RELEASE_REF = { artifact_id: 'product-release-772aceb600c4690777593ea8', artifact_type: 'product_release_manifest' } as const;
const RELEASE_HASH = '772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa';
const OWNER_AUTHORITY_REF = { artifact_id: 'owner-authority-manual-install-v1', artifact_type: 'owner_authority_attestation' } as const;
const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const RUNTIME_COMPONENT = 'canonical LU ViewerKernel / localization viewer runtime';

type ArtifactReferenceInput = { readonly artifact_id: string; readonly artifact_type: string };

export type ViewerBootstrapInput = {
  readonly secretsDir: string;
  readonly projectId: string;
  readonly contextBindingRef: ArtifactReferenceInput;
  readonly releaseRef: ArtifactReferenceInput;
  readonly releaseHash: string;
  readonly ownerAuthorityRef: ArtifactReferenceInput;
  readonly validFrom: string;
  readonly validUntil: string;
};

export type ViewerBootstrapResult = {
  readonly identityIssuer: ViewerIdentityIssuerArtifact;
  readonly identity: ViewerIdentityArtifact;
  readonly capabilityIssuer: ViewerCapabilityIssuerArtifact;
  readonly capability: ProductViewerCapabilityArtifact;
};

function requiredOption(name: string, argv: readonly string[] = process.argv): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1]?.trim();
  if (!value) throw new Error(`REJECT_VIEWER_AUTHORITY_BOOTSTRAP_CONFIGURATION: ${name} is required`);
  return value;
}

function option(name: string, argv: readonly string[] = process.argv): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1]?.trim() || undefined;
}

function requiredRef(prefix: string, argv: readonly string[] = process.argv): ArtifactReferenceInput {
  return {
    artifact_id: requiredOption(`--${prefix}-artifact-id`, argv),
    artifact_type: requiredOption(`--${prefix}-artifact-type`, argv),
  };
}

function iso(value: string, name: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`REJECT_VIEWER_AUTHORITY_BOOTSTRAP_CONFIGURATION: ${name} must be a valid ISO8601 timestamp`);
  }
  return value;
}

export function assertBootstrapExecute(argv: readonly string[] = process.argv): void {
  if (!argv.includes('--execute')) throw new Error('refusing to write without --execute');
}

export function assertKeyPairTargetEmpty(name: string, secretsDir = SECRETS_DIR): void {
  const dir = `${secretsDir}/${name}`;
  const privatePath = `${dir}/private.pem`;
  const publicPath = `${dir}/public.pem`;
  const privateExists = existsSync(privatePath);
  const publicExists = existsSync(publicPath);
  if (privateExists && publicExists) {
    throw new Error(`REJECT_VIEWER_AUTHORITY_BOOTSTRAP_ALREADY_PROVISIONED: ${name} key pair already exists; bootstrap never rotates trust roots.`);
  }
  if (privateExists || publicExists) {
    throw new Error(`REJECT_VIEWER_AUTHORITY_BOOTSTRAP_INCONSISTENT_KEY_STATE: ${name} has a partial key pair; explicit operator recovery is required.`);
  }
}

export function generateAndPersistKeyPair(name: string, keyId: string, secretsDir = SECRETS_DIR) {
  const dir = `${secretsDir}/${name}`;
  assertKeyPairTargetEmpty(name, secretsDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(`${dir}/private.pem`, privatePem, { mode: 0o600, flag: 'wx' });
  writeFileSync(`${dir}/public.pem`, publicPem, { flag: 'wx' });
  return { keyId, privatePem, publicPem };
}

export function legacyViewerBootstrapInput(now = new Date()): ViewerBootstrapInput {
  return {
    secretsDir: SECRETS_DIR,
    projectId: PROJECT_ID,
    contextBindingRef: CONTEXT_BINDING_REF,
    releaseRef: RELEASE_REF,
    releaseHash: RELEASE_HASH,
    ownerAuthorityRef: OWNER_AUTHORITY_REF,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function cleanRoomViewerBootstrapInput(argv: readonly string[] = process.argv): ViewerBootstrapInput {
  const validFrom = iso(requiredOption('--valid-from', argv), '--valid-from');
  const validUntil = iso(requiredOption('--valid-until', argv), '--valid-until');
  if (Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new Error('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_CONFIGURATION: --valid-until must be after --valid-from');
  }
  return {
    secretsDir: requiredOption('--secrets-root', argv),
    projectId: requiredOption('--project-id', argv),
    contextBindingRef: requiredRef('context-binding', argv),
    releaseRef: requiredRef('release', argv),
    releaseHash: requiredOption('--release-hash', argv),
    ownerAuthorityRef: requiredRef('owner-authority', argv),
    validFrom,
    validUntil,
  };
}

export function cleanRoomMimersEnvironment(argv: readonly string[] = process.argv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MIMERS_ROOT: requiredOption('--mimers-root', argv),
    MIMERS_REQUIRED: '1',
  };
}

export function legacyMimersEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!env.MIMERS_ROOT?.trim()) {
    throw new Error('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_CONFIGURATION: MIMERS_ROOT is required for legacy bootstrap');
  }
  return env;
}

export async function bootstrapViewerAuthority(args: {
  readonly input: ViewerBootstrapInput;
  readonly artifactRepository: ArtifactRepositoryPort;
}): Promise<ViewerBootstrapResult> {
  const { input, artifactRepository } = args;
  assertKeyPairTargetEmpty('viewer-identity-issuer-v1', input.secretsDir);
  assertKeyPairTargetEmpty('viewer-capability-issuer-v1', input.secretsDir);

  const identityKey = generateAndPersistKeyPair('viewer-identity-issuer-v1', 'ed25519:viewer-identity-issuer-v1', input.secretsDir);
  const capabilityKey = generateAndPersistKeyPair('viewer-capability-issuer-v1', 'ed25519:viewer-capability-issuer-v1', input.secretsDir);
  const identitySigning = new LocalPemSigningKeyProvider(identityKey.keyId, identityKey.privatePem, identityKey.publicPem);
  const capabilitySigning = new LocalPemSigningKeyProvider(capabilityKey.keyId, capabilityKey.privatePem, capabilityKey.publicPem);

  const bareIdentityIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: identityKey.keyId, owner_authority_ref: input.ownerAuthorityRef });
  const identityIssuerAttestation = await attestViewerIdentityIssuerArtifact({ issuer: bareIdentityIssuer, signing: identitySigning });
  const identityIssuer: ViewerIdentityIssuerArtifact = { ...bareIdentityIssuer, attestation: identityIssuerAttestation };
  await artifactRepository.put({ artifact_id: identityIssuer.artifact_id, content_hash: identityIssuer.content_hash, body: identityIssuer });

  const bareIdentity = createViewerIdentityArtifact({
    runtime_component: RUNTIME_COMPONENT,
    product_release_ref: input.releaseRef,
    product_release_hash: input.releaseHash,
    issuer_ref: { artifact_id: identityIssuer.artifact_id, artifact_type: identityIssuer.artifact_type },
    issuer_key_id: identityKey.keyId,
  });
  const identityAttestation = await attestViewerIdentityArtifact({ identity: bareIdentity, issuer: identityIssuer, signing: identitySigning });
  const identity: ViewerIdentityArtifact = { ...bareIdentity, attestation: identityAttestation };
  await artifactRepository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });

  const bareCapabilityIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: capabilityKey.keyId, owner_authority_ref: input.ownerAuthorityRef });
  const capabilityIssuerAttestation = await attestViewerCapabilityIssuerArtifact({ issuer: bareCapabilityIssuer, signing: capabilitySigning });
  const capabilityIssuer: ViewerCapabilityIssuerArtifact = { ...bareCapabilityIssuer, attestation: capabilityIssuerAttestation };
  await artifactRepository.put({ artifact_id: capabilityIssuer.artifact_id, content_hash: capabilityIssuer.content_hash, body: capabilityIssuer });

  const bareCapability = createProductViewerCapabilityArtifact({
    issuer_key_id: capabilityKey.keyId,
    issuer_ref: { artifact_id: capabilityIssuer.artifact_id, artifact_type: capabilityIssuer.artifact_type },
    subject_project_id: input.projectId,
    project_context_binding_ref: input.contextBindingRef,
    viewer_identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    product_release_ref: input.releaseRef,
    product_release_hash: input.releaseHash,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
  });
  const capabilityAttestation = await attestProductViewerCapability({ capability: bareCapability, issuer: capabilityIssuer, signing: capabilitySigning });
  const capability: ProductViewerCapabilityArtifact = { ...bareCapability, attestation: capabilityAttestation };
  await artifactRepository.put({ artifact_id: capability.artifact_id, content_hash: capability.content_hash, body: capability });

  return { identityIssuer, identity, capabilityIssuer, capability };
}

async function main(): Promise<void> {
  assertBootstrapExecute();
  const secretsRoot = option('--secrets-root');
  const cleanRoom = secretsRoot !== undefined;
  if (!cleanRoom && option('--mimers-root')) {
    throw new Error('REJECT_VIEWER_AUTHORITY_BOOTSTRAP_CONFIGURATION: --mimers-root requires --secrets-root');
  }
  const input = cleanRoom ? cleanRoomViewerBootstrapInput() : legacyViewerBootstrapInput();
  const mimers = cleanRoom
    ? await MimersIntegration.create({
      env: cleanRoomMimersEnvironment(),
      forceMimers: true,
    })
    : await MimersIntegration.create({ env: legacyMimersEnvironment(), forceMimers: true });
  const result = await bootstrapViewerAuthority({ input, artifactRepository: mimers.artifactRepository });
  await mimers.rebuildIndex();
  console.log(JSON.stringify({
    identity_issuer_key_id: result.identityIssuer.payload.issuer_key_id,
    identity_issuer_artifact_id: result.identityIssuer.artifact_id,
    viewer_identity_artifact_id: result.identity.artifact_id,
    capability_issuer_key_id: result.capabilityIssuer.payload.issuer_key_id,
    capability_issuer_artifact_id: result.capabilityIssuer.artifact_id,
    product_viewer_capability_artifact_id: result.capability.artifact_id,
    valid_from: result.capability.payload.valid_from,
    valid_until: result.capability.payload.valid_until,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
