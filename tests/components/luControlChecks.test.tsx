import { describe, expect, it } from 'vitest';
import {
  LU_KNOWLEDGE_STATE_LABEL,
  checkEvidenceBinding,
  deriveLuControlChecks,
  formatMatchCount,
  parseServerLayerChecks,
  parseViewerEvidence,
  type LuAssessmentPresence,
  type LuViewerEvidenceProps,
} from '../../components/app/lu/luControlChecks';
import { presentLuError } from '../../components/app/lu/luErrorPresentation';

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

const NONE: LuAssessmentPresence = { status: 'none' };
const PRESENT: LuAssessmentPresence = { status: 'present' };
const LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'] as const;
const RULES: Record<(typeof LAYERS)[number], string> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const byKey = (checks: ReturnType<typeof deriveLuControlChecks>) => Object.fromEntries(checks.map((c) => [c.key, c]));

describe('DEMO M2a/M2b luControlChecks', () => {
  it('lists exactly the six LU v1 checks in a fixed order', () => {
    const checks = deriveLuControlChecks({ property, assessment: NONE, evidence: { status: 'idle' }, findings: [] });
    expect(checks.map((c) => c.label)).toEqual([
      'Fastighet och lokaliseringspunkt',
      'Brunnar',
      'Potentiellt förorenade områden (EBH)',
      'Skyddad natur',
      'Natura 2000',
      'Vattenskyddsområde',
    ]);
  });

  it('M2b item 1 (§11): the six knowledge states carry six different labels -- none collapses into another', () => {
    const six = ['HIT', 'NO_HIT', 'NOT_CHECKED', 'SOURCE_UNAVAILABLE', 'UNCERTAIN', 'TECHNICAL_ERROR'] as const;
    const labels = six.map((s) => LU_KNOWLEDGE_STATE_LABEL[s]);
    expect(labels).toEqual([
      'Kontrollerat – träff',
      'Kontrollerat – ingen registrerad träff',
      'Inte kontrollerat',
      'Källa otillgänglig',
      'Ofullständigt underlag',
      'Tekniskt fel',
    ]);
    expect(new Set(labels).size).toBe(6);
  });

  it('M2b item 1: all six states are reachable from one realistic input and stay distinct', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: {
          status: 'loaded',
          features: [
            feature('water', true, 3), // HIT
            feature('ebh', false, 0), // NO_HIT
            // protected_area: no feature -> NOT_CHECKED
            feature('water_protection_area', true, 1, { governance_status: 'UNVERIFIED' }), // UNCERTAIN
          ],
        },
        findings: [{ finding_id: 'nc', rule_id: 'LU-NATURA2000-001', risk_level: 'NOT_CHECKED', explanation: 'x' }], // SOURCE_UNAVAILABLE
      }),
    );
    expect(c.water.state).toBe('HIT');
    expect(c.ebh.state).toBe('NO_HIT');
    expect(c.protected_area.state).toBe('NOT_CHECKED');
    expect(c.natura2000.state).toBe('SOURCE_UNAVAILABLE');
    expect(c.water_protection_area.state).toBe('UNCERTAIN');
    expect(c.water_protection_area.stateLabel).toBe('Ofullständigt underlag');
    const technical = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'error', error: presentLuError(httpError(500, 'boom'), 'viewer-evidence') },
        findings: [],
      }),
    );
    expect(technical.water.state).toBe('TECHNICAL_ERROR');
    expect(technical.water.stateLabel).toBe('Tekniskt fel');
  });

  it('no assessment yet => every layer is "Inte kontrollerat", never "ingen träff"', () => {
    const checks = deriveLuControlChecks({ property, assessment: NONE, evidence: { status: 'idle' }, findings: [] });
    for (const c of checks.filter((c) => c.key !== 'property')) {
      expect(c.state).toBe('NOT_CHECKED');
      expect(c.stateLabel).toBe('Inte kontrollerat');
      expect(c.summary).not.toMatch(/ingen (registrerad )?träff/i);
    }
  });

  it('M2b: a run that produced no assessment says so -- it never claims there is no saved assessment', () => {
    const c = byKey(deriveLuControlChecks({ property, assessment: { status: 'not_assessed' }, evidence: { status: 'idle' }, findings: [] }));
    expect(c.water.state).toBe('NOT_CHECKED');
    expect(c.water.summary).toBe('Den senaste körningen gav ingen bedömning – kontrollen är inte gjord.');
  });

  it('maps a real governed payload: hit, checked-no-hit, capped count, radius never as "avstånd"', () => {
    const features = [
      feature('ebh', true, 1),
      feature('natura2000', false, 0),
      feature('protected_area', false, 0),
      feature('water', true, 50),
      feature('water_protection_area', false, 0),
    ];
    const c = byKey(deriveLuControlChecks({ property, assessment: PRESENT, evidence: { status: 'loaded', features }, findings: [] }));
    expect(c.ebh.state).toBe('HIT');
    expect(c.ebh.stateLabel).toBe('Kontrollerat – träff');
    expect(c.ebh.summary).toBe('1 objekt inom sökradien 500 m.');
    expect(c.water.state).toBe('HIT');
    expect(c.water.summary).toBe('minst 50 objekt (räkningen stannar vid 50) inom sökradien 500 m.');
    expect(c.protected_area.state).toBe('NO_HIT');
    expect(c.protected_area.stateLabel).toBe('Kontrollerat – ingen registrerad träff');
    expect(c.protected_area.summary).toBe('Inga registrerade objekt inom sökradien 500 m.');
    expect(c.natura2000.state).toBe('NO_HIT');
    expect(c.water_protection_area.state).toBe('NO_HIT');
    expect(c.ebh.searchRadiusMeters).toBe(500);
    expect(c.ebh.registerNote).toBeNull(); // a hit carries no negative-register note
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
    // M2b: retrieved_at is in the CAS evidence but not in the viewer projection -- say exactly that.
    expect(ebhRows.Hämtad).toBe('Skickas inte med i kontrollresultatet');
    expect(c.ebh.technical.find((r) => r.label === 'Underlags-id')?.value).toBe('evidence-ebh-abc');
  });

  it('preservation (owner 2026-10-02): a negative register result says what it is -- never "no risk", "clean ground" or "no impact"', () => {
    const features = [
      feature('water', false, 0),
      feature('ebh', false, 0),
      feature('protected_area', false, 0),
      feature('natura2000', false, 0),
      feature('water_protection_area', false, 0),
    ];
    const c = byKey(deriveLuControlChecks({ property, assessment: PRESENT, evidence: { status: 'loaded', features }, findings: [] }));
    for (const layer of LAYERS) {
      expect(c[layer].state).toBe('NO_HIT'); // machine-readable state unchanged
      expect(c[layer].registerNote).toMatch(/^Register: inget registrerat objekt inom 500 m i lagret .+\. Det är en registerkontroll/);
      expect(c[layer].registerNote).toMatch(/visar inte/);
      expect(`${c[layer].summary} ${c[layer].registerNote}`).not.toMatch(/inga risker|ingen risk|oförorenad|ren mark|inga avvikelser|LOW/i);
      // M2c item 3 (verifier finding 6): no internal dataset id in the main text -- it is technical.
      expect(c[layer].registerNote).not.toContain('(dataset');
      expect(c[layer].registerNote).not.toContain(layer);
      expect(c[layer].technical).toContainEqual({ label: 'Dataset', value: layer });
    }
    expect(c.ebh.registerNote).toBe(
      'Register: inget registrerat objekt inom 500 m i lagret Potentiellt förorenade områden (EBH). Det är en registerkontroll, inte en markundersökning, och visar inte markens skick eller att föroreningar eller påverkan saknas.',
    );
    expect(c.water.registerNote).toContain('inte en inventering i fält');
    // M2c item 1: no longer "registerkontroll av utpekade Natura 2000-områden" (the register is SPA only).
    expect(c.natura2000.registerNote).toContain('Det är en registerkontroll och visar inte att påverkan på Natura 2000-områden saknas.');
    // Evidence panel: evidence type and the coverage/limit facts the API has; the rest is said to be missing.
    const rows = Object.fromEntries(c.ebh.details.map((r) => [r.label, r.value]));
    expect(rows.Evidenstyp).toBe('Registeruppgift / datasetobservation');
    expect(JSON.stringify(c.ebh.details)).not.toMatch(/mätning|modell/i);
    // M2c item 1: the source is the register as the import contract names it; the dataset id is technical.
    expect(rows.Källa).toBe('Länsstyrelsen – potentiellt förorenade områden (EBH)');
    expect(c.ebh.technical).toContainEqual({ label: 'Dataset', value: 'ebh' });
    expect(rows.Räknetak).toBe('Inte nått (0 av högst 50)');
    expect(rows['Upplösning/avgränsning']).toBe('Saknas i underlaget');
    expect(rows.Resultat).toBe('Ingen registrerad träff');
  });

  // ---------------------------------------------------------------------------------------------
  // DEMO M2c item 1 (M2b verifier finding 1, High): every register states its ACTUAL coverage as the
  // frozen import contracts give it (docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md +
  // ADMIT-V1-SET.md), bound to the exact dataset version (contract source_sha256 == evidence version).
  // ---------------------------------------------------------------------------------------------
  const CONTRACT_SHA: Record<(typeof LAYERS)[number], string> = {
    water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
    ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
    protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
    natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
    water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
  };
  const contractFeature = (layer: (typeof LAYERS)[number], exists: boolean, count: number) =>
    feature(layer, exists, count, { version: CONTRACT_SHA[layer], layer_version_hash: CONTRACT_SHA[layer] });
  const rowsOf = (check: { details: readonly { label: string; value: string }[] }) =>
    Object.fromEntries(check.details.map((r) => [r.label, r.value]));

  it('M2c item 1: Natura 2000 (SPA only) and Skyddad natur (naturreservat only) are never an unqualified "ingen registrerad träff"', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: LAYERS.map((layer) => contractFeature(layer, false, 0)) },
        findings: [],
      }),
    );
    // Machine-readable state is unchanged ...
    expect(c.natura2000.state).toBe('NO_HIT');
    expect(c.protected_area.state).toBe('NO_HIT');
    // ... but the chip carries the known partial coverage in the same box.
    expect(c.natura2000.coverageLimited).toBe(true);
    expect(c.natura2000.stateLabel).toBe('Kontrollerat – ingen registrerad träff · begränsad täckning');
    expect(c.natura2000.coverageNote).toBe(
      'Täckning: endast fågeldirektivets områden (SPA). Habitatdirektivets områden (SCI/SAC) ingår inte i underlaget och är inte kontrollerade.',
    );
    expect(c.protected_area.coverageLimited).toBe(true);
    expect(c.protected_area.stateLabel).toBe('Kontrollerat – ingen registrerad träff · begränsad täckning');
    expect(c.protected_area.coverageNote).toBe(
      'Täckning: endast naturreservat. Andra typer av skyddade områden ingår inte i underlaget och är inte kontrollerade.',
    );
    // The register notes no longer claim the whole category ("utpekade ... områden", "beslutade").
    for (const layer of LAYERS) {
      expect(`${c[layer].summary} ${c[layer].registerNote} ${c[layer].coverageNote ?? ''}`).not.toMatch(/utpekade|beslutade/);
      expect(`${c[layer].summary} ${c[layer].registerNote}`).not.toMatch(/inga risker|ingen risk|oförorenad|ren mark|inga avvikelser/i);
    }
    // Evidence panel: source, dated version and coverage from the contract, or "Saknas i underlaget".
    expect(rowsOf(c.natura2000).Källa).toBe('Naturvårdsverket – Natura 2000, fågeldirektivets områden (SPA), rikstäckande');
    expect(rowsOf(c.natura2000).Källversion).toBe('2026-05-08');
    expect(rowsOf(c.natura2000).Täckning).toBe(
      'Endast fågeldirektivets områden (SPA). Habitatdirektivets områden (SCI/SAC) ingår inte i underlaget och är inte kontrollerade.',
    );
    expect(rowsOf(c.protected_area).Källa).toBe('Naturvårdsverket – skyddade områden: naturreservat');
    expect(rowsOf(c.protected_area).Källversion).toBe('Saknas i underlaget');
  });

  it('M2c item 1: wells, EBH and water protection state what the contract says -- and "Saknas i underlaget" where it says nothing', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: LAYERS.map((layer) => contractFeature(layer, false, 0)) },
        findings: [],
      }),
    );
    for (const layer of ['water', 'ebh', 'water_protection_area'] as const) {
      expect(c[layer].coverageLimited).toBe(false);
      expect(c[layer].stateLabel).toBe('Kontrollerat – ingen registrerad träff');
    }
    expect(c.water.coverageNote).toBeNull();
    expect(rowsOf(c.water).Täckning).toBe('Saknas i underlaget');
    expect(rowsOf(c.water).Källa).toBe('SGU – brunnar');
    expect(rowsOf(c.water).Källversion).toBe('2026-06-19');
    expect(c.ebh.coverageNote).toBeNull();
    expect(rowsOf(c.ebh).Täckning).toBe('Saknas i underlaget');
    expect(rowsOf(c.ebh).Källa).toBe('Länsstyrelsen – potentiellt förorenade områden (EBH)');
    expect(rowsOf(c.ebh).Källversion).toBe('2026-07-23');
    expect(c.water_protection_area.coverageNote).toBe(
      'Täckning: endast Naturvårdsverkets dataset ingår; Länsstyrelsens vattenskyddsdata (VISS) ingår inte. Om datasetet omfattar alla vattenskyddsområden: saknas i underlaget.',
    );
    expect(rowsOf(c.water_protection_area).Källa).toBe('Naturvårdsverket – vattenskyddsområden');
    expect(rowsOf(c.water_protection_area).Källversion).toBe('Saknas i underlaget');
  });

  it('M2c item 1: the coverage statement is bound to the exact dataset version -- another version says "Saknas i underlaget"', () => {
    const otherVersion = 'f'.repeat(64);
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [feature('natura2000', false, 0, { version: otherVersion, layer_version_hash: otherVersion })] },
        findings: [],
      }),
    );
    expect(c.natura2000.state).toBe('NO_HIT');
    expect(c.natura2000.coverageLimited).toBe(false);
    expect(c.natura2000.coverageNote).toBeNull();
    expect(rowsOf(c.natura2000).Täckning).toBe('Saknas i underlaget');
    expect(rowsOf(c.natura2000).Källa).toBe('Saknas i underlaget');
    expect(c.natura2000.technical).toContainEqual({
      label: 'Importkontrakt',
      value: 'Datasetversionen finns inte i importkontraktet (LAYER-ID-CONTRACTS-V1).',
    });
  });

  it('M2c item 1: a hit in a partially covered register is still a hit, with the coverage stated', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [contractFeature('natura2000', true, 1)] },
        findings: [],
      }),
    );
    expect(c.natura2000.state).toBe('HIT');
    expect(c.natura2000.stateLabel).toBe('Kontrollerat – träff · begränsad täckning');
    expect(c.natura2000.coverageNote).toContain('endast fågeldirektivets områden (SPA)');
    expect(c.natura2000.technical).toContainEqual({
      label: 'Importkontrakt',
      value: 'lu.natura2000 · Naturvardsverket/Natura2000/2026-05-08/SPA_Rikstackande',
    });
  });

  it('the count cap is stated when it was reached, and said to be missing when the API has no cap', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [feature('water', true, 50), feature('ebh', true, 3, { max_features_per_layer: undefined })] },
        findings: [],
      }),
    );
    expect(Object.fromEntries(c.water.details.map((r) => [r.label, r.value])).Räknetak).toBe('Nått (50) – fler registrerade objekt kan finnas');
    expect(Object.fromEntries(c.ebh.details.map((r) => [r.label, r.value])).Räknetak).toBe('Saknas i underlaget');
  });

  it('a retrieved_at that the projection does carry is shown, not hidden', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [feature('ebh', true, 1, { retrieved_at: '2026-10-01T10:00:00.000Z' })] },
        findings: [],
      }),
    );
    expect(Object.fromEntries(c.ebh.details.map((r) => [r.label, r.value])).Hämtad).not.toBe('Skickas inte med i kontrollresultatet');
  });

  it('a layer missing from the evidence is "Inte kontrollerat" (silence is never absence)', () => {
    const features = [feature('ebh', false, 0)];
    const c = byKey(deriveLuControlChecks({ property, assessment: PRESENT, evidence: { status: 'loaded', features }, findings: [] }));
    expect(c.ebh.state).toBe('NO_HIT');
    expect(c.water.state).toBe('NOT_CHECKED');
    expect(c.natura2000.state).toBe('NOT_CHECKED');
  });

  it('a NOT_CHECKED finding => "Källa otillgänglig"; unverified or uninterpretable evidence => "Ofullständigt underlag"', () => {
    const features = [
      feature('water', true, 3, { governance_status: 'UNVERIFIED' }),
      feature('ebh', 'yes', 1),
    ];
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
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

  it('M2b item 1: an evidence fetch error is "Tekniskt fel" -- never "ingen träff", never "Ofullständigt underlag"', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'error', error: presentLuError(httpError(500, 'HTTP 500'), 'viewer-evidence') },
        findings: [],
      }),
    );
    expect(c.water.state).toBe('TECHNICAL_ERROR');
    expect(c.water.summary).toBe('Kontrollresultaten kunde inte hämtas. Ett tekniskt fel uppstod på servern.');
    expect(c.water.summary).not.toMatch(/ingen (registrerad )?träff|Ofullständigt/i);
  });

  it('M2b item 1: a missing viewer capability does NOT turn five layers with findings into "Ofullständigt underlag"', () => {
    const findings = LAYERS.map((layer) => ({ finding_id: `f-${layer}`, rule_id: RULES[layer], risk_level: 'MEDIUM', explanation: 'x' }));
    const error = presentLuError(httpError(404, 'Governed viewer capability is not configured for this project.'), 'viewer-evidence');
    const c = byKey(deriveLuControlChecks({ property, assessment: PRESENT, evidence: { status: 'error', error }, findings }));
    for (const layer of LAYERS) {
      expect(c[layer].state).toBe('TECHNICAL_ERROR');
      expect(c[layer].stateLabel).toBe('Tekniskt fel');
      expect(c[layer].summary).toContain('Kartvisningen för projektet är inte förberedd ännu');
      expect(c[layer].summary).toContain('Bedömningen har ett fynd för detta lager – se Fynd.');
      expect(c[layer].summary).not.toMatch(/Governed|capability/);
      // The server's own text stays machine-readable in the technical rows.
      expect(c[layer].technical.map((r) => r.value)).toContain('Governed viewer capability is not configured for this project.');
    }
  });

  it('M2b item 1: an unreadable saved assessment is "Tekniskt fel"; a governance refusal is "Ofullständigt underlag"', () => {
    const integrity = presentLuError(httpError(424, 'Governed LU assessment failed tamper verification.'), 'current-assessment');
    const unreadable = byKey(deriveLuControlChecks({ property, assessment: { status: 'error', error: integrity }, evidence: { status: 'idle' }, findings: [] }));
    expect(unreadable.water.state).toBe('TECHNICAL_ERROR');
    expect(unreadable.water.summary).not.toMatch(/ingen bedömning/);
    const refused = presentLuError(
      httpError(409, 'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.', {
        code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
        failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY',
        reasonCode: 'LOCALIZATION_GEOMETRY_AMBIGUOUS_CURRENT_GEOMETRY',
      }),
      'current-assessment',
    );
    const ambiguous = byKey(deriveLuControlChecks({ property, assessment: { status: 'error', error: refused }, evidence: { status: 'idle' }, findings: [] }));
    expect(ambiguous.water.state).toBe('UNCERTAIN');
    expect(ambiguous.water.summary).toContain('flera möjliga aktuella lokaliseringspunkter');
  });

  it('property check: derived point is "Hittad" and labelled computed; refused geometry is "Ofullständigt underlag"; a fetch failure is "Tekniskt fel"', () => {
    const ok = byKey(deriveLuControlChecks({ property, assessment: NONE, evidence: { status: 'idle' }, findings: [] }));
    expect(ok.property.state).toBe('HIT');
    expect(ok.property.stateLabel).toBe('Hittad');
    expect(ok.property.summary).toContain('beräknad mittpunkt av fastigheten (ej inmätt)');
    const refused = byKey(
      deriveLuControlChecks({
        property: {
          lookedUp: true,
          geometryError: presentLuError(httpError(409, 'Lokaliseringen är tvetydig. Ingen bedömning görs.', { code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED' }), 'geometry-load'),
        },
        assessment: NONE,
        evidence: { status: 'idle' },
        findings: [],
      }),
    );
    expect(refused.property.state).toBe('UNCERTAIN');
    const broken = byKey(
      deriveLuControlChecks({
        property: { lookedUp: true, geometryError: presentLuError(new TypeError('Failed to fetch'), 'geometry-load') },
        assessment: NONE,
        evidence: { status: 'idle' },
        findings: [],
      }),
    );
    expect(broken.property.state).toBe('TECHNICAL_ERROR');
    expect(broken.property.summary).toBe('Kontrollpunkten kunde inte hämtas. Servern kunde inte nås eller svarade oväntat.');
    const none = byKey(deriveLuControlChecks({ property: { lookedUp: false }, assessment: NONE, evidence: { status: 'idle' }, findings: [] }));
    expect(none.property.state).toBe('NOT_CHECKED');
  });

  it('M2b item 5: server-reported layers outside the six are shown as the server states them; "document" NOT_CHECKED reads "Ej analyserat"', () => {
    const checks = deriveLuControlChecks({
      property,
      assessment: PRESENT,
      evidence: { status: 'loaded', features: [feature('water', true, 1)] },
      findings: [],
      serverLayerChecks: [
        { layer: 'water', status: 'CHECKED_NO_HIT' }, // known layer: ignored here, the evidence decides
        { layer: 'document', rule_id: null, status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' },
        { layer: 'sgu_skred', status: 'BRAND_NEW_STATUS' },
        null,
      ],
    });
    const c = byKey(checks);
    expect(c.water.state).toBe('HIT');
    expect(c['extra-water']).toBeUndefined();
    expect(c['extra-document'].label).toBe('Dokumentbevis');
    expect(c['extra-document'].state).toBe('NOT_CHECKED');
    expect(c['extra-document'].summary).toBe('Ej analyserat. Inget verifierat dokumentunderlag är knutet till bedömningen.');
    expect(c['extra-document'].technical).toContainEqual({ label: 'Orsakskod', value: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' });
    expect(c['extra-sgu_skred'].state).toBe('UNCERTAIN');
    expect(c['extra-okand-3'].state).toBe('UNCERTAIN');
  });

  it('M2c item 3: a server row for an unknown layer shows no raw layer id in the main text; its negative result is qualified', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [] },
        findings: [],
        serverLayerChecks: [{ layer: 'sgu_skred', rule_id: 'LU-SKRED-001', status: 'CHECKED_NO_HIT', reason: null }],
      }),
    );
    const row = c['extra-sgu_skred'];
    expect(row.label).toBe('Annat underlag från servern');
    expect(`${row.label} ${row.summary} ${row.registerNote}`).not.toContain('sgu_skred');
    expect(row.technical).toContainEqual({ label: 'Lager', value: 'sgu_skred' });
    expect(row.state).toBe('NO_HIT');
    expect(row.registerNote).toBe('Servern redovisar inget registrerat objekt. Det visar inte att objekt eller påverkan saknas.');
  });

  it('M2c item 3: a document check with a hit covers only the pinned document evidence -- shown as limited, never as complete', () => {
    const c = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [] },
        findings: [],
        serverLayerChecks: [
          {
            layer: 'document',
            rule_id: 'LU-DOC-BESLUT-001',
            status: 'CHECKED_HIT',
            evidence_artifact_id: 'doc-evidence-1',
            reason: null,
            message_sv: 'Dokument och tidigare beslut: kontrollerat – träff. Bedömningen innehåller verifierat dokumentbevis (se fynd). Övriga dokument för fastigheten är inte kontrollerade.',
          },
        ],
      }),
    );
    const doc = c['extra-document'];
    expect(doc.state).toBe('HIT'); // the server's state, unchanged
    expect(doc.coverageLimited).toBe(true);
    expect(doc.stateLabel).toBe('Kontrollerat – träff · begränsad täckning');
    expect(doc.coverageNote).toBe(
      'Täckning: endast dokumentbevis som är knutet till bedömningen. Övriga dokument för fastigheten är inte kontrollerade.',
    );
    expect(doc.limitedCoverageShort).toBe('endast dokumentbevis knutet till bedömningen; övriga dokument för fastigheten är inte kontrollerade');
    // NOT_CHECKED stays what it is -- a limitation is only stated for a checked result.
    const notChecked = byKey(
      deriveLuControlChecks({
        property,
        assessment: PRESENT,
        evidence: { status: 'loaded', features: [] },
        findings: [],
        serverLayerChecks: [{ layer: 'document', status: 'NOT_CHECKED', reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED' }],
      }),
    )['extra-document'];
    expect(notChecked.coverageLimited).toBe(false);
    expect(notChecked.stateLabel).toBe('Inte kontrollerat');
  });

  it('M2b item 5: extra rows appear only for a present assessment and never without a server list', () => {
    const list = [{ layer: 'document', status: 'NOT_CHECKED' }];
    expect(deriveLuControlChecks({ property, assessment: NONE, evidence: { status: 'idle' }, findings: [], serverLayerChecks: list })).toHaveLength(6);
    expect(deriveLuControlChecks({ property, assessment: PRESENT, evidence: { status: 'idle' }, findings: [], serverLayerChecks: null })).toHaveLength(6);
    expect(parseServerLayerChecks({ not: 'an array' })).toBeNull();
    expect(parseServerLayerChecks(undefined)).toBeNull();
    expect(parseServerLayerChecks([])).toEqual([]);
  });

  it('M2b item 2: viewer evidence is accepted only when its ids are exactly the displayed assessment\'s spatial evidence refs', () => {
    const features = [feature('water', true, 1), feature('ebh', false, 0)];
    expect(checkEvidenceBinding(features, ['evidence-water-abc', 'evidence-ebh-abc'])).toEqual({ ok: true });
    const missing = checkEvidenceBinding(features, ['evidence-water-abc', 'evidence-ebh-abc', 'evidence-natura2000-abc']);
    expect(missing.ok).toBe(false);
    const foreign = checkEvidenceBinding([...features, feature('natura2000', false, 0)], ['evidence-water-abc', 'evidence-ebh-abc']);
    expect(foreign.ok).toBe(false);
    if ('messageSv' in foreign) expect(foreign.messageSv).toBe('Kontrollresultaten hör inte till den visade bedömningen och visas därför inte.');
    expect(checkEvidenceBinding(features, null).ok).toBe(false);
    expect(checkEvidenceBinding([], []).ok).toBe(true);
    expect(checkEvidenceBinding([{}], []).ok).toBe(false);
  });

  it('formatMatchCount and parseViewerEvidence are defensive', () => {
    expect(formatMatchCount(3, 50)).toBe('3 objekt');
    expect(formatMatchCount(50, 50)).toBe('minst 50 objekt (räkningen stannar vid 50)');
    expect(formatMatchCount(undefined, 50)).toBeNull();
    expect(() => parseViewerEvidence({ ok: true, siteAnalyses: [] })).toThrow('Svaret var inte ett giltigt kontrollresultat.');
    expect(parseViewerEvidence({ type: 'FeatureCollection', features: [{ properties: { layer_id: 'ebh' } }] })).toEqual([
      { layer_id: 'ebh' },
    ]);
  });
});
