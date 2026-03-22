import { describe, expect, it } from 'vitest';
import {
  findMatchingOgcFeatures,
  mergeOgcFeatureGeometry,
  minimizeOgcFeaturePayload,
  parseOgcDesignation,
} from '../../server/services/lantmaterietService';

describe('lantmaterietService OGC helpers', () => {
  it('parses municipality, tract and label for exact and fallback filters', () => {
    const parsed = parseOgcDesignation('Orsa Stackmora 3:12');

    expect(parsed.municipality).toBe('ORSA');
    expect(parsed.tract).toBe('STACKMORA');
    expect(parsed.label).toBe('3:12');
    expect(parsed.exactFilter).toBe("kommunnamn = 'ORSA' AND trakt = 'STACKMORA' AND etikett = '3:12'");
    expect(parsed.tractFilter).toBe("kommunnamn = 'ORSA' AND trakt = 'STACKMORA'");
  });

  it('matches split labels for a base property designation and sorts them predictably', () => {
    const features = [
      { properties: { etikett: '3:12>2' } },
      { properties: { etikett: '3:12>1' } },
      { properties: { etikett: '54:4' } },
    ];

    const matches = findMatchingOgcFeatures(features, 'Orsa Stackmora 3:12');

    expect(matches.map((feature) => feature.properties?.etikett)).toEqual(['3:12>1', '3:12>2']);
  });

  it('does not widen to sibling split labels when an exact split label is requested', () => {
    const features = [{ properties: { etikett: '3:12>2' } }, { properties: { etikett: '3:12>1' } }];

    const matches = findMatchingOgcFeatures(features, 'Orsa Stackmora 3:12>2');

    expect(matches.map((feature) => feature.properties?.etikett)).toEqual(['3:12>2']);
  });

  it('aggregates split polygons into a multipolygon payload', () => {
    const matches = findMatchingOgcFeatures(
      [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [14.73, 61.12],
                [14.74, 61.12],
                [14.74, 61.11],
                [14.73, 61.11],
                [14.73, 61.12],
              ],
            ],
          },
          properties: { etikett: '3:12>2' },
        },
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [14.75, 61.12],
                [14.76, 61.12],
                [14.76, 61.11],
                [14.75, 61.11],
                [14.75, 61.12],
              ],
            ],
          },
          properties: { etikett: '3:12>1' },
        },
      ],
      'Orsa Stackmora 3:12',
    );

    const payload = minimizeOgcFeaturePayload(matches, 'Orsa Stackmora 3:12') as {
      designation: string;
      geometry: { type: string; coordinates: unknown[] };
      boundaries: { type: string; features: unknown[] };
      matchedDesignations: string[];
    };

    expect(payload.designation).toBe('Orsa Stackmora 3:12');
    expect(payload.matchedDesignations).toEqual(['3:12>1', '3:12>2']);
    expect(payload.geometry.type).toBe('MultiPolygon');
    expect(payload.geometry.coordinates).toHaveLength(2);
    expect(payload.boundaries.type).toBe('FeatureCollection');
    expect(payload.boundaries.features).toHaveLength(2);
  });

  it('keeps the first geometry if mixed geometry types prevent aggregation', () => {
    const geometry = mergeOgcFeatureGeometry([
      {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [14.73, 61.12],
              [14.74, 61.12],
              [14.74, 61.11],
              [14.73, 61.11],
              [14.73, 61.12],
            ],
          ],
        },
      },
      { geometry: { type: 'Point', coordinates: [14.75, 61.12] } },
    ]) as { type: string };

    expect(geometry.type).toBe('Polygon');
  });
});
