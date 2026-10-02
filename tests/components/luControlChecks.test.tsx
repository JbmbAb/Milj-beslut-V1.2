import { describe, expect, it } from 'vitest';
import {
  deriveLuControlChecks,
  formatMatchCount,
  parseViewerEvidence,
  type LuViewerEvidenceProps,
} from '../../components/app/lu/luControlChecks';

// Pure model test: no network, no database. Feature shapes copied from a real governed
// /viewer/evidence payload (demo-runtime/m1a/uppsala-svia-1-111/09-viewer-evidence.json).
const feature = (layer: string, exists: unknown, count: number, extra: Partial<Record<string, unknown>> = {}): LuViewerEvidenceProps => ({
  cas_artifact_id: `evidence-${layer}-abc`,
  cas_content_hash: '09db167b5f0ccc2ff6a9dd2008429792bec6530b0cf1bb4411f6e1c88539202a',
  dataset: layer,
  version: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  engine: 'PostGIS',
  algorithm: 'spatial.dwithin_existence',
  result_semantics_kind: 'EXISTENCE_WITHIN_DISTANCE',
  exists,
  distance_meters: 500,
  match_count_observed: count,
  max_features_per_layer: 50,
  layer_id: layer,
  layer_version_hash: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  governance_status: 'VERIFIED_OBSERVATION',
  ...extra,
});

const property = {
  lookedUp: true,
  geometry: {
    artifact_id: 'localization-geometry-1',
    provenance: 'derived_from_property_boundary',
    wgs84LngLat: [17.74041, 59.87644] as const,
    provisioningStatus: 'COMPLETED',
  },
};

const byKey = (checks: ReturnType<typeof deriveLuControlChecks>) => Object.fromEntries(checks.map((c) => [c.key, c]));

