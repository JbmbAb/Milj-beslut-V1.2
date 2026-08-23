/**
 * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01.
 *
 * The ONLY server boundary that turns a user's Cesium click into a governed
 * LocalizationGeometryArtifact. The browser sends nothing but raw WGS84 input; every
 * authority-bearing field (artifact_id, property_context_ref, project_id, content_hash, the
 * SWEREF99 TM transform) is derived/verified here, never accepted from the client. See
 * `saveUserLocalizationGeometry`'s input validation for the exact narrow contract.
 *
 * Also hosts `resolveOrDeriveCurrentLocalizationGeometry`, the SAME derive-or-resolve logic
 * `generate-localization-report.usecase.ts` already used inline -- extracted here so the read
 * path (GET, for the UI to show "current" before any LU run has ever executed) and the write
 * path (the LU run itself) can never disagree about what "current" means for a project that has
 * no explicit point yet.
 */
import { MimersIntegration, type ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import {
  createLocalizationGeometryArtifactV2,
  quantizeToLocalizationGeometryGrid,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import type { AuthUser } from '../../security/types';
import { assertProjectAccess } from '../../security/projectAccess';
import { resolveCanonicalProjectContext } from '../../../src/application/resolveCanonicalProjectContext';
import { registerLocalizationGeometry, resolveCurrentLocalizationGeometry } from './localizationGeometryProjection';
import { PrismaLocalizationGeometryProjectionIndex } from '../../repositories/localizationGeometryProjectionRepository';
import { createLocalizationSpatialRuntime, type LocalizationSpatialRuntime } from './createLocalizationSpatialRuntime';
import {
  ensureLocalizationIdentityProvisioningRequested,
  enqueueLocalizationIdentityProvisioningRequest,
  type LocalizationIdentityProvisioningRequestRecord,
} from './localizationIdentityProvisioningQueue';
import {
  ensureLocalizationGeometrySupersessionRequested,
  type LocalizationGeometrySupersessionRequestRecord,
} from './localizationGeometrySupersessionQueue';

const DERIVED_LABEL = 'Fastighetens centrumpunkt (automatiskt härledd)';
const USER_DEFINED_LABEL = 'Användardefinierad lokalisering';

export type LocalizationIdentityProvisioningStatus = 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | null;
export type LocalizationGeometrySupersessionStatus = 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED' | 'SUPERSEDED' | null;

export interface LocalizationGeometryView {
  readonly artifact_id: string;
  readonly provenance: 'user_defined' | 'derived_from_property_boundary';
  /** WGS84 [lng, lat] -- the same order Cesium/the browser already use, for direct redisplay. */
  readonly wgs84LngLat: readonly [number, number];
  /**
   * PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01. `null` only if enqueueing itself failed
   * outright (surfaced separately as a request error, never silently). PENDING/LEASED means the
   * V3 identity for this exact point is not execution-ready yet; COMPLETED means "Kör bedömning"
   * can succeed; FAILED means the point is saved and safe, but needs an explicit retry.
   */
  readonly provisioningStatus: LocalizationIdentityProvisioningStatus;
  readonly provisioningFailureDetail?: string | null;
  /**
   * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1. `null` for a project's root geometry (no
   * currentness transition needed) or when the saved point is already the settled current one
   * (retry no-op). PENDING/LEASED means the signed predecessor->successor supersession edge has
   * not been confirmed yet -- GET-current will keep returning the PREVIOUS point until it is.
   * SUPERSEDED means a faster concurrent save already moved current elsewhere; FAILED means the
   * point is saved and safe in CAS, but the currentness transition needs an explicit retry.
   */
  readonly supersessionStatus: LocalizationGeometrySupersessionStatus;
  readonly supersessionFailureDetail?: string | null;
}

function toView(
  geometry: LocalizationGeometryArtifact,
  provisioning: LocalizationIdentityProvisioningRequestRecord | null,
  supersession?: LocalizationGeometrySupersessionRequestRecord | null,
): LocalizationGeometryView {
  return {
    artifact_id: geometry.artifact_id,
    provenance: geometry.payload.provenance,
    wgs84LngLat: geometry.payload.geometry.coordinates,
    provisioningStatus: provisioning?.status ?? null,
    provisioningFailureDetail: provisioning?.failureDetail ?? null,
    supersessionStatus: supersession?.status ?? null,
    supersessionFailureDetail: supersession?.failureDetail ?? null,
  };
}

/**
 * Resolves the project's current LocalizationGeometry, or -- for a project that has never had
 * one set -- derives one from the property's own centroid (`provenance:
 * derived_from_property_boundary`), persists it, and registers it as current. Pure function of
 * already-verified canonical state; never trusts a caller-supplied ref.
 */
export async function resolveOrDeriveCurrentLocalizationGeometry(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly propertyContextRef: ArtifactReference;
  readonly propertyCentroidSweref: readonly [number, number];
  readonly sweref99ToWgs84: (northing: number, easting: number) => Promise<readonly [number, number]>;
  readonly createdBy: string;
}): Promise<{ readonly geometry: LocalizationGeometryArtifact; readonly wasDerived: boolean }> {
  try {
    const current = await resolveCurrentLocalizationGeometry({
      projectId: args.projectId,
      artifactRepository: args.artifactRepository,
    });
    return { geometry: current.geometry, wasDerived: false };
  } catch {
    // LOCALIZATION-GEOMETRY-CANONICALIZATION-V2: quantize the property centroid to the
    // canonical 0.1m grid FIRST, then derive WGS84 from that already-quantized point -- exactly
    // one canonicalization step, never two independently-quantized representations.
    const canonicalSweref: readonly [number, number] = [
      quantizeToLocalizationGeometryGrid(args.propertyCentroidSweref[0]),
      quantizeToLocalizationGeometryGrid(args.propertyCentroidSweref[1]),
    ];
    const [derivedLat, derivedLng] = await args.sweref99ToWgs84(canonicalSweref[0], canonicalSweref[1]);
    const derivedGeometry = createLocalizationGeometryArtifactV2({
      project_id: args.projectId,
      property_context_ref: args.propertyContextRef,
      wgs84LngLat: [derivedLng, derivedLat],
      sweref99NorthingEasting: canonicalSweref,
      provenance: 'derived_from_property_boundary',
      label: DERIVED_LABEL,
      created_by: args.createdBy,
    });
    await args.artifactRepository.put({
      artifact_id: derivedGeometry.artifact_id,
      content_hash: derivedGeometry.content_hash,
      body: derivedGeometry,
    });
    // Non-authoritative discovery projection; a write failure here must never abort an otherwise
    // valid derivation -- CAS already has the real artifact, and resolution will simply retry the
    // derivation next time until the projection write succeeds. Same reasoning as
    // generate-localization-report.usecase.ts's identical derive step.
    try {
      await registerLocalizationGeometry({ projectId: args.projectId, geometry: derivedGeometry });
    } catch {
      // swallowed deliberately -- see comment above.
    }
    return { geometry: derivedGeometry, wasDerived: true };
  }
}

export type LocalizationGeometryServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * GET-side: what the UI shows before/after any explicit save, including the initial
 * transitional "derived from property" state.
 */
export async function getCurrentLocalizationGeometryForProject(args: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  /** Overridable for tests; defaults to the real CAS. */
  readonly artifactRepository?: ArtifactRepositoryPort;
  /** Overridable for tests; defaults to the real Postgres-backed PostGIS spatial runtime. */
  readonly spatialRuntime?: LocalizationSpatialRuntime;
}): Promise<LocalizationGeometryServiceResult<LocalizationGeometryView>> {
  const projectId = args.projectId.trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId required' };

  try {
    await assertProjectAccess(args.authUser, projectId, args.authUser.organisationId);
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }

  const repo = args.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  let canonicalContext: Awaited<ReturnType<typeof resolveCanonicalProjectContext>>;
  try {
    canonicalContext = await resolveCanonicalProjectContext(projectId, repo);
  } catch (error) {
    return { ok: false, status: 404, error: `No canonical project context available: ${error instanceof Error ? error.message : String(error)}` };
  }

  const spatialRuntime = args.spatialRuntime ?? (await createLocalizationSpatialRuntime());
  const ownsSpatialRuntime = !args.spatialRuntime;
  try {
    const { geometry } = await resolveOrDeriveCurrentLocalizationGeometry({
      projectId,
      artifactRepository: repo,
      propertyContextRef: canonicalContext.propertyContextRef,
      propertyCentroidSweref: canonicalContext.coordinates,
      sweref99ToWgs84: spatialRuntime.sweref99ToWgs84,
      createdBy: args.authUser.id,
    });
    // A project's very first read (or a legacy project that only ever had the transitional
    // derived point) must also become execution-ready without a manual ops step -- ensure is
    // idempotent, so polling this endpoint repeatedly never floods the queue.
    const provisioning = await ensureLocalizationIdentityProvisioningRequested({
      projectId,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: args.authUser.id,
    }).catch(() => null);
    return { ok: true, data: toView(geometry, provisioning) };
  } finally {
    if (ownsSpatialRuntime) await spatialRuntime.close().catch(() => undefined);
  }
}

