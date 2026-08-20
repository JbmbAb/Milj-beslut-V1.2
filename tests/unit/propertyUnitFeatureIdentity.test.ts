import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock('../../server/security/auditTrail', () => ({ appendPropertyAudit: vi.fn() }));
vi.mock('../../server/repositories/auditRepository', () => ({ writePropertyAccessLog: vi.fn() }));
vi.mock('../../server/repositories/projectAccessRepository', () => ({ assertProjectMembership: vi.fn() }));

import { getPropertyLayer } from '../../server/services/propertyUnitService';

const bbox = { minLng: 18, minLat: 59, maxLng: 19, maxLat: 60 };
const geometry = '{"type":"Polygon","coordinates":[[[18,59],[19,59],[19,60],[18,59]]]}';

describe('property read-model feature identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the source dataset and source key for an individual property feature', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: '12345',
        source_dataset: 'lm_fastighetsytor',
        raw_properties: { objektidentitet: '12345' },
        designation: 'TEST 1:1',
        geometry_geojson: geometry,
      },
    ]);

    const result = await getPropertyLayer(bbox);

    expect(result.features[0]).toMatchObject({
      id: 'rmf:v1:source:property:lm_fastighetsytor:12345',
      properties: {
        feature_identity: {
          identity_kind: 'SOURCE',
          source_feature_id: '12345',
        },
      },
    });
  });

  it('derives the same merged property reference regardless of component order', async () => {
    const row = (raw_properties: unknown) => ({
      source_key: 'merged:test-1-1',
      source_dataset: 'lm_fastighetsytor_merged',
      raw_properties,
      designation: 'TEST 1:1',
      geometry_geojson: geometry,
    });
    mocks.queryRaw
      .mockResolvedValueOnce([row([{ objektidentitet: '2' }, { objektidentitet: '1' }])])
      .mockResolvedValueOnce([row([{ objektidentitet: '1' }, { objektidentitet: '2' }])]);

    const first = await getPropertyLayer(bbox);
    const reordered = await getPropertyLayer(bbox);

    expect(first.features[0]?.id).toBe(reordered.features[0]?.id);
    expect(first.features[0]?.properties).toMatchObject({
      feature_identity: { identity_kind: 'DERIVED' },
    });
  });

  it('does not fabricate a merged property identity when source components are unavailable', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        source_key: 'merged:test-1-1',
        source_dataset: 'lm_fastighetsytor_merged',
        raw_properties: [],
        designation: 'TEST 1:1',
        geometry_geojson: geometry,
      },
    ]);

    const result = await getPropertyLayer(bbox);

    expect(result.features[0]).toMatchObject({
      properties: {
        identity_unavailable: true,
        identity_unavailable_reason: 'merged_property_source_components_unavailable',
      },
    });
    expect(result.features[0]).not.toHaveProperty('id');
  });
});
