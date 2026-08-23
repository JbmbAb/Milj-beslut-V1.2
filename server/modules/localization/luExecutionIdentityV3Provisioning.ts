/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B.
 *
 * SECURITY BOUNDARY: this module is imported ONLY by the standalone V3 provisioning worker
 * process (server/workers/lu-execution-identity-v3-worker.ts). It must never be imported by
 * server/createApp.ts, any request-handling route, or LuExecutionKernelClient.ts -- the same
 * PROD-LU-ADMISSION-02 issuer/verifier split reapplied here: the live web server enqueues a
 * request and reads status; it must never hold LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM.
 *
 * PINNING (owner-frozen, PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase A recon): the
 * request names an EXACT `geometryArtifactId`, decided at enqueue time. This module mints an
 * ExecutionIdentity V3 scoped to exactly that geometry -- it never re-resolves "current
 * localization geometry" at lease time. That is what makes save-A-then-save-B safe: a request for
 * A, even if it finishes after B has become current, can only ever produce a valid-but-non-current
 * historical identity for A, because normal LU execution always derives its expected V3 subject
 * from whatever is CURRENT at run time, never from "the most recently issued identity". Stale A
 * requests are allowed to complete normally, as long as the pinned geometry is still CAS-valid.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  deriveLuExecutionSeed,
  validateLocalizationGeometryArtifact,
  createLuRegistryRuntime,
  LU_SITE_ASSESSMENT_CAPABILITY_KEY,
  LU_EXECUTION_PRINCIPAL_ID,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import type { ExecutionIdentityArtifact } from '../../../packages/mps-runtime/src/execution/ExecutionIdentityArtifact';
import {
  computeExecutionIdentityArtifactIdV3,
  type ExecutionIdentitySubjectV3,
} from '../../../packages/mps-runtime/src/execution/ExecutionIdentityScopeV2';
import {
  buildExecutionIdentityAttestationPredicate,
  verifyExecutionIdentityAttestation,
} from '../../../packages/mps-lu/src/execution/ExecutionIdentityAttestation';
import { issueExecutionIdentityV3 } from '../../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer';
import { getLuExecutionAuthorityVerifier } from '../../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';
import { resolveCanonicalProjectContext } from '../../../src/application/resolveCanonicalProjectContext';
import { resolveCanonicalProductRelease } from '../release/productReleaseRuntime';

const PRIVATE_KEY_ENV = 'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM';
const ISSUER_ARTIFACT_ID_ENV = 'LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID';
const EXECUTION_CONTRACT_VERSION = 'lu-execution-identity-v1';

export type ProvisioningOutcome =
  | { readonly ok: true; readonly executionIdentityArtifactId: string; readonly reused: boolean }
  | { readonly ok: false; readonly failureCode: string; readonly failureDetail: string };

function fail(code: string, detail: string): never {
  const error = new Error(detail) as Error & { failureCode: string };
  error.failureCode = code;
  throw error;
}

/** Fresh child process, private key deleted from its env first -- same pattern as luProjectContextBootstrap.ts's runFreshVerifier. */
async function runFreshVerifier(identityArtifactId: string, projectId: string, geometryArtifactId: string): Promise<void> {
  const env = { ...process.env };
  delete env[PRIVATE_KEY_ENV];
  // import.meta.url is not always a resolvable file:// URL under a test runner's module
  // transform (e.g. vitest) -- fall back to a repo-root-relative path, which is valid in both
  // real execution (this module only ever runs from the repo root, like every worker/ops script
  // in this codebase) and under test.
  let scriptPath: string;
  try {
    scriptPath = fileURLToPath(new URL('./luExecutionIdentityV3VerifyCli.ts', import.meta.url));
  } catch {
    scriptPath = path.resolve(process.cwd(), 'server/modules/localization/luExecutionIdentityV3VerifyCli.ts');
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, identityArtifactId, projectId, geometryArtifactId], {
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) fail('FRESH_VERIFICATION_FAILED', 'fresh public-key-only verification of the newly issued identity failed');
}