const SUPPORTED_GEOMETRY_TYPES = new Set(['POINT']);
const SUPPORTED_SRID = 4326;

function isFiniteLngLat(value: unknown): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lng, lat] = value;
  return (
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180 &&
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  );
}

/**
 * POST-side: the ONLY function that turns a browser click into a real, persisted, governed
 * LocalizationGeometryArtifact. Input contract is deliberately narrow -- geometry_type,
 * coordinates ([lng, lat], WGS84), srid (must declare 4326). Everything else (which property,
 * which project, the canonical artifact identity, the SWEREF99 TM transform, CAS persistence,
 * projection registration) is derived/performed here, never accepted from the caller.
 */
export async function saveUserLocalizationGeometry(args: {
  readonly authUser: AuthUser;
  readonly projectId: string;
  readonly input: {
    readonly geometry_type?: unknown;
    readonly coordinates?: unknown;
    readonly srid?: unknown;
  };
  /** Overridable for tests; defaults to the real CAS. */
  readonly artifactRepository?: ArtifactRepositoryPort;
  /** Overridable for tests; defaults to the real Postgres-backed PostGIS spatial runtime. */
  readonly spatialRuntime?: LocalizationSpatialRuntime;
}): Promise<LocalizationGeometryServiceResult<LocalizationGeometryView>> {
  const projectId = args.projectId.trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId required' };

  const geometryType = typeof args.input.geometry_type === 'string' ? args.input.geometry_type.toUpperCase() : '';
  if (!SUPPORTED_GEOMETRY_TYPES.has(geometryType)) {
    return { ok: false, status: 400, error: `REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_TYPE: '${geometryType}' is not supported in V1 (POINT only)` };
  }
  if (args.input.srid !== SUPPORTED_SRID) {
    return { ok: false, status: 400, error: `REJECT_LOCALIZATION_GEOMETRY_UNSUPPORTED_SRID: expected ${SUPPORTED_SRID} (WGS84), got ${JSON.stringify(args.input.srid)}` };
  }
  if (!isFiniteLngLat(args.input.coordinates)) {
    return { ok: false, status: 400, error: 'REJECT_LOCALIZATION_GEOMETRY: coordinates must be a finite [lng, lat] pair within valid WGS84 ranges' };
  }
  const [lng, lat] = args.input.coordinates;

  try {
    await assertProjectAccess(args.authUser, projectId, args.authUser.organisationId);
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }

  const repo = args.artifactRepository ?? (await MimersIntegration.create()).artifactRepository;
  let canonicalContext: Awaited<ReturnType<typeof resolveCanonicalProjectContext>>;
  try {
    canonicalContext = await resolveCanonicalProjectContext(projectId, repo);
  } catch (error) {
    return { ok: false, status: 404, error: `No canonical project context available: ${error instanceof Error ? error.message : String(error)}` };
  }

  const spatialRuntime = args.spatialRuntime ?? (await createLocalizationSpatialRuntime());
  const ownsSpatialRuntime = !args.spatialRuntime;
  try {
    // LOCALIZATION-GEOMETRY-CANONICALIZATION-V2: the raw browser click and the raw PostGIS
    // transform are both floating-point-noisy -- quantize the SWEREF result to the canonical
    // 0.1m grid FIRST, then derive the canonical WGS84 representation from that already-
    // quantized point (never independently quantizing WGS84 itself). This is what makes two
    // numerically-equivalent representations of the SAME intended coordinate collapse to the
    // same identity, while two genuinely distinct clicks (even close together) still mint
    // distinct geometries -- the grid stabilizes representation, it does not decide user intent.
    const rawSweref = await spatialRuntime.wgs84ToSweref99(lat, lng);
    const canonicalSweref: readonly [number, number] = [
      quantizeToLocalizationGeometryGrid(rawSweref[0]),
      quantizeToLocalizationGeometryGrid(rawSweref[1]),
    ];
    const [canonicalLat, canonicalLng] = await spatialRuntime.sweref99ToWgs84(canonicalSweref[0], canonicalSweref[1]);
    const geometry = createLocalizationGeometryArtifactV2({
      project_id: projectId,
      property_context_ref: canonicalContext.propertyContextRef,
      wgs84LngLat: [canonicalLng, canonicalLat],
      sweref99NorthingEasting: canonicalSweref,
      provenance: 'user_defined',
      label: USER_DEFINED_LABEL,
      created_by: args.authUser.id,
    });
    // CAS put is the ONLY authority action the web process takes on the geometry itself -- the
    // artifact stays unsigned, immutable, content-addressed user content (LOCALIZATION-GEOMETRY-
    // CURRENTNESS-V1 point 1). The web process never signs a currentness transition and never
    // imports LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM.
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });

    const geometryIndex = new PrismaLocalizationGeometryProjectionIndex();
    const knownRows = await geometryIndex.listForProject(projectId);
    const alreadyKnown = knownRows.some((row) => row.geometryArtifactId === geometry.artifact_id);

    let supersession: LocalizationGeometrySupersessionRequestRecord | null = null;
    if (alreadyKnown) {
      // Retry of a geometry we've already seen -- whether it's the current one or a past,
      // superseded one, this is a true no-op: do not touch the graph. "Retry old A while B is
      // current" must never create a new B->A edge (LOCALIZATION-GEOMETRY-CURRENTNESS-V1).
    } else {
      let predecessor: LocalizationGeometryArtifact | null = null;
      try {
        const current = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
        predecessor = current.geometry;
      } catch {
        predecessor = null; // first-ever geometry for this project -- no transition needed.
      }

      if (!predecessor) {
        // Root: register directly, no supersession relation required (LOCALIZATION-GEOMETRY-
        // CURRENTNESS-V1 point on initial geometry -- structural head, no root/activation artifact).
        await registerLocalizationGeometry({ projectId, geometry });
      } else {
        // Enqueue the EXACT observed transition; never register this geometry into the discovery
        // projection here -- the worker registers it together with its verified edge once signed,
        // so a candidate never appears without either being the root or already having a settled
        // edge (this is what prevents the mid-transition ambiguity window entirely). A failure to
        // enqueue must never make the already-persisted, already-safe-in-CAS geometry save look
        // like it failed -- surfaced as supersessionStatus: null, not a 500.
        supersession = await ensureLocalizationGeometrySupersessionRequested({
          projectId,
          predecessorGeometryArtifactId: predecessor.artifact_id,
          successorGeometryArtifactId: geometry.artifact_id,
          requestedByUserId: args.authUser.id,
        }).catch(() => null);
      }
    }

    // PRODUCT-LU-EXECUTION-IDENTITY-V3-PROVISIONING-01: the request PINS this exact
    // geometry.artifact_id -- never "whatever is current" at lease time. Independent of whether
    // this geometry has become the settled current one yet.
    const provisioning = await ensureLocalizationIdentityProvisioningRequested({
      projectId,
      geometryArtifactId: geometry.artifact_id,
      requestedByUserId: args.authUser.id,
    }).catch(() => null);
    return { ok: true, data: toView(geometry, provisioning, supersession) };
  } finally {
    if (ownsSpatialRuntime) await spatialRuntime.close().catch(() => undefined);
  }
}

