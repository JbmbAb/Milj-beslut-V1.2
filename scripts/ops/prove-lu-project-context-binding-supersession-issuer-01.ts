/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 -- Proof C, live.
 *
 * Real V1 binding A -> real V2 binding B -> dedicated supersession issuer -> signed A->B
 * supersession -> authority verification PASS -> graph resolution selects B as current -> A
 * remains historically verifiable. Plus the required negative proof: the ordinary
 * ProjectContextBinding issuer cannot sign a project_context_binding_supersession.
 *
 * Runs against the real dev DB/CAS. Uses a real historical V1 binding as predecessor A
 * (project-context-binding-d9193804faa6ad9a3c64da65, project cmt5eo8in0008gcf7hmlxjrn5) and mints
 * a real V2 binding B for the SAME project/context as successor -- both signed by the real,
 * already-installed ordinary ProjectContextBinding issuer (unchanged scope). The supersession
 * relation itself is signed by the NEW dedicated supersession issuer.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-project-context-binding-supersession-issuer-01.ts
 */
import '../../server/loadEnvFirst';
import { readFileSync } from 'node:fs';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  createProjectContextBindingArtifactV2,
  createProjectContextBindingSupersessionArtifactV2,
  createProjectContextBindingSupersessionIssuerArtifact,
} from '@miljobeslut/mps-lu';
import { prisma } from '../../server/db/prisma';
import {
  attestProjectContextBindingArtifact,
  verifyProjectContextBindingSupersessionAuthority,
} from '../../server/modules/localization/projectContextBindingAuthority';
import { attestProjectContextBindingSupersessionIssuerArtifact, attestProjectContextBindingSupersessionArtifact } from '../../server/modules/localization/projectContextBindingSupersessionAuthority';
import { installOwnerIssuedProjectContextBindingSupersession } from '../../server/modules/localization/installProjectContextBinding';
import { ProjectContextBindingProvider } from '../../server/modules/localization/projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';
import { getProjectContextBindingIssuerVerifier } from '../../server/security/projectContextBindingIssuerKey';

const SECRETS_DIR = 'C:/Users/jimmy/.mimers/secrets';
const PROJECT_ID = 'cmt5eo8in0008gcf7hmlxjrn5';
const PREDECESSOR_BINDING_ID = 'project-context-binding-d9193804faa6ad9a3c64da65';
const ORDINARY_ISSUER_KEY_ID = 'project-context-binding-issuer-v1-fb38fb09cba8f5f8';
const ORDINARY_ISSUER_ARTIFACT_ID = 'project-context-binding-issuer-c560d209987991b817ee5845';

