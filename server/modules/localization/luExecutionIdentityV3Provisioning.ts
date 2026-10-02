/**
 * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01 Phase B + AUTHORITY-04E.
 *
 * SECURITY BOUNDARY: this module is imported ONLY by the standalone V3 provisioning worker
 * process (server/workers/lu-execution-identity-v3-worker.ts). It must never be imported by
 * server/createApp.ts, any request-handling route, or LuExecutionKernelClient.ts. The same
 * issuer/verifier split now provisions BOTH the ExecutionIdentity and its exact-attempt temporal
 * authorization ticket; the live web server still never holds LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM.
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
  LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV,
  LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
  LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
  LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
  assertLuExecutionAuthorityLifecycleCurrent,
  attestLuSourceAuthorityTemporalStatus,
  computeLuSourceAuthorityTemporalStatusArtifactId,
  createLuSourceAuthorityTemporalStatusArtifact,
  deriveLuCanonicalAssessmentAttemptRef,
  validateLuExecutionAuthorityRootArtifact,
  verifyLuExecutionAuthorityChain,
  verifyLuExecutionAuthorityLifecycle,
  verifyLuSourceAuthorityTemporalStatus,
  type LocalizationGeometryArtifact,
  type LuExecutionAuthorityLifecycleArtifact,
  type LuExecutionAuthorityRootArtifact,
  type LuSourceAuthorityTemporalStatusArtifact,
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
import {
  getLuExecutionAuthorityRootVerifier,
  getLuExecutionAuthorityVerifier,
} from '../../../packages/mps-lu/src/execution/LuExecutionAuthorityVerifier';
import { getLuExecutionAuthoritySigningProvider } from '../../security/luExecutionAuthoritySigningKey';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';
import { resolveCanonicalProjectContext } from '../../../src/application/resolveCanonicalProjectContext';
import { resolveCanonicalProductRelease } from '../release/productReleaseRuntime';
import {
  assertReadUnderItsOwnId,
  isProjectAccessDenied,
  isProvenBindingAbsence,
  LuReadFaultError,
  readExistingOrProvenAbsent,
  toReadFaultError,
} from './readFaultClassification';
import { provisioningFailure, provisioningReadFaultDetailSv, trackArtifactWrites, type ProvisioningWrites } from './provisioningFailure';

const PRIVATE_KEY_ENV = 'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM';
const ISSUER_ARTIFACT_ID_ENV = 'LU_EXECUTION_AUTHORITY_ISSUER_ARTIFACT_ID';
const EXECUTION_CONTRACT_VERSION = 'lu-execution-identity-v1';

export type ProvisioningOutcome =
  | { readonly ok: true; readonly executionIdentityArtifactId: string; readonly reused: boolean }
  | {
      readonly ok: false;
      readonly failureCode: string;
      readonly failureDetail: string;
      /** W-CATCH2: raw fault text for the worker's log only -- never stored, never sent. */
      readonly diagnostic?: string;
    };

function fail(code: string, detail: string): never {
  const error = new Error(detail) as Error & { failureCode: string };
  error.failureCode = code;
  throw error;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail('TEMPORAL_AUTHORITY_CONFIGURATION_MISSING', `${name} is required`);
  return value;
}

