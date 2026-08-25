import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { centroidToCanonicalCoordinates } from '../../scripts/ops/luPropertyCoordinateOrder';

/**
 * SPATIAL_COORDINATE_ORDER_DEFECT_01 — contract-level regression.
 *
 * Chain under test:
 *   propertyUnitService centroid [E, N] (ST_X/ST_Y source order)
 *     -> centroidToCanonicalCoordinates -> [N, E] (canonical LU contract)
 *     -> SpatialProviderPostGIS destructures [N, E] back to ST_MakePoint(E, N).
 */
describe('SPATIAL_COORDINATE_ORDER_DEFECT_01', () => {
  const realEasting = 678_583;
  const realNorthing = 6_604_084;

  it('reorders a known [easting, northing] source centroid into canonical [northing, easting]', () => {
    expect(centroidToCanonicalCoordinates([realEasting, realNorthing])).toEqual([realNorthing, realEasting]);
  });

  it('round-trips provider consumption back to ST_MakePoint(easting, northing)', () => {
    const [northing, easting] = centroidToCanonicalCoordinates([realEasting, realNorthing]);

    expect(easting).toBe(realEasting);
    expect(northing).toBe(realNorthing);
  });

  it('is deterministic for the same explicitly source-ordered centroid', () => {
    expect(centroidToCanonicalCoordinates([realEasting, realNorthing])).toEqual(
      centroidToCanonicalCoordinates([realEasting, realNorthing]),
    );
  });

  it('uses an explicit source-order boundary rather than inferring order from coordinate magnitudes', () => {
    const source = readFileSync(resolve(__dirname, '../../scripts/ops/luPropertyCoordinateOrder.ts'), 'utf8');

    expect(source).toContain('const [easting, northing] = centroidSweref99TmEastingNorthing');
    expect(source).toContain('return [northing, easting]');
    expect(source).not.toMatch(/\b(?:if|Math\.)[^\n]*(?:easting|northing)/);
  });

  it('is consumed by the canonical project-context bootstrap path', () => {
    const bootstrap = readFileSync(
      resolve(__dirname, '../../server/modules/localization/luProjectContextBootstrap.ts'),
      'utf8',
    );

    expect(bootstrap).toContain(
      "import { centroidToCanonicalCoordinates } from '../../../scripts/ops/luPropertyCoordinateOrder'",
    );
    expect(bootstrap).toContain(
      'coordinates: centroidToCanonicalCoordinates([Number(centroid[0]), Number(centroid[1])])',
    );
    expect(
      bootstrap.match(/coordinates: centroidToCanonicalCoordinates\(/g),
      'The source [E,N] -> canonical [N,E] conversion must happen exactly once in this producer.',
    ).toHaveLength(1);
  });
});
