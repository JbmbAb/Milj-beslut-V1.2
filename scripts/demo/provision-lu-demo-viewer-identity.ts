/**
 * DEMO-ONLY (branch demo/lu-demonstrator-72h). Mints the viewer-identity issuer + ViewerIdentity
 * for the demo product release into the demo CAS (no repo script supports a fresh CAS: the legacy
 * scripts hardcode the historical release id/hash and C:/Users/jimmy/.mimers/secrets).
 * Appends LU_VIEWER_IDENTITY_ID + LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID to secrets/extra-env.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { createViewerIdentityArtifact, createViewerIdentityIssuerArtifact } from '@miljobeslut/mps-lu';
import { attestViewerIdentityArtifact, attestViewerIdentityIssuerArtifact } from '../../server/modules/localization/viewerIdentityAuthority';

const SEC = 'D:/mimer-demo/secrets';
async function main() {
  const root = process.env.MIMERS_ROOT?.trim() ?? '';
  if (!(root.toLowerCase().includes('mimer-demo') && root.toLowerCase().endsWith('cas'))) throw new Error(`DEMO_PROVISION_REJECTED: MIMERS_ROOT must be the demo CAS, got '${root}'`);
  const extra = JSON.parse(await readFile(`${SEC}/extra-env.json`, 'utf8'));
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: '1' }, forceMimers: true });
  const repo = mimers.artifactRepository;
  const release = await repo.resolve<any>({ artifact_id: extra.PRODUCT_RELEASE_ARTIFACT_ID, artifact_type: 'product_release_manifest' });
  const keyId = (await readFile(`${SEC}/viewer-identity-issuer/key-id.txt`, 'utf8')).trim();
  const signing = new LocalPemSigningKeyProvider(keyId, await readFile(`${SEC}/viewer-identity-issuer/private.pem`, 'utf8'), await readFile(`${SEC}/viewer-identity-issuer/public.pem`, 'utf8'));
  const OWNER = { artifact_id: 'owner-authority-lu-demo-local-not-governed', artifact_type: 'owner_authority_attestation' } as const;
  const bareIssuer = createViewerIdentityIssuerArtifact({ issuer_key_id: keyId, owner_authority_ref: OWNER });
  const issuer = { ...bareIssuer, attestation: await attestViewerIdentityIssuerArtifact({ issuer: bareIssuer, signing }) };
  await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  const bareIdentity = createViewerIdentityArtifact({
    runtime_component: 'canonical LU ViewerKernel / localization viewer runtime',
    product_release_ref: { artifact_id: release.artifact_id, artifact_type: 'product_release_manifest' },
    product_release_hash: release.release_hash.value,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: keyId,
  } as any);
  const identity = { ...bareIdentity, attestation: await attestViewerIdentityArtifact({ identity: bareIdentity, issuer, signing }) };
  await repo.put({ artifact_id: identity.artifact_id, content_hash: identity.content_hash, body: identity });
  const lu = await readFile(`${SEC}/lifecycle-id.txt`, 'utf8');
  extra.LU_VIEWER_IDENTITY_ID = identity.artifact_id;
  extra.LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID = process.argv[2];
  await writeFile(`${SEC}/extra-env.json`, JSON.stringify(extra, null, 2));
  console.log(JSON.stringify({ viewer_identity_issuer: issuer.artifact_id, viewer_identity: identity.artifact_id, lifecycle: lu.trim(), extra_env_keys: Object.keys(extra) }, null, 2));
}
void main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