/** Fresh child process, private key deleted from its env first. */
async function runFreshVerifier(identityArtifactId: string, projectId: string, geometryArtifactId: string): Promise<void> {
  const env = { ...process.env };
  delete env[PRIVATE_KEY_ENV];
  let scriptPath: string;
  try {
    scriptPath = fileURLToPath(new URL('./luExecutionIdentityV3VerifyCli.ts', import.meta.url));
  } catch {
    // CATCH-REVIEWED: NOT_A_READ: locating the verifier script when import.meta.url is not a file URL; no CAS, index or database read.
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

async function ensureTemporalAuthorization(args: {
  readonly repo: Awaited<ReturnType<typeof MimersIntegration.create>>['artifactRepository'];
  readonly identity: ExecutionIdentityArtifact;
  readonly issuerRef: { readonly artifact_id: string; readonly artifact_type: typeof LU_EXECUTION_AUTHORITY_ISSUER_TYPE };
  readonly subject: ExecutionIdentitySubjectV3;
}): Promise<LuSourceAuthorityTemporalStatusArtifact> {
  const rootVerification = getLuExecutionAuthorityRootVerifier();
  const issuerVerification = getLuExecutionAuthorityVerifier();
  const verifiedIssuer = await verifyLuExecutionAuthorityChain({
    issuerRef: args.issuerRef,
    repository: args.repo,
    rootVerification,
    issuerVerification,
  });
  const verifiedRoot = validateLuExecutionAuthorityRootArtifact(
    await args.repo.resolve<LuExecutionAuthorityRootArtifact>(verifiedIssuer.payload.root_ref),
  );

  const lifecycleId = requiredEnv(LU_EXECUTION_AUTHORITY_LIFECYCLE_ID_ENV);
  const lifecycle = await args.repo.resolve<LuExecutionAuthorityLifecycleArtifact>({
    artifact_id: lifecycleId,
    artifact_type: LU_EXECUTION_AUTHORITY_LIFECYCLE_TYPE,
  });
  await verifyLuExecutionAuthorityLifecycle({
    lifecycle,
    root: verifiedRoot,
    issuer: verifiedIssuer,
    root_verification: rootVerification,
  });
  assertLuExecutionAuthorityLifecycleCurrent(lifecycle);

  const attemptRef = deriveLuCanonicalAssessmentAttemptRef(args.subject);
  const subjectRef = { artifact_id: args.identity.artifact_id, artifact_type: args.identity.artifact_type } as const;
  const lifecycleRef = { artifact_id: lifecycle.artifact_id, artifact_type: lifecycle.artifact_type } as const;
  const expectedRef = {
    artifact_id: computeLuSourceAuthorityTemporalStatusArtifactId({
      subject_ref: subjectRef,
      attempt_ref: attemptRef,
      lifecycle_ref: lifecycleRef,
      action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    }),
    artifact_type: LU_SOURCE_AUTHORITY_TEMPORAL_STATUS_TYPE,
  } as const;

  // W-CATCH2 #12 (:147, OD-R2): mint ONLY on the proven absence of exactly this deterministic id. A read
  // error or a damaged existing status is a typed fault -- never "not there", never minted over.
  const read = await readExistingOrProvenAbsent<LuSourceAuthorityTemporalStatusArtifact>(args.repo, expectedRef, 'temporal-authorization');
  if (read.found) {
    const existing = read.value;
    // W-CATCH3 (owner decision: provisioning bound to exactly the requested id and content): the object
    // under the deterministic id must BE that status -- another (even valid) status under a misdirected
    // index entry is a lasting integrity fault, never reused.
    assertReadUnderItsOwnId('temporal-authorization', existing, expectedRef.artifact_id);
    try {
      await verifyLuSourceAuthorityTemporalStatus({
        status: existing,
        issuer: verifiedIssuer,
        subject: args.identity,
        lifecycle,
        expected_attempt_ref: attemptRef,
        expected_action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
        issuer_verification: issuerVerification,
      });
    } catch (error) {
      throw toReadFaultError('temporal-authorization', error, 'verify');
    }
    return existing;
  }

  const decisionTime = new Date().toISOString();
  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: args.issuerRef,
    subject: args.identity,
    attempt_ref: attemptRef,
    lifecycle,
    action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    decision_time: decisionTime,
  });
  if (bareStatus.artifact_id !== expectedRef.artifact_id) {
    fail('TEMPORAL_AUTHORITY_IDENTITY_MISMATCH', 'derived temporal status identity mismatch');
  }
  const signing = getLuExecutionAuthoritySigningProvider();
  if (signing.keyId !== verifiedIssuer.payload.issuer_key_id) {
    fail('TEMPORAL_AUTHORITY_SIGNER_MISMATCH', 'provisioned signing key is not the verified LU issuer');
  }
  const status: LuSourceAuthorityTemporalStatusArtifact = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({ status: bareStatus, signing }),
  };
  await verifyLuSourceAuthorityTemporalStatus({
    status,
    issuer: verifiedIssuer,
    subject: args.identity,
    lifecycle,
    expected_attempt_ref: attemptRef,
    expected_action: LU_LOCALIZATION_ASSESSMENT_PERSIST_ACTION,
    issuer_verification: issuerVerification,
  });
  await args.repo.put({ artifact_id: status.artifact_id, content_hash: status.content_hash, body: status });
  return status;
}

/**
 * Executes (or reconciles) V3 identity + exact-attempt authority provisioning for one request.
 * A reused identity MUST also have its deterministic ticket for the CURRENT root-signed lifecycle
 * reconciled before success is returned. Lifecycle rotation therefore cannot silently reuse a
 * stale pre-revocation ticket.
 */