/**
 * Executes (or reconciles) V3 identity provisioning for exactly one request. Idempotent: if a
 * valid identity for the exact derived subject already exists (same property + binding + release
 * + contract + PINNED geometry), it is recognized and reused -- never re-minted. Safe to retry
 * after a crash at any point: content-addressing means a retry either finds the already-genuine
 * identity (reused: true) or mints exactly once.
 */
export async function executeLocalizationIdentityProvisioning(input: {
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<ProvisioningOutcome> {
  try {
    const issuerArtifactId = process.env[ISSUER_ARTIFACT_ID_ENV]?.trim();
    if (!issuerArtifactId) fail('ISSUER_CONFIGURATION_MISSING', `${ISSUER_ARTIFACT_ID_ENV} is required`);
    const issuerRef = { artifact_id: issuerArtifactId, artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE } as const;

    const requester = await prisma.user.findUnique({
      where: { id: input.requestedByUserId },
      select: { id: true, organisationId: true, bankidId: true, role: true, identityEnvironment: true },
    });
    if (!requester?.organisationId) fail('REQUESTER_NOT_AUTHORIZED', `requesting user ${input.requestedByUserId} has no organisation membership`);
    try {
      await assertProjectAccess(
        { ...requester, identityEnvironment: requester.identityEnvironment as 'MOCK' | 'TEST' | 'PRODUCTION' | 'LEGACY' | undefined },
        input.projectId,
        requester.organisationId,
      );
    } catch {
      fail('REQUESTER_NOT_AUTHORIZED', `user ${input.requestedByUserId} is not a member of project ${input.projectId}`);
    }

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const repo = mimers.artifactRepository;

    let geometry: LocalizationGeometryArtifact;
    try {
      geometry = await repo.resolve<LocalizationGeometryArtifact>({
        artifact_id: input.geometryArtifactId,
        artifact_type: 'localization_geometry',
      });
      validateLocalizationGeometryArtifact(geometry);
    } catch (error) {
      fail('GEOMETRY_UNAVAILABLE_OR_TAMPERED', error instanceof Error ? error.message : String(error));
    }
    if (geometry!.payload.project_id !== input.projectId) {
      fail('GEOMETRY_PROJECT_MISMATCH', `geometry ${input.geometryArtifactId} belongs to project ${geometry!.payload.project_id}, not ${input.projectId}`);
    }

    const canonicalContext = await resolveCanonicalProjectContext(input.projectId, repo);
    if (
      geometry!.payload.property_context_ref.artifact_id !== canonicalContext.propertyContextRef.artifact_id ||
      geometry!.payload.property_context_ref.artifact_type !== canonicalContext.propertyContextRef.artifact_type
    ) {
      fail('GEOMETRY_PROPERTY_MISMATCH', `geometry ${input.geometryArtifactId} is not bound to project ${input.projectId}'s current property context`);
    }

    // PRODUCT-RELEASE-AUTHORITY-BINDING-V1 (H13): trusted-issuer-signed release only.
    const canonicalRelease = await resolveCanonicalProductRelease({ artifactRepository: repo });
    const currentRelease = {
      releaseRef: { artifact_id: canonicalRelease.artifact_id, artifact_type: canonicalRelease.artifact_type },
      releaseHash: canonicalRelease.release_hash.value,
    };
    const registry = createLuRegistryRuntime();
    const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
    if (!capability) fail('CAPABILITY_UNAVAILABLE', 'LU site-assessment capability is not registered');

    const geometryRef = { artifact_id: geometry!.artifact_id, artifact_type: geometry!.artifact_type } as const;
    const subject: ExecutionIdentitySubjectV3 = {
      site_id: canonicalContext.propertyIdentity,
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      execution_contract_version: EXECUTION_CONTRACT_VERSION,
      localization_geometry_ref: geometryRef,
    };
    const deterministicSeed = deriveLuExecutionSeed({
      site_id: subject.site_id,
      project_id: input.projectId,
      project_context_ref: canonicalContext.projectContextRef,
      property_context_ref: canonicalContext.propertyContextRef,
      project_context_binding_ref: canonicalContext.contextBindingRef,
      product_release_ref: currentRelease.releaseRef,
      product_release_hash: currentRelease.releaseHash,
      execution_contract_version: EXECUTION_CONTRACT_VERSION,
      rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
      localization_geometry_ref: geometryRef,
    });
    const releaseSnapshotId = registry.getReleaseSnapshot().snapshot_id;
    const actorRef = { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: 'execution_identity' as const };
    const capabilityRef = { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type };
    const expectedIdentityId = computeExecutionIdentityArtifactIdV3(subject);

    // Reconciliation-first: an identity for this EXACT subject may already exist (a prior attempt
    // got far enough to mint, or a duplicate request for the same point). Never re-mint; verify
    // and reuse.
    const reuseOutcome = await tryReuseExistingIdentity({
      repo,
      expectedIdentityId,
      subject,
      expectedPredicate: buildExecutionIdentityAttestationPredicate({
        execution_identity_id: expectedIdentityId,
        actor_ref: actorRef,
        capability_ref: capabilityRef,
        release_snapshot_id: releaseSnapshotId,
        site_id: subject.site_id,
        deterministic_seed: deterministicSeed,
      }),
    });
    if (reuseOutcome) {
      return { ok: true, executionIdentityArtifactId: reuseOutcome, reused: true };
    }

    const identity = await issueExecutionIdentityV3({
      subject,
      deterministic_seed: deterministicSeed,
      actor_ref: actorRef,
      capability_ref: capabilityRef,
      release_snapshot_id: releaseSnapshotId,
      issuer_ref: issuerRef,
      governed_references: [
        canonicalContext.contextBindingRef,
        canonicalContext.projectContextRef,
        canonicalContext.propertyContextRef,
        currentRelease.releaseRef,
        geometryRef,
      ],
      artifact_repository: repo,
    });

    await runFreshVerifier(identity.artifact_id, input.projectId, input.geometryArtifactId);

    return { ok: true, executionIdentityArtifactId: identity.artifact_id, reused: false };
  } catch (error) {
    const failureCode = (error as { failureCode?: string })?.failureCode ?? 'PROVISIONING_EXECUTION_ERROR';
    const failureDetail = error instanceof Error ? error.message : String(error);
    return { ok: false, failureCode, failureDetail };
  }
}

async function tryReuseExistingIdentity(args: {
  readonly repo: Awaited<ReturnType<typeof MimersIntegration.create>>['artifactRepository'];
  readonly expectedIdentityId: string;
  readonly subject: ExecutionIdentitySubjectV3;
  readonly expectedPredicate: ReturnType<typeof buildExecutionIdentityAttestationPredicate>;
}): Promise<string | null> {
  let existing: ExecutionIdentityArtifact;
  try {
    existing = await args.repo.resolve<ExecutionIdentityArtifact>({
      artifact_id: args.expectedIdentityId,
      artifact_type: 'execution_identity',
    });
  } catch {
    return null; // not minted yet -- proceed to issue.
  }
  let attestation;
  try {
    attestation = await args.repo.resolve(existing.signature_envelope_ref);
  } catch {
    return null; // orphaned/partial CAS state from a crashed prior attempt -- re-issue rather than trust it.
  }
  const result = await verifyExecutionIdentityAttestation({
    identity: existing,
    attestation: attestation as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
    expectedPredicate: args.expectedPredicate,
    authorityVerifier: getLuExecutionAuthorityVerifier(),
    expectedSubjectV3: args.subject,
  });
  return result.verified ? existing.artifact_id : null;
}