describe('DEMO M2a luControlChecks', () => {
  it('lists exactly the six LU v1 checks in a fixed order', () => {
    const checks = deriveLuControlChecks({ property, assessment: 'none', evidence: { status: 'idle' }, findings: [] });
    expect(checks.map((c) => c.label)).toEqual([
      'Fastighet och lokaliseringspunkt',
      'Brunnar',
      'Potentiellt förorenade områden (EBH)',
      'Skyddad natur',
      'Natura 2000',
      'Vattenskyddsområde',
    ]);
  });

  it('no assessment yet => every layer is "Inte kontrollerat", never "ingen träff"', () => {
    const checks = deriveLuControlChecks({ property, assessment: 'none', evidence: { status: 'idle' }, findings: [] });
    for (const c of checks.filter((c) => c.key !== 'property')) {
      expect(c.state).toBe('NOT_CHECKED');
      expect(c.stateLabel).toBe('Inte kontrollerat');
      expect(c.summary).not.toMatch(/ingen träff/i);
    }
  });

  it('maps a real governed payload: hit, checked-no-hit, capped count, radius never as "avstånd"', () => {
    const features = [
      feature('ebh', true, 1),
      feature('natura2000', false, 0),
      feature('protected_area', false, 0),
      feature('water', true, 50),
      feature('water_protection_area', false, 0),
    ];
    const c = byKey(deriveLuControlChecks({ property, assessment: 'present', evidence: { status: 'loaded', features }, findings: [] }));
    expect(c.ebh.state).toBe('HIT');
    expect(c.ebh.summary).toBe('1 objekt inom sökradien 500 m.');
    expect(c.water.state).toBe('HIT');
    expect(c.water.summary).toBe('minst 50 objekt (räkningen stannar vid 50) inom sökradien 500 m.');
    expect(c.protected_area.state).toBe('NO_HIT');
    expect(c.protected_area.stateLabel).toBe('Kontrollerat – ingen träff');
    expect(c.protected_area.summary).toBe('Inga objekt inom sökradien 500 m.');
    expect(c.natura2000.state).toBe('NO_HIT');
    expect(c.water_protection_area.state).toBe('NO_HIT');
    expect(c.ebh.searchRadiusMeters).toBe(500);
    for (const check of Object.values(c)) {
      const text = JSON.stringify(check.details) + check.summary;
      expect(text).not.toMatch(/avstånd 500|500 m bort/i);
    }
    const ebhRows = Object.fromEntries(c.ebh.details.map((r) => [r.label, r.value]));
    expect(ebhRows.Resultat).toBe('Träff');
    expect(ebhRows.Antal).toBe('1 objekt');
    expect(ebhRows.Sökradie).toBe('500 m (sökradie – inte ett uppmätt avstånd)');
    expect(ebhRows.Metod).toContain('Förekomst inom sökradie (PostGIS)');
    expect(ebhRows.Datasetversion).toBe('02fccffc…');
    expect(ebhRows.Status).toBe('Verifierad observation');
    // retrieved_at is not in the governed payload: say so, never invent a date.
    expect(ebhRows.Hämtad).toBe('Saknas i underlaget');
    expect(c.ebh.technical.find((r) => r.label === 'Underlags-id')?.value).toBe('evidence-ebh-abc');
  });

  it('a layer missing from the evidence is "Inte kontrollerat" (silence is never absence)', () => {
    const features = [feature('ebh', false, 0)];
    const c = byKey(deriveLuControlChecks({ property, assessment: 'present', evidence: { status: 'loaded', features }, findings: [] }));
    expect(c.ebh.state).toBe('NO_HIT');
    expect(c.water.state).toBe('NOT_CHECKED');
    expect(c.natura2000.state).toBe('NOT_CHECKED');
  });

  it('a NOT_CHECKED finding => "Källa otillgänglig"; unverified or uninterpretable evidence => "Osäkert underlag"', () => {
    const features = [
      feature('water', true, 3, { governance_status: 'UNVERIFIED' }),
      feature('ebh', 'yes', 1),
    ];
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: 'present',
        evidence: { status: 'loaded', features },
        findings: [
          { finding_id: 'finding-notchecked-natura2000', rule_id: 'LU-NATURA2000-001', risk_level: 'NOT_CHECKED', explanation: 'x' },
        ],
      }),
    );
    expect(c.natura2000.state).toBe('SOURCE_UNAVAILABLE');
    expect(c.natura2000.stateLabel).toBe('Källa otillgänglig');
    expect(c.water.state).toBe('UNCERTAIN');
    expect(c.ebh.state).toBe('UNCERTAIN');
  });

  it('an evidence fetch error is "Osäkert underlag", never "ingen träff"', () => {
    const c = byKey(
      deriveLuControlChecks({ property, assessment: 'present', evidence: { status: 'error', message: 'HTTP 500' }, findings: [] }),
    );
    expect(c.water.state).toBe('UNCERTAIN');
    expect(c.water.summary).toBe('Kontrollresultatet kunde inte hämtas.');
  });

  it('property check: derived point is labelled as computed, fail-closed geometry is uncertain', () => {
    const ok = byKey(deriveLuControlChecks({ property, assessment: 'none', evidence: { status: 'idle' }, findings: [] }));
    expect(ok.property.state).toBe('HIT');
    expect(ok.property.summary).toContain('beräknad mittpunkt av fastigheten (ej inmätt)');
    const failed = byKey(
      deriveLuControlChecks({
        property: { lookedUp: true, geometryError: 'Lokaliseringen är tvetydig. Ingen bedömning görs.' },
        assessment: 'none',
        evidence: { status: 'idle' },
        findings: [],
      }),
    );
    expect(failed.property.state).toBe('UNCERTAIN');
    const none = byKey(deriveLuControlChecks({ property: { lookedUp: false }, assessment: 'none', evidence: { status: 'idle' }, findings: [] }));
    expect(none.property.state).toBe('NOT_CHECKED');
  });

  it('formatMatchCount and parseViewerEvidence are defensive', () => {
    expect(formatMatchCount(3, 50)).toBe('3 objekt');
    expect(formatMatchCount(50, 50)).toBe('minst 50 objekt (räkningen stannar vid 50)');
    expect(formatMatchCount(undefined, 50)).toBeNull();
    expect(() => parseViewerEvidence({ ok: true, siteAnalyses: [] })).toThrow();
    expect(parseViewerEvidence({ type: 'FeatureCollection', features: [{ properties: { layer_id: 'ebh' } }] })).toEqual([
      { layer_id: 'ebh' },
    ]);
  });
});
