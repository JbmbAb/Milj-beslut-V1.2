/**
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B.
 *
 * The mechanical bootstrap logic itself -- behaviorally the same chain
 * scripts/ops/bootstrap-product-lu-owner.ts already proved (property lookup -> mint+sign 5
 * artifacts -> install -> fresh public-key-only verification), extracted into an importable
 * module so both the standalone worker and (optionally) the CLI script can share one
 * implementation. That script's module top level unconditionally fires on import, so it cannot
 * be imported directly -- same reason scripts/db/lu-property-observation-for-correction.ts exists
 * as a separate mirror.
 *
 * SECURITY BOUNDARY: this module is imported ONLY by the standalone bootstrap worker process
 * (server/workers/lu-project-context-bootstrap-worker.ts). It must never be imported by
 * server/createApp.ts, any request-handling route, or LuExecutionKernelClient.ts. That is the
 * entire point of PROD-LU-ADMISSION-02's issuer/verifier split, reapplied here: the live web
 * server enqueues a request and reads status; it must never hold
 * PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM.
 *
 * POLICY (owner-frozen, 2026-08-22): this module may bootstrap ONLY a project that:
 *   (a) exists,
 *   (b) has a real ProjectMember{accessRole: OWNER} already on it (established at project
 *       creation time, by createLocalizationProject -- never by this module), and
 *   (c) has a propertyDesignation that matches what the request claims.
 * It never accepts a caller-supplied artifact ref, issuer ref, or signature -- every artifact is
 * derived here, from the real property lookup and the real owner it just found. It never changes
 * ownership, and it never mints anything for a project whose ownership it did not itself verify
 * from ProjectMember.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import {
  createCanonicalPropertyGeometryArtifact,
  createProductLuProjectContextArtifact,
  createProductLuPropertyContextArtifact,
  createProjectContextBindingArtifact,
  createProjectContextBindingIssuerArtifact,
  createProjectPropertyBindingArtifact,
  createPropertyLookupObservationArtifact,
} from '@miljobeslut/mps-lu';
import { prisma } from '../../db/prisma';
import { lookupPropertyByDesignationFromPostgis } from '../property/public';
import type { AuthUser } from '../../security/types';
import {
  attestProjectContextBindingArtifact,
  installVerifiedProductLuContext,
} from './projectContextBindingAuthority';
import { ProjectContextBindingProvider } from './projectContextBindingRuntime';
import { PrismaProjectContextBindingIndex } from '../../repositories/projectContextBindingRepository';
import {
  getProjectContextBindingIssuerSigner,
  getProjectContextBindingIssuerVerifier,
} from '../../security/projectContextBindingIssuerKey';
import { centroidToCanonicalCoordinates } from '../../../scripts/ops/luPropertyCoordinateOrder';

const PRIVATE_KEY_ENV = 'PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM';

export type BootstrapOutcome =
  | { readonly ok: true; readonly contextBindingArtifactId: string; readonly reused: boolean }
  | { readonly ok: false; readonly failureCode: string; readonly failureDetail: string };

type LookupPayload = {
  designation?: unknown;
  geometry?: unknown;
  matchType?: unknown;
  boundaries?: { properties?: Record<string, unknown> };
};

function fail(code: string, detail: string): never {
  const error = new Error(detail) as Error & { failureCode: string };
  error.failureCode = code;
  throw error;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) fail('PROPERTY_PROVENANCE_INCOMPLETE', `${name} is required`);
  return normalized as string;
}

function propertyObservation(lookup: LookupPayload) {
  if (lookup.matchType !== 'exact') fail('PROPERTY_LOOKUP_NOT_EXACT', 'canonical property lookup must be exact');
  if (!lookup.geometry || typeof lookup.geometry !== 'object') fail('PROPERTY_GEOMETRY_UNAVAILABLE', 'canonical property geometry is unavailable');
  const properties = lookup.boundaries?.properties;
  if (!properties) fail('PROPERTY_PROVENANCE_INCOMPLETE', 'canonical property provenance is unavailable');
  const sourceKey = required(typeof properties.sourceKey === 'string' ? properties.sourceKey : undefined, 'source_key');
  const sourceDataset = required(typeof properties.sourceDataset === 'string' ? properties.sourceDataset : undefined, 'source_dataset');
  const sourceUpdatedAt = required(
    typeof properties.sourceUpdatedAt === 'string' ? properties.sourceUpdatedAt : undefined,
    'source_updated_at',
  );
  const centroid = properties.centroidSweref99Tm;
  if (!Array.isArray(centroid) || centroid.length !== 2 || !centroid.every((value) => Number.isFinite(Number(value)))) {
    fail('PROPERTY_CENTROID_UNAVAILABLE', 'canonical SWEREF99 TM centroid is unavailable');
  }
  const designation = required(typeof lookup.designation === 'string' ? lookup.designation : undefined, 'property_designation');
  const geometry = createCanonicalPropertyGeometryArtifact({ geometry: lookup.geometry as Record<string, unknown> });
  const identity = `${sourceDataset}:${sourceKey}`;
  const observation = createPropertyLookupObservationArtifact({
    property_identity: identity,
    property_designation: designation,
    source_key: sourceKey,
    source_dataset: sourceDataset,
    source_updated_at: sourceUpdatedAt,
    municipality: typeof properties.municipalityName === 'string' ? properties.municipalityName : null,
    geometry_ref: { artifact_id: geometry.artifact_id, artifact_type: geometry.artifact_type },
  });
  return {
    geometry,
    observation,
    propertyIdentity: identity,
    propertyDesignation: designation,
    municipality: typeof properties.municipalityName === 'string' ? properties.municipalityName : '',
    coordinates: centroidToCanonicalCoordinates([Number(centroid[0]), Number(centroid[1])]),
  };
}

/** Fresh child process, private key deleted from its env first -- same pattern as bootstrap-product-lu-owner.ts. */
async function runFreshVerifier(bindingId: string, projectId: string): Promise<void> {
  const env = { ...process.env };
  delete env[PRIVATE_KEY_ENV];
  const scriptPath = fileURLToPath(new URL('./luProjectContextBootstrapVerifyCli.ts', import.meta.url));
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, bindingId, projectId], {
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) fail('FRESH_VERIFICATION_FAILED', 'fresh public-key-only verification of the newly issued binding failed');
}

