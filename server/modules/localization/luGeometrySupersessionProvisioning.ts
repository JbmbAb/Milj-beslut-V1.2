/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * SECURITY BOUNDARY: this module is imported ONLY by the standalone geometry-supersession
 * provisioning worker process (server/workers/lu-geometry-supersession-worker.ts). It must never
 * be imported by server/createApp.ts or any request-handling route -- the live web server enqueues
 * a request (pinning the exact predecessor/successor the user just observed) and reads status; it
 * must never hold LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM.
 *
 * PINNING: the request names an EXACT (predecessorGeometryArtifactId, successorGeometryArtifactId)
 * pair, decided at enqueue time by the web layer (which knows what the user's project actually
 * showed as current at save time). This module NEVER substitutes "whatever resolveCurrent()
 * returns right now" as the predecessor -- it only ever attempts the exact pinned transition. If
 * the pinned predecessor is no longer the verified current head when this runs, the request is
 * marked SUPERSEDED (never mutated into a different pair) -- the caller (web layer) is responsible
 * for observing the new current state and, if the user's edit is still relevant, enqueueing a
 * fresh request against it.
 */
import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import {
  createLocalizationGeometrySupersessionIssuerArtifact,
  createLocalizationGeometrySupersessionArtifact,
  validateLocalizationGeometryArtifact,
  LEGACY_CURRENTNESS_MIGRATION_REASON_CODE,
  type LocalizationGeometryArtifact,
  type LocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestLocalizationGeometrySupersessionIssuerArtifact,
  attestLocalizationGeometrySupersessionArtifact,
  verifyLocalizationGeometrySupersessionArtifact,
  verifyLocalizationGeometrySupersessionIssuerArtifact,
} from './localizationGeometrySupersessionAuthority';
import { getLocalizationGeometrySupersessionSigningProvider } from '../../security/localizationGeometrySupersessionSigningKey';
import { getLocalizationGeometrySupersessionVerifier } from '../../security/localizationGeometrySupersessionVerifier';
import { LocalizationGeometryCurrentProvider } from './localizationGeometryCurrentProvider';
import { PrismaLocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import { registerLocalizationGeometry } from './localizationGeometryProjection';
import { PrismaLocalizationGeometrySupersessionIndex } from '../../repositories/localizationGeometrySupersessionRepository';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';
import {
  assertReadUnderItsOwnId,
  isExactlyTheDeterministicArtifact,
  isProjectAccessDenied,
  LuReadFaultError,
  readExistingOrProvenAbsent,
  toReadFaultError,
} from './readFaultClassification';
import { provisioningFailure, provisioningReadFaultDetailSv, trackArtifactWrites, type ProvisioningWrites } from './provisioningFailure';
import { classifyLocalizationGeometryCurrentnessError, LocalizationGeometryCurrentnessError } from './localizationGeometryCurrentness';

/** Real user-action reason code -- distinct from LEGACY_CURRENTNESS_MIGRATION_REASON_CODE, which
 *  is reserved for the one-time historical backfill and must never be used by this live worker. */
const USER_LOCALIZATION_CHANGE_REASON_CODE = 'USER_LOCALIZATION_CHANGE_V1';
const OWNER_AUTHORITY_REF = {
  artifact_id: 'owner-authority-automated-localization-geometry-supersession-provisioning-v1',
  artifact_type: 'owner_authority_attestation',
} as const;

export type GeometrySupersessionProvisioningOutcome =
  | { readonly ok: true; readonly supersessionArtifactId: string; readonly reused: boolean }
  | { readonly ok: false; readonly superseded: true; readonly detail: string }
  | {
      readonly ok: false;
      readonly superseded: false;
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

/**
 * W-CATCH3-R2 (CATCH3 verifier finding 1, HIGH): a pinned point read under its id must BE that point
 * before anything uses it -- validateLocalizationGeometryArtifact only proves the object is
 * self-consistent. Otherwise a misdirected index entry (B -> C) made the request A->B COMPLETED with a
 * signed relation A->C and C -- a point the user never chose -- current. A mismatch is a lasting
 * integrity fault (the caller's PREDECESSOR_/SUCCESSOR_GEOMETRY_UNAVAILABLE, class
 * STORAGE_INTEGRITY_FAULT); nothing is minted or written.
 */
async function readPinnedGeometry(repo: ArtifactRepositoryPort, artifactId: string, subject: string): Promise<LocalizationGeometryArtifact> {
  const read = await repo.resolve<unknown>({ artifact_id: artifactId, artifact_type: 'localization_geometry' });
  assertReadUnderItsOwnId(subject, read, artifactId, 'localization_geometry');
  return validateLocalizationGeometryArtifact(read as LocalizationGeometryArtifact);
}

async function getOrMintIssuer(
  repo: ArtifactRepositoryPort,
  verification: Parameters<typeof verifyLocalizationGeometrySupersessionIssuerArtifact>[0]['verification'],
): Promise<LocalizationGeometrySupersessionIssuerArtifact> {
  const signing = getLocalizationGeometrySupersessionSigningProvider();
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: signing.keyId,
    owner_authority_ref: OWNER_AUTHORITY_REF,
  });
  // W-CATCH2 #11 (OD-R2): mint ONLY on the proven absence of exactly this deterministic id. A read error
  // or a damaged existing issuer is a typed fault -- never "not minted yet", never minted over.
  const read = await readExistingOrProvenAbsent<LocalizationGeometrySupersessionIssuerArtifact>(
    repo,
    { artifact_id: bareIssuer.artifact_id, artifact_type: bareIssuer.artifact_type },
    'geometry-supersession-issuer',
  );
  if (read.found) {
    const existing = read.value;
    // W-CATCH3 (CATCH2 verifier finding 2): the object under the issuer's id must BE the issuer -- an index
    // entry pointing at another object is a lasting integrity fault, never a refusal of "this issuer".
    assertReadUnderItsOwnId('geometry-supersession-issuer', existing, bareIssuer.artifact_id, bareIssuer.artifact_type);
    // Same deterministic identity, so it must be exactly this issuer, field for field (before: anything
    // else fell through to a re-mint; an edit that kept id, content_hash and key id was accepted).
    if (!isExactlyTheDeterministicArtifact(existing, bareIssuer)) {
      throw new LuReadFaultError('geometry-supersession-issuer', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error('the stored issuer is not the issuer its id names'));
    }
    // W-CATCH3 (CATCH2 verifier finding 3, probe S1b): the field-for-field comparison leaves out the
    // attestation, so the existing (global) issuer is verified against the trusted key before it is used
    // for anything -- a damaged signature is EXISTING_ARTIFACT_REFUSED here, before any write.
    try {
      await verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer: existing, verification });
    } catch (error) {
      throw toReadFaultError('geometry-supersession-issuer', error, 'verify');
    }
    return existing;
  }
  const attestation = await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing });
  const issuer: LocalizationGeometrySupersessionIssuerArtifact = { ...bareIssuer, attestation };
  // W-CATCH3: a new issuer is verified BEFORE it is written -- a verification key that does not verify it
  // (a configuration error) writes nothing.
  await verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer, verification });
  await repo.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
  return issuer;
}