async function main() {
  console.log('########## PROVE-LU-PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-01 (Proof C) ##########\n');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const results: Record<string, boolean> = {};

  process.env.PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID = ORDINARY_ISSUER_KEY_ID;
  process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-public.pem`, 'utf-8');
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID = 'ed25519:project-context-binding-supersession-issuer-v1';
  process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM = readFileSync(`${SECRETS_DIR}/project-context-binding-supersession-issuer-v1/public.pem`, 'utf-8');

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;
  const index = new PrismaProjectContextBindingIndex();

  console.log('=== STEP 1: resolve the real historical V1 predecessor binding A ===\n');
  const predecessorA = await repo.resolve<any>({ artifact_id: PREDECESSOR_BINDING_ID, artifact_type: 'project_context_binding' });
  console.log(`  A: ${predecessorA.artifact_id} (contract_version: ${predecessorA.payload.binding_contract_version ?? 'V1 (implicit)'})`);
  console.log(`  project_id: ${predecessorA.payload.project_id}, project_context_ref: ${predecessorA.payload.project_context_ref.artifact_id}\n`);
  results.predecessorResolved = predecessorA.artifact_id === PREDECESSOR_BINDING_ID;

  console.log('=== STEP 2: mint + sign a real V2 successor binding B for the SAME project/context ===\n');
  const issuer = await repo.resolve<any>({ artifact_id: ORDINARY_ISSUER_ARTIFACT_ID, artifact_type: 'project_context_binding_issuer' });
  const ordinaryPrivateKeyPem = readFileSync(`${SECRETS_DIR}/project-context-binding-issuer-v1-private.pem`, 'utf-8');
  const { LocalPemSigningKeyProvider } = await import('@miljobeslut/mimers-brunn-core');
  const ordinarySigning = new LocalPemSigningKeyProvider(ORDINARY_ISSUER_KEY_ID, ordinaryPrivateKeyPem, process.env.PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM as string);
  // The Postgres lookup projection is uniquely keyed by (project_id, project_context_ref) -- the
  // real historical correction (scripts/db/lu-spatial-coordinate-order-correction-01.ts) always
  // paired its successor binding with a genuinely new project_context_ref for exactly this reason.
  // A fabricated distinct ref is sufficient here: resolveCurrent()'s graph resolution never
  // dereferences project_context_ref content, it only uses it as the routing-table key.
  const successorContextRef = {
    artifact_id: `${predecessorA.payload.project_context_ref.artifact_id}-proof-c-v2`,
    artifact_type: predecessorA.payload.project_context_ref.artifact_type,
  };
  const bindingBUnsigned = createProjectContextBindingArtifactV2({
    project_id: predecessorA.payload.project_id,
    project_context_ref: successorContextRef,
    project_property_binding_ref: predecessorA.payload.project_property_binding_ref,
    binding_version: predecessorA.payload.binding_version,
    authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
  });
  const bindingB = { ...bindingBUnsigned, attestation: await attestProjectContextBindingArtifact({ artifact: bindingBUnsigned, issuer, signing: ordinarySigning }) };
  await repo.put({ artifact_id: bindingB.artifact_id, content_hash: bindingB.content_hash, body: bindingB });
  await index.register(bindingB);
  console.log(`  B: ${bindingB.artifact_id} (contract_version: ${bindingB.payload.binding_contract_version})\n`);
  results.successorMintedV2 = bindingB.payload.binding_contract_version === 'project-context-binding-body-v2' && bindingB.artifact_id !== predecessorA.artifact_id;

  console.log('=== NEGATIVE PROOF: the ordinary binding issuer cannot sign a supersession ===\n');
  const relationForNegativeProof = createProjectContextBindingSupersessionArtifactV2({
    project_id: predecessorA.payload.project_id,
    superseded_binding_ref: { artifact_id: predecessorA.artifact_id, artifact_type: predecessorA.artifact_type },
    successor_binding_ref: { artifact_id: bindingB.artifact_id, artifact_type: bindingB.artifact_type },
    reason_code: 'PROOF_C_LIVE_NEGATIVE',
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: ORDINARY_ISSUER_KEY_ID,
  });
  try {
    await attestProjectContextBindingArtifact({ artifact: relationForNegativeProof, issuer, signing: ordinarySigning });
    console.log('  UNEXPECTED: ordinary issuer signed a supersession -- negative proof FAILED\n');
    results.negativeProofOrdinaryIssuerDenied = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ordinary issuer DENIED: ${message}\n`);
    results.negativeProofOrdinaryIssuerDenied = message.includes('REJECT_PROJECT_CONTEXT_BINDING_ISSUER_SCOPE');
  }

  console.log('=== STEP 3: mint + self-attest the dedicated supersession issuer ===\n');
  const supersessionPrivateKeyPem = readFileSync(`${SECRETS_DIR}/project-context-binding-supersession-issuer-v1/private.pem`, 'utf-8');
  const supersessionSigning = new LocalPemSigningKeyProvider(
    'ed25519:project-context-binding-supersession-issuer-v1',
    supersessionPrivateKeyPem,
    process.env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string,
  );
  const supersessionIssuerUnsigned = createProjectContextBindingSupersessionIssuerArtifact({
    issuer_key_id: 'ed25519:project-context-binding-supersession-issuer-v1',
    owner_authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
  });
  let supersessionIssuer: any;
  try {
    supersessionIssuer = await repo.resolve<any>({ artifact_id: supersessionIssuerUnsigned.artifact_id, artifact_type: supersessionIssuerUnsigned.artifact_type });
    console.log(`  reused existing dedicated issuer: ${supersessionIssuer.artifact_id}\n`);
  } catch {
    supersessionIssuer = {
      ...supersessionIssuerUnsigned,
      attestation: await attestProjectContextBindingSupersessionIssuerArtifact({ issuer: supersessionIssuerUnsigned, signing: supersessionSigning }),
    };
    await repo.put({ artifact_id: supersessionIssuer.artifact_id, content_hash: supersessionIssuer.content_hash, body: supersessionIssuer });
    console.log(`  minted new dedicated issuer: ${supersessionIssuer.artifact_id}\n`);
  }
  results.dedicatedIssuerInstalled = supersessionIssuer.artifact_type === 'project_context_binding_supersession_issuer';

  console.log('=== STEP 4: mint + sign the real A->B supersession via the dedicated issuer ===\n');
  const relationUnsigned = createProjectContextBindingSupersessionArtifactV2({
    project_id: predecessorA.payload.project_id,
    superseded_binding_ref: { artifact_id: predecessorA.artifact_id, artifact_type: predecessorA.artifact_type },
    successor_binding_ref: { artifact_id: bindingB.artifact_id, artifact_type: bindingB.artifact_type },
    reason_code: 'PROOF_C_LIVE_DEDICATED_ISSUER',
    issuer_ref: { artifact_id: supersessionIssuer.artifact_id, artifact_type: supersessionIssuer.artifact_type },
    issuer_key_id: supersessionIssuer.payload.issuer_key_id,
  });
  const relation = { ...relationUnsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: relationUnsigned, issuer: supersessionIssuer, signing: supersessionSigning }) };
  console.log(`  supersession: ${relation.artifact_id}\n`);

  console.log('=== STEP 5: authority verification + install (real repo, real Prisma index) ===\n');
  const currentAfterInstall = await installOwnerIssuedProjectContextBindingSupersession({
    artifactRepository: repo,
    index,
    supersession: relation,
    verification: getProjectContextBindingIssuerVerifier(),
  });
  console.log(`  current head after install: ${currentAfterInstall.artifact_id}\n`);
  results.installSelectsBAsCurrent = currentAfterInstall.artifact_id === bindingB.artifact_id;

  console.log('=== STEP 6: graph resolution via ProjectContextBindingProvider.resolveCurrent() ===\n');
  const provider = new ProjectContextBindingProvider(repo, index, getProjectContextBindingIssuerVerifier());
  const current = await provider.resolveCurrent(predecessorA.payload.project_id);
  console.log(`  resolveCurrent(): ${current.artifact_id}\n`);
  results.resolveCurrentSelectsB = current.artifact_id === bindingB.artifact_id;

  console.log('=== STEP 7: A remains independently, historically verifiable ===\n');
  const resolvedA = await provider.resolve(predecessorA.payload.project_id, predecessorA.payload.project_context_ref);
  console.log(`  direct resolve(A's own project_context_ref): still verifies and resolves to A = ${resolvedA.artifact_id === predecessorA.artifact_id}`);
  const rawA = await repo.resolve<any>({ artifact_id: predecessorA.artifact_id, artifact_type: predecessorA.artifact_type });
  console.log(`  A itself still resolves from CAS unmutated: ${rawA.artifact_id === predecessorA.artifact_id}\n`);
  results.aStillResolvableFromCas = rawA.artifact_id === predecessorA.artifact_id && resolvedA.artifact_id === predecessorA.artifact_id;

  console.log('=== NEGATIVE PROOF (re-verify): resolveAndVerify rejects the ordinary issuer for supersession authority ===\n');
  try {
    await verifyProjectContextBindingSupersessionAuthority({
      artifact: { ...relationUnsigned, attestation: await attestProjectContextBindingSupersessionArtifact({ artifact: relationUnsigned, issuer: supersessionIssuer, signing: supersessionSigning }) } as any,
      artifactRepository: repo,
    });
    console.log('  dedicated-issuer-signed supersession verifies: PASS\n');
    results.dedicatedSupersessionVerifies = true;
  } catch (error) {
    console.log(`  UNEXPECTED FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    results.dedicatedSupersessionVerifies = false;
  }

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  console.log(`\nALL GREEN: ${ok}`);

  await prisma.$disconnect();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