/**
 * Executes (or reconciles) the bootstrap for exactly one project. Idempotent: if a verified
 * binding already exists for this project's current head, it is recognized and reused -- never
 * re-minted, never treated as a reason to diverge. Safe to retry after a crash at any point: a
 * partially-written CAS state either fails re-verification (caught by
 * ProjectContextBindingProvider.resolveCurrent, which fully re-verifies before trusting anything)
 * or was never observed as complete by any caller, so a retry always starts from either "already
 * genuinely done" or "not done yet", never a silently-accepted partial state.
 */
export async function executeProjectContextBootstrap(input: {
  readonly projectId: string;
  readonly propertyDesignation: string;
}): Promise<BootstrapOutcome> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, organisationId: true, propertyDesignation: true },
    });
    if (!project) fail('PROJECT_NOT_FOUND', `no Project with id ${input.projectId}`);

    const claimedDesignation = String(input.propertyDesignation || '').trim().toUpperCase();
    if (project!.propertyDesignation.trim().toUpperCase() !== claimedDesignation) {
      fail(
        'PROPERTY_MISMATCH',
        `request propertyDesignation "${claimedDesignation}" does not match project's own propertyDesignation "${project!.propertyDesignation}"`,
      );
    }

    const ownerMembership = await prisma.projectMember.findFirst({
      where: { projectId: project!.id, accessRole: 'OWNER' },
      select: {
        userId: true,
        user: { select: { id: true, organisationId: true, bankidId: true, role: true, identityEnvironment: true } },
      },
    });
    if (!ownerMembership?.user) fail('NO_LEGITIMATE_OWNER', `project ${project!.id} has no real ProjectMember{OWNER} -- refusing to bootstrap`);
    const owner: AuthUser = {
      ...ownerMembership!.user!,
      identityEnvironment: ownerMembership!.user!.identityEnvironment as AuthUser['identityEnvironment'],
    };

    const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true });
    const currentBindingProvider = new ProjectContextBindingProvider(
      mimers.artifactRepository,
      new PrismaProjectContextBindingIndex(),
      getProjectContextBindingIssuerVerifier(),
    );

    // Reconciliation: a verified binding may already exist (a prior attempt got far enough to
    // install and this run is a retry, or another worker already did it). Never re-mint.
    try {
      const existing = await currentBindingProvider.resolveCurrent(project!.id);
      return { ok: true, contextBindingArtifactId: existing.artifact_id, reused: true };
    } catch {
      // No verified binding yet -- proceed to issue one. Not itself an error.
    }

    const lookup = (await lookupPropertyByDesignationFromPostgis(
      { projectId: project!.id, propertyDesignation: claimedDesignation, purpose: 'LU_PROJECT_CONTEXT_BOOTSTRAP_WORKER' },
      owner,
    )) as LookupPayload;
    const property = propertyObservation(lookup);
    if (!property.municipality) fail('PROPERTY_MUNICIPALITY_UNAVAILABLE', 'canonical property municipality is unavailable');

    const signing = getProjectContextBindingIssuerSigner(process.env);
    const verification = getProjectContextBindingIssuerVerifier(process.env);
    const issuer = createProjectContextBindingIssuerArtifact({ issuer_key_id: signing.keyId });

    const propertyBindingUnsigned = createProjectPropertyBindingArtifact({
      project_id: project!.id,
      property_identity: property.propertyIdentity,
      property_designation: property.propertyDesignation,
      geometry_ref: { artifact_id: property.geometry.artifact_id, artifact_type: property.geometry.artifact_type },
      source_refs: [{ artifact_id: property.observation.artifact_id, artifact_type: property.observation.artifact_type }],
      resolver_id: 'postgis-property-unit-exact',
      resolver_version: 'canonical-property-observation-v1',
      contract_version: 'project-property-binding-v1',
    });
    const propertyBinding = {
      ...propertyBindingUnsigned,
      attestation: await attestProjectContextBindingArtifact({ artifact: propertyBindingUnsigned, issuer, signing }),
    };
    const propertyBindingRef = { artifact_id: propertyBinding.artifact_id, artifact_type: propertyBinding.artifact_type } as const;

    const propertyContext = createProductLuPropertyContextArtifact({
      property_identity: property.propertyIdentity,
      property_ref: property.propertyDesignation,
      official_name: property.propertyDesignation,
      geometry_ref: { artifact_id: property.geometry.artifact_id, artifact_type: property.geometry.artifact_type },
      municipality: property.municipality,
      coordinates: property.coordinates,
      project_property_binding_ref: propertyBindingRef,
    });
    const projectContext = createProductLuProjectContextArtifact({
      project_id: project!.id,
      project_name: property.propertyDesignation,
      description: 'Worker-provisioned canonical LU project context (PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01)',
      created_by: owner.id,
      property_context_ref: { artifact_id: propertyContext.artifact_id, artifact_type: propertyContext.artifact_type },
      project_property_binding_ref: propertyBindingRef,
    });
    const contextBindingUnsigned = createProjectContextBindingArtifact({
      project_id: project!.id,
      project_context_ref: { artifact_id: projectContext.artifact_id, artifact_type: projectContext.artifact_type },
      project_property_binding_ref: propertyBindingRef,
      binding_version: 'project-context-binding-v2',
      authority_ref: { artifact_id: issuer.artifact_id, artifact_type: issuer.artifact_type },
      created_at: new Date().toISOString(),
    });
    const contextBinding = {
      ...contextBindingUnsigned,
      attestation: await attestProjectContextBindingArtifact({ artifact: contextBindingUnsigned, issuer, signing }),
    };

    await installVerifiedProductLuContext({
      artifactRepository: mimers.artifactRepository,
      index: new PrismaProjectContextBindingIndex(),
      issuer,
      verification,
      geometryArtifact: property.geometry,
      propertyObservation: property.observation,
      propertyBinding,
      propertyContext,
      projectContext,
      contextBinding,
    });

    await runFreshVerifier(contextBinding.artifact_id, project!.id);

    return { ok: true, contextBindingArtifactId: contextBinding.artifact_id, reused: false };
  } catch (error) {
    const failureCode = (error as { failureCode?: string })?.failureCode ?? 'BOOTSTRAP_EXECUTION_ERROR';
    const failureDetail = error instanceof Error ? error.message : String(error);
    return { ok: false, failureCode, failureDetail };
  }
}

