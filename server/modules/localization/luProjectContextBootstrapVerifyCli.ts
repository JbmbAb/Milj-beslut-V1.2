/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 *
 * Fresh, standalone verification process spawned by executeProjectContextBootstrap after issuing
 * a binding. Its own env has PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM deleted before spawn
 * (see luProjectContextBootstrap.ts's runFreshVerifier) -- this file must never import
 * getProjectContextBindingIssuerSigner, only the verifier. Same pattern as
 * scripts/ops/bootstrap-product-lu-owner.ts's own `--verify` mode.
 */
import '../../loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import type { ProjectContextBindingArtifact } from '@miljobeslut/mps-lu';
import type { ProjectPropertyBindingArtifact } from '@miljobeslut/mps-lu';
import { verifyProjectContextBindingArtifactAuthority } from './projectContextBindingAuthority';
import { getProjectContextBindingIssuerVerifier } from '../../security/projectContextBindingIssuerKey';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';

const PRIVATE_KEY_ENV = 'PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM';

async function main(): Promise<void> {
  if (process.env[PRIVATE_KEY_ENV]) {
    throw new Error('LU_PROJECT_CONTEXT_BOOTSTRAP_VERIFY_REJECTED: verification process must not have issuer private key');
  }
  const [bindingId, projectId] = process.argv.slice(2);
  if (!bindingId || !projectId) {
    throw new Error('LU_PROJECT_CONTEXT_BOOTSTRAP_VERIFY_REJECTED: binding-id and project-id are required');
  }

  const verification = getProjectContextBindingIssuerVerifier(process.env);
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
  const binding = await mimers.artifactRepository.resolve<ProjectContextBindingArtifact>({
    artifact_id: bindingId,
    artifact_type: 'project_context_binding',
  });
  if (binding.payload.project_id !== projectId) {
    throw new Error('LU_PROJECT_CONTEXT_BOOTSTRAP_VERIFY_REJECTED: persisted binding project does not match issued project');
  }
  const propertyBinding = await mimers.artifactRepository.resolve<ProjectPropertyBindingArtifact>(
    binding.payload.project_property_binding_ref,
  );
  await verifyProjectContextBindingArtifactAuthority({
    artifact: propertyBinding,
    issuerRef: binding.payload.authority_ref,
    artifactRepository: mimers.artifactRepository,
    verification,
  });
  await verifyProjectContextBindingArtifactAuthority({
    artifact: binding,
    issuerRef: binding.payload.authority_ref,
    artifactRepository: mimers.artifactRepository,
    verification,
  });
  const indexed = await new PrismaProjectContextBindingIndex().resolve(projectId, binding.payload.project_context_ref);
  if (indexed !== binding.artifact_id) {
    throw new Error('LU_PROJECT_CONTEXT_BOOTSTRAP_VERIFY_REJECTED: persistent project-context index does not match CAS binding');
  }
  console.log(JSON.stringify({ verified: true, private_key_available: false, project_id: projectId, binding_artifact_id: binding.artifact_id }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