/**
 * Executes (or reconciles) geometry-supersession provisioning for exactly one request.
 * Reconciliation-first: `issued_at` is derived from the REQUEST's own immutable `createdAt` (a
 * durable Postgres row, stable across retries/reclaims), never wall-clock mint time -- so every
 * retry of the exact same request computes the identical content-addressed supersession
 * artifact_id, and a crash after CAS-put-but-before-projection-register is safely recovered by a
 * retry finding (not re-signing) the existing artifact.
 */
export async function executeGeometrySupersessionProvisioning(input: {
  readonly requestId: string;
  readonly requestCreatedAt: Date;
  readonly projectId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly requestedByUserId: string;
}): Promise<GeometrySupersessionProvisioningOutcome> {
  // W-CATCH3 (CATCH2 verifier finding 3): what this run has written, so the stored text never says
  // "Inget utfärdades." after a write was attempted.
  const writes: ProvisioningWrites = { written: false };
  try {
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
    const verification = getLocalizationGeometrySupersessionVerifier();
    const currentProvider = new LocalizationGeometryCurrentProvider(
      repo,
      new PrismaLocalizationGeometryProjectionIndex(),
      new PrismaLocalizationGeometrySupersessionIndex(),
      verification,
    );

    let predecessor: LocalizationGeometryArtifact;
    try {
      predecessor = await readPinnedGeometry(repo, input.predecessorGeometryArtifactId, 'pinned-predecessor-geometry');
    } catch (error) {
      // W-CATCH2: same code, a neutral text with the fault's class instead of the raw message.
      fail('PREDECESSOR_GEOMETRY_UNAVAILABLE', provisioningReadFaultDetailSv(error, 'Den tidigare kontrollpunkten'));
    }
    if (predecessor!.payload.project_id !== input.projectId) fail('PREDECESSOR_GEOMETRY_PROJECT_MISMATCH', 'predecessor geometry does not belong to this project');

    let successor: LocalizationGeometryArtifact;
    try {
      successor = await readPinnedGeometry(repo, input.successorGeometryArtifactId, 'pinned-successor-geometry');
    } catch (error) {
      // W-CATCH2: same code, a neutral text with the fault's class instead of the raw message.
      fail('SUCCESSOR_GEOMETRY_UNAVAILABLE', provisioningReadFaultDetailSv(error, 'Den nya kontrollpunkten'));
    }
    if (successor!.payload.project_id !== input.projectId) fail('SUCCESSOR_GEOMETRY_PROJECT_MISMATCH', 'successor geometry does not belong to this project');

    const issuer = await getOrMintIssuer(repo, verification);
    const signing = getLocalizationGeometrySupersessionSigningProvider();

    const barePayloadInput = {
      project_id: input.projectId,
      predecessor_geometry_ref: { artifact_id: predecessor!.artifact_id, artifact_type: predecessor!.artifact_type },
      successor_geometry_ref: { artifact_id: successor!.artifact_id, artifact_type: successor!.artifact_type },
      reason_code: USER_LOCALIZATION_CHANGE_REASON_CODE,
      issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
      issuer_key_id: signing.keyId,
      issued_at: input.requestCreatedAt.toISOString(),
    };
    const bareArtifact = createLocalizationGeometrySupersessionArtifact(barePayloadInput);

    // Reconciliation-first, BEFORE the currentness gate: a retry/reclaim of THIS EXACT request
    // (same requestCreatedAt -> same deterministic issued_at -> same content-addressed
    // artifact_id) may run after a prior attempt already completed the CAS write and the edge
    // registration, but crashed before the queue row was marked COMPLETED. At that point the
    // successor IS already current -- which would make the naive currentness gate below wrongly
    // read as "predecessor superseded" and mark this SUPERSEDED, even though nothing is actually
    // stale; it's this exact request's own prior success. Recognizing reuse first means a retry
    // of an already-completed transition always reports success, never a false SUPERSEDED.
    const reused = await tryReuseExistingSupersession({ repo, bareArtifact, issuer, verification });
    if (reused) {
      writes.written = true; // W-CATCH3: the projection and edge rows are writes too.
      await registerLocalizationGeometry({ projectId: input.projectId, geometry: successor! });
      await registerEdge(input.projectId, reused, input.predecessorGeometryArtifactId, input.successorGeometryArtifactId);
      return { ok: true, supersessionArtifactId: reused, reused: true };
    }

    // Currentness gate: never substitute the actual current head as the predecessor -- if it does
    // not match the pinned one, this exact transition is stale. Signal SUPERSEDED; do not mutate.
    let current: LocalizationGeometryArtifact;
    try {
      current = await currentProvider.resolveCurrent(input.projectId);
    } catch (error) {
      // W-CATCH2 #11 (:185): typed by M1a's own classification (never re-derived): no current point yet
      // keeps CURRENT_GEOMETRY_UNAVAILABLE; every other class is LOCALIZATION_GEOMETRY_<class> with M1a's
      // Swedish text and its retryable -- never the raw message.
      const failureClass = classifyLocalizationGeometryCurrentnessError(error);
      if (failureClass === 'NOT_FOUND') fail('CURRENT_GEOMETRY_UNAVAILABLE', 'Projektet har ingen aktuell kontrollpunkt. Inget utfärdades.');
      const typed = new LocalizationGeometryCurrentnessError(failureClass, '');
      fail(typed.reasonCode, `${typed.userMessage} ${typed.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.'}`);
    }
    if (current!.artifact_id !== input.predecessorGeometryArtifactId) {
      return {
        ok: false,
        superseded: true,
        detail: `pinned predecessor ${input.predecessorGeometryArtifactId} is no longer current (current is ${current!.artifact_id})`,
      };
    }

    const attestation = await attestLocalizationGeometrySupersessionArtifact({ artifact: bareArtifact, issuer, signing });
    const artifact: LocalizationGeometrySupersessionArtifact = { ...bareArtifact, attestation };

    // Independent re-verification before ever trusting the just-minted artifact -- structurally
    // cannot pass unless the signature genuinely verifies against the trusted public key. W-CATCH3
    // (CATCH2 verifier finding 3): BEFORE it is written (it verified only after the write before), so
    // an artifact -- or an issuer -- that does not verify never reaches the CAS.
    await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification });
    await repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });

    // The successor becomes a discoverable graph candidate ONLY together with its verified edge
    // -- never before -- so a partially-completed transition can never appear ambiguous (two
    // unconnected heads) to a concurrent reader.
    writes.written = true; // W-CATCH3: the projection and edge rows are writes too.
    await registerLocalizationGeometry({ projectId: input.projectId, geometry: successor! });
    await registerEdge(input.projectId, artifact.artifact_id, input.predecessorGeometryArtifactId, input.successorGeometryArtifactId);
    return { ok: true, supersessionArtifactId: artifact.artifact_id, reused: false };
  } catch (error) {
    // W-CATCH2: a stable code by class and a neutral text (provisioningFailure.ts); never the raw message.
    return { ok: false, superseded: false, ...provisioningFailure(error, writes) };
  }
}

