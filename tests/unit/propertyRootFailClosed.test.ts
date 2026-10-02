import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * U20-A (LU 72h, Chain A): the canonical property root fails closed instead of silently choosing
 * one of several rows.
 *
 * Hermetic: Prisma, audit, access control, CAS and the binding issuer are all mocked. No database,
 * no network.
 *
 * Before U20-A the exact lookup matched on `designation_norm` only (normalize_designation strips
 * everything but [a-zA-Z0-9:], so "1:3>1" and "1:31" collide) and returned `LIMIT 1` without
 * `ORDER BY` or any cardinality check -- an arbitrary row was accepted as the `exact` root.
 */

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  projectFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
  appendPropertyAudit: vi.fn(),
  writePropertyAccessLog: vi.fn(),
  assertProjectMembership: vi.fn(),
  validatePropertyLookupInput: vi.fn(),
  assertPermission: vi.fn(),
  mimersCreate: vi.fn(),
  resolveCurrent: vi.fn(),
  getSigner: vi.fn(),
  getVerifier: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    project: { findUnique: mocks.projectFindUnique },
    projectMember: { findFirst: mocks.memberFindFirst },
    // W-BOOT (APR F2): no earlier completed bootstrap for this project.
    projectContextBootstrapRequest: { count: async () => 0 },
  },
}));
vi.mock('../../server/security/auditTrail', () => ({ appendPropertyAudit: mocks.appendPropertyAudit }));
vi.mock('../../server/repositories/auditRepository', () => ({ writePropertyAccessLog: mocks.writePropertyAccessLog }));
vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));
vi.mock('../../server/security/projectAccess', () => ({
  validatePropertyLookupInput: mocks.validatePropertyLookupInput,
  assertPermission: mocks.assertPermission,
}));
vi.mock('@miljobeslut/mps-runtime', () => ({ MimersIntegration: { create: mocks.mimersCreate } }));
vi.mock('../../server/modules/localization/projectContextBindingRuntime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ProjectContextBindingProvider: class {
    resolveCurrent(...args: unknown[]) {
      return mocks.resolveCurrent(...args);
    }
  },
}));
vi.mock('../../server/security/projectContextBindingIssuerKey', () => ({
  getProjectContextBindingIssuerSigner: mocks.getSigner,
  getProjectContextBindingIssuerVerifier: mocks.getVerifier,
}));
// W-BOOT: the bootstrap also asks the index whether a supersession relation is registered before it
// treats an empty binding graph as "no binding"; this project has none.
vi.mock('../../server/repositories/projectContextBindingRepository', () => ({
  PrismaProjectContextBindingIndex: class {
    async listSupersessionRefs() {
      return [];
    }
  },
}));
// W-BOOT (APR F2): ... nor any assessment or localization geometry row (index traces of a binding).
vi.mock('../../server/repositories/projectAssessmentProjectionRepository', () => ({
  PrismaProjectAssessmentProjectionIndex: class {
    async listForProject() {
      return [];
    }
  },
}));
vi.mock('../../server/repositories/localizationGeometryProjectionRepository', () => ({
  PrismaLocalizationGeometryProjectionIndex: class {
    async listForProject() {
      return [];
    }
  },
}));

import { lookupPropertyByDesignationFromPostgis } from '../../server/services/propertyUnitService';
import { executeProjectContextBootstrap } from '../../server/modules/localization/luProjectContextBootstrap';
import { ProjectContextBindingCurrentUnavailableError } from '../../server/modules/localization/projectContextBindingRuntime';
import { toSafeErrorResponse } from '../../server/security/secureErrors';
import type { AuthUser } from '../../server/security/types';

const user: AuthUser = { id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-1', role: 'CONSULTANT' };

function row(designation: string, sourceKey: string, extra: Record<string, unknown> = {}) {
  return {
    source_key: sourceKey,
    designation,
    municipality_code: '1440',
    municipality_name: 'Ale',
    county_code: '14',
    source_dataset: 'lm_fastighetsytor',
    source_updated_at: new Date('2026-01-01T00:00:00Z'),
    raw_properties: {},
    geometry_geojson: '{"type":"MultiPolygon","coordinates":[]}',
    centroid_easting: 330000,
    centroid_northing: 6430000,
    ...extra,
  };
}

function lookup(propertyDesignation: string) {
  return lookupPropertyByDesignationFromPostgis(
    { projectId: 'project-1', propertyDesignation, purpose: 'U20-A test' },
    user,
  );
}

/** The SQL text of the n-th $queryRaw call (tagged-template strings, parameters elided). */
function sqlOfCall(n: number): string {
  const strings = mocks.queryRaw.mock.calls[n]?.[0] as readonly string[] | undefined;
  return (strings ?? []).join('?').replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockReset();
  mocks.assertProjectMembership.mockResolvedValue(undefined);
  mocks.appendPropertyAudit.mockResolvedValue(undefined);
  mocks.writePropertyAccessLog.mockResolvedValue(undefined);
});

