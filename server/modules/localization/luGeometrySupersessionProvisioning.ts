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
} from './localizationGeometrySupersessionAuthority';
import { getLocalizationGeometrySupersessionSigningProvider } from '../../security/localizationGeometrySupersessionSigningKey';
import { getLocalizationGeometrySupersessionVerifier } from '../../security/localizationGeometrySupersessionVerifier';
import { LocalizationGeometryCurrentProvider } from './localizationGeometryCurrentProvider';
import { PrismaLocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import { registerLocalizationGeometry } from './localizationGeometryProjection';
import { PrismaLocalizationGeometrySupersessionIndex } from '../../repositories/localizationGeometrySupersessionRepository';
import { prisma } from '../../db/prisma';
import { assertProjectAccess } from '../../security/projectAccess';

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
  | { readonly ok: false; readonly superseded: false; readonly failureCode: string; readonly failureDetail: string };

function fail(code: string, detail: string): never {
  const error = new Error(detail) as Error & { failureCode: string };
  error.failureCode = code;
  throw error;
}

async function getOrMintIssuer(repo: ArtifactRepositoryPort): Promise<LocalizationGeometrySupersessionIssuerArtifact> {
  const signing = getLocalizationGeometrySupersessionSigningProvider();
  const bareIssuer = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: signing.keyId,
    owner_authority_ref: OWNER_AUTHORITY_REF,
  });
  try {
    const existing = await repo.resolve<LocalizationGeometrySupersessionIssuerArtifact>({
      artifact_id: bareIssuer.artifact_id,
      artifact_type: bareIssuer.artifact_type,
    });
    if (existing.payload.issuer_key_id === signing.keyId) return existing;
  } catch {
    // not minted yet -- fall through to mint.
  }
  const attestation = await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: bareIssuer, signing });
  const issuer: LocalizationGeometrySupersessionIssuerArtifact = { ...bareIssuer, attestation };
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
    } catch {
      fail('REQUESTER_NOT_AUTHORIZED', `user ${input.requestedByUserId} is not a member of project ${input.projectId}`);
    }

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const repo = mimers.artifactRepository;
    const verification = getLocalizationGeometrySupersessionVerifier();
    const currentProvider = new LocalizationGeometryCurrentProvider(
      repo,
      new PrismaLocalizationGeometryProjectionIndex(),
      new PrismaLocalizationGeometrySupersessionIndex(),
      verification,
    );

    let predecessor: LocalizationGeometryArtifact;
    try {
      predecessor = validateLocalizationGeometryArtifact(
        await repo.resolve<LocalizationGeometryArtifact>({
          artifact_id: input.predecessorGeometryArtifactId,
          artifact_type: 'localization_geometry',
        }),
      );
    } catch (error) {
      fail('PREDECESSOR_GEOMETRY_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }
    if (predecessor!.payload.project_id !== input.projectId) fail('PREDECESSOR_GEOMETRY_PROJECT_MISMATCH', 'predecessor geometry does not belong to this project');

    let successor: LocalizationGeometryArtifact;
    try {
      successor = validateLocalizationGeometryArtifact(
        await repo.resolve<LocalizationGeometryArtifact>({
          artifact_id: input.successorGeometryArtifactId,
          artifact_type: 'localization_geometry',
        }),
      );
    } catch (error) {
      fail('SUCCESSOR_GEOMETRY_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    }
    if (successor!.payload.project_id !== input.projectId) fail('SUCCESSOR_GEOMETRY_PROJECT_MISMATCH', 'successor geometry does not belong to this project');

    const issuer = await getOrMintIssuer(repo);
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
    const reused = await tryReuseExistingSupersession({ repo, expectedId: bareArtifact.artifact_id, issuer, verification });
    if (reused) {
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
      fail('CURRENT_GEOMETRY_UNAVAILABLE', error instanceof Error ? error.message : String(error));
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
    await repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });

    // Independent re-verification before ever trusting the just-minted artifact -- structurally
    // cannot pass unless the signature genuinely verifies against the trusted public key.
    await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification });

    // The successor becomes a discoverable graph candidate ONLY together with its verified edge
    // -- never before -- so a partially-completed transition can never appear ambiguous (two
    // unconnected heads) to a concurrent reader.
    await registerLocalizationGeometry({ projectId: input.projectId, geometry: successor! });
    await registerEdge(input.projectId, artifact.artifact_id, input.predecessorGeometryArtifactId, input.successorGeometryArtifactId);
    return { ok: true, supersessionArtifactId: artifact.artifact_id, reused: false };
  } catch (error) {
    const failureCode = (error as { failureCode?: string })?.failureCode ?? 'PROVISIONING_EXECUTION_ERROR';
    const failureDetail = error instanceof Error ? error.message : String(error);
    return { ok: false, superseded: false, failureCode, failureDetail };
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
  readonly expectedId: string;
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly verification: Parameters<typeof verifyLocalizationGeometrySupersessionArtifact>[0]['verification'];
}): Promise<string | null> {
  let existing: LocalizationGeometrySupersessionArtifact;
  try {
    existing = await args.repo.resolve<LocalizationGeometrySupersessionArtifact>({
      artifact_id: args.expectedId,
      artifact_type: 'localization_geometry_supersession',
    });
  } catch {
    return null; // not minted yet -- proceed to issue.
  }
  try {
    await verifyLocalizationGeometrySupersessionArtifact({ artifact: existing, issuer: args.issuer, verification: args.verification });
    return existing.artifact_id;
  } catch {
    return null; // orphaned/partial/tampered CAS state from a crashed prior attempt -- re-issue rather than trust it.
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
  const issuer = await getOrMintIssuer(args.repo);
  const signing = getLocalizationGeometrySupersessionSigningProvider();
  const verification = getLocalizationGeometrySupersessionVerifier();
  const successor = validateLocalizationGeometryArtifact(
    await args.repo.resolve<LocalizationGeometryArtifact>({ artifact_id: args.successorGeometryArtifactId, artifact_type: 'localization_geometry' }),
  );
  const bareArtifact = createLocalizationGeometrySupersessionArtifact({
    project_id: args.projectId,
    predecessor_geometry_ref: { artifact_id: args.predecessorGeometryArtifactId, artifact_type: 'localization_geometry' },
    successor_geometry_ref: { artifact_id: args.successorGeometryArtifactId, artifact_type: 'localization_geometry' },
    reason_code: LEGACY_CURRENTNESS_MIGRATION_REASON_CODE,
    issuer_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
    issuer_key_id: signing.keyId,
    issued_at: args.issuedAt,
  });
  const reused = await tryReuseExistingSupersession({ repo: args.repo, expectedId: bareArtifact.artifact_id, issuer, verification });
  if (reused) {
    await registerLocalizationGeometry({ projectId: args.projectId, geometry: successor });
    await registerEdge(args.projectId, reused, args.predecessorGeometryArtifactId, args.successorGeometryArtifactId);
    return { supersessionArtifactId: reused, reused: true };
  }
  const attestation = await attestLocalizationGeometrySupersessionArtifact({ artifact: bareArtifact, issuer, signing });
  const artifact: LocalizationGeometrySupersessionArtifact = { ...bareArtifact, attestation };
  await args.repo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });
  await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification });
  await registerLocalizationGeometry({ projectId: args.projectId, geometry: successor });
  await registerEdge(args.projectId, artifact.artifact_id, args.predecessorGeometryArtifactId, args.successorGeometryArtifactId);
  return { supersessionArtifactId: artifact.artifact_id, reused: false };
}