/**
 * Explicit retry after a FAILED provisioning attempt. Always enqueues a NEW request (never reuses
 * the failed row) for the project's CURRENT geometry -- if the user has since moved the point,
 * this correctly retries for the new current point, not the stale failed one.
 */
export async function retryLocalizationIdentityProvisioning(args: {
  readonly authUser: AuthUser;
  readonly projectId: string;
}): Promise<LocalizationGeometryServiceResult<LocalizationGeometryView>> {
  const projectId = args.projectId.trim();
  if (!projectId) return { ok: false, status: 400, error: 'projectId required' };

  try {
    await assertProjectAccess(args.authUser, projectId, args.authUser.organisationId);
  } catch {
    return { ok: false, status: 403, error: 'Not authorized for this project.' };
  }

  const repo = (await MimersIntegration.create()).artifactRepository;
  let current: Awaited<ReturnType<typeof resolveCurrentLocalizationGeometry>>;
  try {
    current = await resolveCurrentLocalizationGeometry({ projectId, artifactRepository: repo });
  } catch (error) {
    return { ok: false, status: 404, error: `No current localization geometry to retry: ${error instanceof Error ? error.message : String(error)}` };
  }

  const provisioning = await enqueueLocalizationIdentityProvisioningRequest({
    projectId,
    geometryArtifactId: current.geometryArtifactId,
    requestedByUserId: args.authUser.id,
  });
  return { ok: true, data: toView(current.geometry, provisioning) };
}
