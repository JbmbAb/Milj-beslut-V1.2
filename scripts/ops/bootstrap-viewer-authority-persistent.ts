/**
 * LEGACY / MANUAL. Normal product use now provisions ViewerCapability automatically
 * (server/workers/lu-viewer-capability-worker.ts, PRODUCT-LU-VIEWER-CAPABILITY-PROVISIONING-01).
 * Kept as a manual fallback/debugging tool, not part of the regular product flow.
 *
 * LU-PRODUCT-GOLDEN-PATH-01 -- fixes a real gap found while proving the golden path: the viewer-
 * identity and viewer-capability issuer keys minted during VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01
 * / VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1's proof runs were generated fresh in-process and
 * never persisted to ~/.mimers/secrets -- unlike every other issuer this session
 * (project-context-binding-issuer-v1, lu-execution-authority). That made the resulting
 * ViewerIdentity/ProductViewerCapability artifacts unverifiable outside the single proof-script
 * process that minted them, which is not a real "persistent, fresh-reopenable" authority.
 *
 * This script generates real, persisted Ed25519 keypairs for both issuers, then mints one real
 * ViewerIdentityArtifact and one real ProductViewerCapabilityArtifact for the LU golden-path
 * project using those stable keys. Never re-run with --execute once real product capabilities
 * depend on the resulting artifact_ids -- this is an owner-provisioning step, not a repeatable one.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/bootstrap-viewer-authority-persistent.ts --execute
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createViewerIdentityArtifact,
  createViewerIdentityIssuerArtifact,
  createProductViewerCapabilityArtifact,
  createViewerCapabilityIssuerArtifact,
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

function generateAndPersistKeyPair(name: string, keyId: string) {
  const dir = `${SECRETS_DIR}/${name}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(`${dir}/private.pem`, privatePem, { mode: 0o600 });
  writeFileSync(`${dir}/public.pem`, publicPem);
  return { keyId, privatePem, publicPem };
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const identityKey = generateAndPersistKeyPair('viewer-identity-issuer-v1', 'ed25519:viewer-identity-issuer-v1');
  const capabilityKey = generateAndPersistKeyPair('viewer-capability-issuer-v1', 'ed25519:viewer-capability-issuer-v1');
  const identitySigning = new LocalPemSigningKeyProvider(identityKey.keyId, identityKey.privatePem, identityKey.publicPem);
  const capabilitySigning = new LocalPemSigningKeyProvider(capabilityKey.keyId, capabilityKey.privatePem, capabilityKey.publicPem);

  const mimers = await MimersIntegration.create({ forceMimers: true });

  const bareIdentityIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: identityKey.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const identityIssuerAttestation = await attestViewerIdentityIssuerArtifact({ issuer: bareIdentityIssuer, signing: identitySigning });
  const identityIssuer = { ...bareIdentityIssuer, attestation: identityIssuerAttestation };
  await mimers.artifactRepository.put({ artifact_id: identityIssuer.artifact_id, content_hash: identityIssuer.content_hash, body: identityIssuer });

  const bareIdentity = createViewerIdentityArtifact({
    runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
    product_release_ref: RELEASE_REF,
    product_release_hash: RELEASE_HASH,
    issuer_ref: { artifact_id: identityIssuer.artifact_id, artifact_type: identityIssuer.artifact_type },
    issuer_key_id: identityKey.keyId,
  });
  const identityAttestation = await attestViewerIdentityArtifact({ identity: bareIdentity, issuer: identityIssuer, signing: identitySigning });
  const identity = { ...bareIdentity, attestation: identityAttestation };
  await mimers.artifactRepository.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });

  const bareCapIssuer = createViewerCapabilityIssuerArtifact({ issuer_key_id: capabilityKey.keyId, owner_authority_ref: OWNER_AUTHORITY_REF });
  const capIssuerAttestation = await attestViewerCapabilityIssuerArtifact({ issuer: bareCapIssuer, signing: capabilitySigning });
  const capIssuer = { ...bareCapIssuer, attestation: capIssuerAttestation };
  await mimers.artifactRepository.put({ artifact_id: capIssuer.artifact_id, content_hash: capIssuer.content_hash, body: capIssuer });

  const validFrom = new Date().toISOString();
  const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const bareCapability = createProductViewerCapabilityArtifact({
    issuer_key_id: capabilityKey.keyId,
    issuer_ref: { artifact_id: capIssuer.artifact_id, artifact_type: capIssuer.artifact_type },
    subject_project_id: PROJECT_ID,
    project_context_binding_ref: CONTEXT_BINDING_REF,
    viewer_identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    product_release_ref: RELEASE_REF,
    product_release_hash: RELEASE_HASH,
    valid_from: validFrom,
    valid_until: validUntil,
  });
  const capabilityAttestation = await attestProductViewerCapability({ capability: bareCapability, issuer: capIssuer, signing: capabilitySigning });
  const capability = { ...bareCapability, attestation: capabilityAttestation };
  await mimers.artifactRepository.put({ artifact_id: capability.artifact_id, content_hash: capability.content_hash, body: capability });

  console.log(JSON.stringify({
    identity_issuer_key_id: identityKey.keyId,
    identity_issuer_artifact_id: identityIssuer.artifact_id,
    viewer_identity_artifact_id: identity.artifact_id,
    capability_issuer_key_id: capabilityKey.keyId,
    capability_issuer_artifact_id: capIssuer.artifact_id,
    product_viewer_capability_artifact_id: capability.artifact_id,
    valid_from: validFrom,
    valid_until: validUntil,
  }, null, 2));

  await mimers.rebuildIndex();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
