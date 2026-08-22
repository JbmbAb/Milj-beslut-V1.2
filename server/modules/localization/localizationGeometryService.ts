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
  createLocalizationGeometryArtifact,
  type LocalizationGeometryArtifact,
} from '@miljobeslut/mps-lu';
import type { AuthUser } from '../../security/types';
import { assertProjectAccess } from '../../security/projectAccess';
import { resolveCanonicalProjectContext } from '../../../src/application/resolveCanonicalProjectContext';
import { registerLocalizationGeometry, resolveCurrentLocalizationGeometry } from './localizationGeometryProjection';
import { createLocalizationSpatialRuntime, type LocalizationSpatialRuntime } from './createLocalizationSpatialRuntime';

const DERIVED_LABEL = 'Fastighetens centrumpunkt (automatiskt härledd)';
const USER_DEFINED_LABEL = 'Användardefinierad lokalisering';

export interface LocalizationGeometryView {
  readonly artifact_id: string;
  readonly provenance: 'user_defined' | 'derived_from_property_boundary';
  /** WGS84 [lng, lat] -- the same order Cesium/the browser already use, for direct redisplay. */
  readonly wgs84LngLat: readonly [number, number];
}

function toView(geometry: LocalizationGeometryArtifact): LocalizationGeometryView {
  return {
    artifact_id: geometry.artifact_id,
    provenance: geometry.payload.provenance,
    wgs84LngLat: geometry.payload.geometry.coordinates,
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
    const [derivedLat, derivedLng] = await args.sweref99ToWgs84(
      args.propertyCentroidSweref[0],
      args.propertyCentroidSweref[1],
    );
    const derivedGeometry = createLocalizationGeometryArtifact({
      project_id: args.projectId,
      property_context_ref: args.propertyContextRef,
      wgs84LngLat: [derivedLng, derivedLat],
      sweref99NorthingEasting: args.propertyCentroidSweref,
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
    return { ok: true, data: toView(geometry) };
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
    const sweref = await spatialRuntime.wgs84ToSweref99(lat, lng);
    const geometry = createLocalizationGeometryArtifact({
      project_id: projectId,
      property_context_ref: canonicalContext.propertyContextRef,
      wgs84LngLat: [lng, lat],
      sweref99NorthingEasting: sweref,
      provenance: 'user_defined',
      label: USER_DEFINED_LABEL,
      created_by: args.authUser.id,
    });
    await repo.put({ artifact_id: geometry.artifact_id, content_hash: geometry.content_hash, body: geometry });
    // Deliberately NOT swallowed here (unlike the derive path above): the user explicitly asked
    // to save this point, so a projection-write failure must be reported, not silently accepted
    // as success while the point remains undiscoverable by "current" resolution. The CAS put
    // above is itself idempotent (content-addressed), so a client retry after this failure is safe.
    await registerLocalizationGeometry({ projectId, geometry });
    return { ok: true, data: toView(geometry) };
  } finally {
    if (ownsSpatialRuntime) await spatialRuntime.close().catch(() => undefined);
  }
}
