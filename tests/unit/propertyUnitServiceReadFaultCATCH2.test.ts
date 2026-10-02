/**
 * W-CATCH2 #15 (low; owner decisions 2026-10-02/03): the property read model must not lose information
 * silently.
 *  - The exact/fuzzy lookup that finds NO row is a determined absence: it keeps its message and now also
 *    a stable failureCode (LOCAL_PROPERTY_NOT_FOUND), so the bootstrap records a lasting "not in the
 *    property data" instead of a generic technical error (W-CATCH2 #4 classifies code-less errors).
 *  - getPropertyLayer dropped a row whose geometry could not be parsed without a trace: the count is now
 *    typed in the response meta and logged (no row content), and normal answers are unchanged.
 *  - A merged property whose raw_properties text cannot be parsed is named as such, not as "components
 *    unavailable".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), warn: vi.fn() }));

vi.mock('../../server/db/prisma', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../../server/security/auditTrail', () => ({ appendPropertyAudit: vi.fn() }));
vi.mock('../../server/repositories/auditRepository', () => ({ writePropertyAccessLog: vi.fn() }));
vi.mock('../../server/repositories/projectAccessRepository', () => ({ assertProjectMembership: vi.fn() }));
vi.mock('../../server/security/projectAccess', () => ({ validatePropertyLookupInput: vi.fn(), assertPermission: vi.fn() }));
vi.mock('../../server/logger', () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { getPropertyLayer, lookupPropertyByDesignationFromPostgis } from '../../server/services/propertyUnitService';

const bbox = { minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 };
const geometry = '{"type":"Polygon","coordinates":[[[18,59],[19,59],[19,60],[18,59]]]}';

beforeEach(() => vi.clearAllMocks());

describe('W-CATCH2 #15: a property that is not in the data is a typed, determined absence', () => {
  it('no exact and no fuzzy row -> the same message, now with failureCode LOCAL_PROPERTY_NOT_FOUND', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const error = (await lookupPropertyByDesignationFromPostgis(
      { projectId: 'p1', propertyDesignation: 'MISSING 1:1', purpose: 'test' },
      { id: 'u1', organisationId: 'o1', role: 'ADMIN' } as never,
    ).catch((e: unknown) => e)) as Error & { failureCode?: string };
    expect(error.message).toBe('Fastighet hittades inte i PostGIS: MISSING 1:1');
    expect(error.failureCode).toBe('LOCAL_PROPERTY_NOT_FOUND');
  });

  it('a database error is NOT turned into "not found": it propagates as it was', async () => {
    mocks.queryRaw.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const error = (await lookupPropertyByDesignationFromPostgis(
      { projectId: 'p1', propertyDesignation: 'X 1:1', purpose: 'test' },
      { id: 'u1', organisationId: 'o1', role: 'ADMIN' } as never,
    ).catch((e: unknown) => e)) as Error & { failureCode?: string };
    expect(error.message).toBe('connect ECONNREFUSED');
    expect(error.failureCode).toBeUndefined();
  });
});

describe('W-CATCH2 #15: the bbox read model never drops a row silently', () => {
  it('a row whose geometry cannot be parsed is left out, counted in meta and logged once (no row content)', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { source_key: 'k1', source_dataset: 'lm_fastighetsytor', designation: 'A 1:1', geometry_geojson: geometry },
      { source_key: 'k2', source_dataset: 'lm_fastighetsytor', designation: 'SECRET 9:9', geometry_geojson: 'not-json' },
    ]);
    const result = await getPropertyLayer(bbox);
    expect(result.features).toHaveLength(1);
    expect(result.meta).toMatchObject({ dropped_feature_count: 1, dropped_feature_reason: 'geometry_unparsable' });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(String(mocks.warn.mock.calls[0]?.[0])).toMatch(/1 row/);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/SECRET|k2/);
  });

  it('a normal answer is unchanged: no drop fields, no log', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ source_key: 'k1', source_dataset: 'lm_fastighetsytor', designation: 'A 1:1', geometry_geojson: geometry }]);
    const result = await getPropertyLayer(bbox);
    expect(result.meta).toEqual({
      presentation_kind: 'read_model',
      read_model_contract_version: 'read-model-feature-collection-v1',
      layer_id: 'property',
      provenance_status: 'PARTIAL',
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('a merged property whose raw_properties text cannot be parsed is named as such', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { source_key: 'merged:x', source_dataset: 'lm_fastighetsytor_merged', raw_properties: '{not json', designation: 'X 1:1', geometry_geojson: geometry },
    ]);
    const result = await getPropertyLayer(bbox);
    expect(result.features[0]).toMatchObject({
      properties: { identity_unavailable: true, identity_unavailable_reason: 'merged_property_raw_properties_unparsable' },
    });
  });
});