async function registerEdge(
  projectId: string,
  supersessionArtifactId: string,
  predecessorGeometryArtifactId: string,
  successorGeometryArtifactId: string,
): Promise<void> {
  const index = new PrismaLocalizationGeometrySupersessionIndex();
  await index.register({ projectId, supersessionArtifactId, predecessorGeometryArtifactId, successorGeometryArtifactId });
}

async function tryReuseExistingSupersession(args: {
  readonly repo: ArtifactRepositoryPort;
  /** The relation this exact request deterministically names (without its attestation). */
  readonly bareArtifact: ReturnType<typeof createLocalizationGeometrySupersessionArtifact>;
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly verification: Parameters<typeof verifyLocalizationGeometrySupersessionArtifact>[0]['verification'];
}): Promise<string | null> {
  const expectedId = args.bareArtifact.artifact_id;
  // W-CATCH2 #11 (OD-R2): "not minted yet" ONLY on the proven absence of exactly this id; a read error
  // or a damaged existing relation is a typed fault, never re-issued over.
  const read = await readExistingOrProvenAbsent<LocalizationGeometrySupersessionArtifact>(
    args.repo,
    { artifact_id: expectedId, artifact_type: 'localization_geometry_supersession' },
    'geometry-supersession',
  );
  if (!read.found) return null; // proven absence: proceed to issue.
  const existing = read.value;
  // W-CATCH3 (CATCH2 verifier finding 2, probe S3): the object under the deterministic id must BE that
  // relation -- an index entry pointing at another (even valid) relation is a lasting integrity fault,
  // never a COMPLETED request with another relation -- and exactly the relation this request names,
  // field for field (the same discipline as the issuers); its attestation is verified below.
  assertReadUnderItsOwnId('geometry-supersession', existing, expectedId, args.bareArtifact.artifact_type);
  if (!isExactlyTheDeterministicArtifact(existing, args.bareArtifact)) {
    throw new LuReadFaultError('geometry-supersession', { faultClass: 'REFUSED', retryable: false, refusalCode: null }, new Error('the stored relation is not the relation its id names'));
  }
  try {
    await verifyLocalizationGeometrySupersessionArtifact({ artifact: existing, issuer: args.issuer, verification: args.verification });
    return expectedId;
  } catch (error) {
    // W-CATCH2 #11: an existing relation for this exact request that does not verify is never re-issued
    // over (the same id: either the same bytes, or a WORM/collision error) -- a typed refusal instead.
    throw toReadFaultError('geometry-supersession', error, 'verify');
  }
}