export async function executeLocalizationIdentityProvisioning(input: {
  readonly projectId: string;
  readonly geometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<ProvisioningOutcome> {
  // W-CATCH3 (CATCH2 verifier finding 3, shared provisioningFailure.ts): what this run has written, so the
  // stored text never says "Inget utfärdades." after a write was attempted.
  const writes: ProvisioningWrites = { written: false };
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
    } catch (error) {
      // W-CATCH2 (#14 class): only the access check's own denial is "not authorized".
      if (!isProjectAccessDenied(error)) throw toReadFaultError('project-access', error);
      fail('REQUESTER_NOT_AUTHORIZED', `user ${input.requestedByUserId} is not a member of project ${input.projectId}`);
    }

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const repo = trackArtifactWrites(mimers.artifactRepository, writes);

    let geometry: LocalizationGeometryArtifact;
    try {
      geometry = await repo.resolve<LocalizationGeometryArtifact>({
        artifact_id: input.geometryArtifactId,
        artifact_type: 'localization_geometry',
      });
      validateLocalizationGeometryArtifact(geometry);
    } catch (error) {
      // W-CATCH2: same code, a neutral text with the fault's class instead of the raw message.
      fail('GEOMETRY_UNAVAILABLE_OR_TAMPERED', provisioningReadFaultDetailSv(error, 'Den begärda kontrollpunkten'));
    }
    if (geometry!.payload.project_id !== input.projectId) {
      fail('GEOMETRY_PROJECT_MISMATCH', `geometry ${input.geometryArtifactId} belongs to project ${geometry!.payload.project_id}, not ${input.projectId}`);
    }

    let canonicalContext: Awaited<ReturnType<typeof resolveCanonicalProjectContext>>;
    try {
      canonicalContext = await resolveCanonicalProjectContext(input.projectId, repo);
    } catch (error) {
      // W-CATCH2 (#8 class): absence only when proven; any other failure keeps its class (CURRENT_BINDING_*).
      if (isProvenBindingAbsence(error)) fail('CURRENT_BINDING_UNAVAILABLE', 'Projektet har ingen registrerad koppling till fastigheten. Inget utfärdades.');
      throw toReadFaultError('current-binding', error);
    }
    if (
      geometry!.payload.property_context_ref.artifact_id !== canonicalContext.propertyContextRef.artifact_id ||
      geometry!.payload.property_context_ref.artifact_type !== canonicalContext.propertyContextRef.artifact_type
    ) {
      fail('GEOMETRY_PROPERTY_MISMATCH', `geometry ${input.geometryArtifactId} is not bound to project ${input.projectId}'s current property context`);
    }

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
      const identity = await repo.resolve<ExecutionIdentityArtifact>({
        artifact_id: reuseOutcome,
        artifact_type: 'execution_identity',
      });
      assertReadUnderItsOwnId('execution-identity', identity, reuseOutcome); // W-CATCH3: the same binding on the re-read
      await ensureTemporalAuthorization({ repo, identity, issuerRef, subject });
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

    await ensureTemporalAuthorization({ repo, identity, issuerRef, subject });
    await runFreshVerifier(identity.artifact_id, input.projectId, input.geometryArtifactId);

    return { ok: true, executionIdentityArtifactId: identity.artifact_id, reused: false };
  } catch (error) {
    // W-CATCH2: a stable code by class and a neutral text (provisioningFailure.ts); never the raw message.
    return { ok: false, ...provisioningFailure(error, writes) };
  }
}

async function tryReuseExistingIdentity(args: {
  readonly repo: Awaited<ReturnType<typeof MimersIntegration.create>>['artifactRepository'];
  readonly expectedIdentityId: string;
  readonly subject: ExecutionIdentitySubjectV3;
  readonly expectedPredicate: ReturnType<typeof buildExecutionIdentityAttestationPredicate>;
}): Promise<string | null> {
  // W-CATCH2 #12 (:348/:354, OD-R2): "not there" ONLY on the proven absence of exactly the deterministic
  // id. A read error or a damaged existing identity/attestation is a typed fault, never re-issued over.
  const identityRead = await readExistingOrProvenAbsent<ExecutionIdentityArtifact>(
    args.repo,
    { artifact_id: args.expectedIdentityId, artifact_type: 'execution_identity' },
    'execution-identity',
  );
  if (!identityRead.found) return null; // proven absence: proceed to issue.
  const existing = identityRead.value;
  // W-CATCH3 (owner decision: provisioning bound to exactly the requested id and content): the object
  // under the deterministic id must BE that identity -- another (even valid) identity under a
  // misdirected index entry is a lasting integrity fault; its content is bound below by the attestation
  // and the expected predicate/subject.
  assertReadUnderItsOwnId('execution-identity', existing, args.expectedIdentityId);
  const envelopeRef = existing?.signature_envelope_ref;
  if (!envelopeRef?.artifact_id || !envelopeRef.artifact_type) {
    throw new LuReadFaultError('execution-identity', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error('the stored identity names no attestation'));
  }
  const attestationRead = await readExistingOrProvenAbsent(args.repo, envelopeRef, 'execution-identity-attestation');
  // The attestation is written right after the identity: its proven absence is a crash between the two
  // writes, and re-issuing writes the identical identity bytes again plus the missing attestation.
  if (!attestationRead.found) return null;
  let result: Awaited<ReturnType<typeof verifyExecutionIdentityAttestation>>;
  try {
    result = await verifyExecutionIdentityAttestation({
      identity: existing,
      attestation: attestationRead.value as Parameters<typeof verifyExecutionIdentityAttestation>[0]['attestation'],
      expectedPredicate: args.expectedPredicate,
      authorityVerifier: getLuExecutionAuthorityVerifier(),
      expectedSubjectV3: args.subject,
    });
  } catch (error) {
    throw toReadFaultError('execution-identity', error, 'verify');
  }
  if (!result.verified) {
    // W-CATCH2 #12: an existing identity under this exact id that does not verify is never re-issued over
    // (the same id: either the same bytes, or a WORM/collision error) -- a typed refusal instead.
    throw new LuReadFaultError('execution-identity', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error(`identity attestation did not verify (${String((result as { reason?: unknown }).reason ?? 'UNVERIFIED')})`));
  }
  return existing.artifact_id;
}