describe('U20-A: exact property lookup requires exactly one row', () => {
  it('two rows with the same exact designation -> PropertyLookupAmbiguousError, no fuzzy fallback, no audit', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      row('ALE ÄLEBRÄCKE 1:31', 'lm-a', { match_count: 2 }),
      row('ALE ÄLEBRÄCKE 1:31', 'lm-b', { match_count: 2 }),
    ]);

    const error = await lookup('ALE ÄLEBRÄCKE 1:31').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('PropertyLookupAmbiguousError');
    expect((error as { failureCode?: string }).failureCode).toBe('PROPERTY_LOOKUP_AMBIGUOUS');
    expect((error as { matchCount?: number }).matchCount).toBe(2);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.appendPropertyAudit).not.toHaveBeenCalled();
    expect(mocks.writePropertyAccessLog).not.toHaveBeenCalled();
  });

  it('two rows even without a window count (count is never assumed to be 1) -> ambiguous', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:31', 'lm-a'), row('ALE ÄLEBRÄCKE 1:31', 'lm-b')]);

    await expect(lookup('ALE ÄLEBRÄCKE 1:31')).rejects.toMatchObject({ failureCode: 'PROPERTY_LOOKUP_AMBIGUOUS' });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('one row returned but the window count says 3 (rows cut by LIMIT) -> ambiguous', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:31', 'lm-a', { match_count: 3 })]);

    await expect(lookup('ALE ÄLEBRÄCKE 1:31')).rejects.toMatchObject({
      failureCode: 'PROPERTY_LOOKUP_AMBIGUOUS',
      matchCount: 3,
    });
  });

  it('exactly one exact row -> accepted as the exact root', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:31', 'lm-31', { match_count: 1 })]);

    const result = await lookup('ALE ÄLEBRÄCKE 1:31');

    expect(result).toMatchObject({ designation: 'ALE ÄLEBRÄCKE 1:31', matchType: 'exact' });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.appendPropertyAudit).toHaveBeenCalledTimes(1);
  });

  it('normalization collision: "1:31" never accepts the "1:3>1" row as exact', async () => {
    // What the pre-U20-A norm-only query could return for "1:31": the colliding "1:3>1" row.
    mocks.queryRaw
      .mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:3>1', 'lm-3-1', { match_count: 1 })])
      .mockResolvedValueOnce([]); // fuzzy: nothing

    await expect(lookup('ALE ÄLEBRÄCKE 1:31')).rejects.toThrow('Fastighet hittades inte i PostGIS');
    expect(mocks.appendPropertyAudit).not.toHaveBeenCalled();
  });

  it('the exact SQL counts matches, compares the designation itself, filters county when given, and never LIMIT 1', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:31', 'lm-31', { match_count: 1 })]);

    await lookup('ALE ÄLEBRÄCKE 1:31');

    const sql = sqlOfCall(0);
    expect(sql).toMatch(/count\(\*\) OVER \(\)/i);
    expect(sql).toMatch(/upper\(btrim\(regexp_replace\(pu\.designation, '\[\[:space:\]\]\+', ' ', 'g'\)\)\) = q\.designation_exact/);
    expect(sql).toMatch(/pu\.county_code = \?::text/);
    expect(sql).not.toMatch(/LIMIT 1\b/);
  });

  it('the refusal is a typed, safe client error (409, PROPERTY_LOOKUP_AMBIGUOUS), not a generic 500', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row('X 1:1', 'a', { match_count: 2 }), row('X 1:1', 'b', { match_count: 2 })]);

    const error = await lookup('X 1:1').catch((e: unknown) => e);

    expect(toSafeErrorResponse(error)).toMatchObject({ ok: false, code: 'PROPERTY_LOOKUP_AMBIGUOUS', statusCode: 409 });
  });
});

describe('U20-A: the LU bootstrap maps an ambiguous root to a fail-closed outcome', () => {
  beforeEach(() => {
    mocks.projectFindUnique.mockResolvedValue({ id: 'proj-1', organisationId: 'org-1', propertyDesignation: 'ALE ÄLEBRÄCKE 1:31' });
    mocks.memberFindFirst.mockResolvedValue({
      userId: 'user-1',
      user: { id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-1', role: 'CONSULTANT', identityEnvironment: 'TEST' },
    });
    mocks.mimersCreate.mockResolvedValue({ artifactRepository: {} });
    // Genuine absence, exactly as the real provider reports it (W-APR contract): no binding
    // registered, empty binding graph. W-BOOT: any other failure would never reach the lookup.
    mocks.resolveCurrent.mockRejectedValue(
      new ProjectContextBindingCurrentUnavailableError(true, new Error('REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings')),
    );
  });

  it('ambiguous exact root -> { ok:false, failureCode: PROPERTY_LOOKUP_AMBIGUOUS }; nothing is signed or minted', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      row('ALE ÄLEBRÄCKE 1:31', 'lm-a', { match_count: 2 }),
      row('ALE ÄLEBRÄCKE 1:31', 'lm-b', { match_count: 2 }),
    ]);

    const outcome = await executeProjectContextBootstrap({ projectId: 'proj-1', propertyDesignation: 'ALE ÄLEBRÄCKE 1:31' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failureCode).toBe('PROPERTY_LOOKUP_AMBIGUOUS');
      expect(outcome.failureDetail).toContain('2');
    }
    expect(mocks.getSigner).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('collision row only (no exact row) -> fuzzy result is still refused as not exact', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:3>1', 'lm-3-1', { match_count: 1 })])
      .mockResolvedValueOnce([row('ALE ÄLEBRÄCKE 1:3>1', 'lm-3-1', { similarity: 1 })]);

    const outcome = await executeProjectContextBootstrap({ projectId: 'proj-1', propertyDesignation: 'ALE ÄLEBRÄCKE 1:31' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failureCode).toBe('PROPERTY_LOOKUP_NOT_EXACT');
    expect(mocks.getSigner).not.toHaveBeenCalled();
  });
});