/** Reserved for the one-time legacy backfill script -- never used by the live worker path above.
 *  Exported so the backfill script can mint with the explicit LEGACY_CURRENTNESS_MIGRATION_V1
 *  reason code through the exact same signing/verification machinery, rather than a parallel path. */
export async function mintLegacyBackfillSupersession(args: {
  readonly repo: ArtifactRepositoryPort;
  readonly projectId: string;
  readonly predecessorGeometryArtifactId: string;
  readonly successorGeometryArtifactId: string;
  readonly issuedAt: string;
}): Promise<{ readonly supersessionArtifactId: string; readonly reused: boolean }> {
  const verification = getLocalizationGeometrySupersessionVerifier();
  const issuer = await getOrMintIssuer(args.repo, verification);
  const signing = getLocalizationGeometrySupersessionSigningProvider();
  // W-CATCH3-R2: bound to the requested id like the live path (a mismatch throws the typed integrity fault).
  const successor = await readPinnedGeometry(args.repo, args.successorGeometryArtifactId, 'pinned-successor-geometry');
  const bareArtifact = createLocalizationGeometrySupersessionArtifact({
    project_id: args.projectId,
    predecessor_geometry_ref: { artifact_id: args.predecessorGeometryArtifactId, artifact_type: 'localization_geometry' },
    successor_geometry_ref: { artifact_id: args.successorGeometryArtifactId, artifact_type: 'localization_geometry' },
    reason_code: LEGACY_CURRENTNESS_MIGRATION_REASON_CODE,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: signing.keyId,
    issued_at: args.issuedAt,
  });
  const reused = await tryReuseExistingSupersession({ repo: args.repo, bareArtifact, issuer, verification });
  if (reused) {
    await registerLocalizationGeometry({ projectId: args.projectId, geometry: successor });
    await registerEdge(args.projectId, reused, args.predecessorGeometryArtifactId, args.successorGeometryArtifactId);
    return { supersessionArtifactId: reused, reused: true };
  }
  const attestation = await attestLocalizationGeometrySupersessionArtifact({ artifact: bareArtifact, issuer, signing });
  const artifact: LocalizationGeometrySupersessionArtifact = { ...bareArtifact, attestation };
  // W-CATCH3 (CATCH2 verifier finding 3): verified BEFORE it is written, as on the live path.
  await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification });
  await args.repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });
  await registerLocalizationGeometry({ projectId: args.projectId, geometry: successor });
  await registerEdge(args.projectId, artifact.artifact_id, args.predecessorGeometryArtifactId, args.successorGeometryArtifactId);
  return { supersessionArtifactId: artifact.artifact_id, reused: false };
}
