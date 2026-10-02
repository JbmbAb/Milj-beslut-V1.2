import { describe, expect, it } from 'vitest';
import {
  LU_KNOWLEDGE_STATE_LABEL,
  checkEvidenceBinding,
  formatMatchCount,
  limitedCoverageLayersOf,
  parseServerArray,
  parseViewerEvidence,
  presentLuControlChecks,
  type LuAssessmentPresence,
  type LuServerChecksInput,
  type LuViewerEvidenceProps,
} from '../../components/app/lu/luControlChecks';
import { presentLuError } from '../../components/app/lu/luErrorPresentation';
import { governedReadBack, LU_LAYERS, type ReadBackOptions } from '../fixtures/luGovernedReadBack';

// Pure model test: no network, no database. W-M2d item 1: every check comes from the SERVER's
// read-back (built here by the server's own presentation functions, tests/fixtures/luGovernedReadBack.ts);
// the model only presents it.

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
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

function serverOf(readBack: ReturnType<typeof governedReadBack>): LuServerChecksInput {
  return {
    layerChecks: readBack.governedLayerChecks,
    evidenceDetails: readBack.evidenceDetails,
    limitedCoverageLayers: limitedCoverageLayersOf(readBack.overallStatement),
  };
}

function present(options: Omit<ReadBackOptions, 'id'> = {}) {
  const readBack = governedReadBack({ id: 'assessment-model', ...options });
  const checks = presentLuControlChecks({ property, assessment: PRESENT, server: serverOf(readBack) });
  return { readBack, c: Object.fromEntries(checks.map((check) => [check.key, check])), checks };
}

const rowsOf = (check: { details: readonly { label: string; value: string }[] }) =>
  Object.fromEntries(check.details.map((r) => [r.label, r.value]));

describe('W-M2d item 1: presentLuControlChecks shows the server\'s checks', () => {
  it('lists the LU v1 checks in a fixed order -- property, the five map layers, the document check', () => {
    const checks = presentLuControlChecks({ property, assessment: NONE, server: null });
    expect(checks.map((c) => c.label)).toEqual([
      'Fastighet och lokaliseringspunkt',
      'Brunnar',
      'Potentiellt förorenade områden (EBH)',
      'Skyddad natur',
      'Natura 2000',
      'Vattenskyddsområde',
      'Dokument och tidigare beslut',
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

  it('every server coverage_state maps one to one, with the server\'s own Swedish text as the row text', () => {
    const { readBack, c } = present({
      layers: {
        water: { kind: 'hit', count: 3 },
        ebh: { kind: 'no_hit' },
        protected_area: { kind: 'absent' },
        natura2000: { kind: 'unavailable' },
      },
    });
    const server = Object.fromEntries(readBack.governedLayerChecks.map((check) => [check.layer, check]));
    expect([server.water!.coverage_state, server.ebh!.coverage_state, server.protected_area!.coverage_state]).toEqual([
      'CHECKED_HIT',
      'CHECKED_NO_HIT',
      'NOT_CHECKED',
    ]);
    expect(c.water!.state).toBe('HIT');
    expect(c.ebh!.state).toBe('NO_HIT');
    expect(c.protected_area!.state).toBe('NOT_CHECKED');
    expect(c.natura2000!.state).toBe('SOURCE_UNAVAILABLE');
    expect(c.document!.state).toBe('NOT_CHECKED');
    for (const layer of [...LU_LAYERS, 'document']) expect(c[layer]!.summary).toBe(server[layer]!.message_sv);
    // Pinned evidence that cannot be read back: the server's TECHNICAL_ERROR.
    const technical = present({ layers: { water_protection_area: { kind: 'unreadable', readError: true } } });
    expect(technical.c.water_protection_area!.state).toBe('TECHNICAL_ERROR');
    expect(technical.c.water_protection_area!.stateLabel).toBe('Tekniskt fel');

    // INCOMPLETE_EVIDENCE (the server's "kunde inte tolkas") reads "Ofullständigt underlag".
    const incomplete = presentLuControlChecks({
      property,
      assessment: PRESENT,
      server: {
        layerChecks: readBack.governedLayerChecks.map((check) =>
          check.layer === 'ebh' ? { ...check, status: 'NOT_CHECKED', coverage_state: 'INCOMPLETE_EVIDENCE', reason: 'UNRECOGNIZED_RESULT' } : check,
        ),
        evidenceDetails: readBack.evidenceDetails,
        limitedCoverageLayers: [],
      },
    }).find((check) => check.key === 'ebh')!;
    expect(incomplete.state).toBe('UNCERTAIN');
    expect(incomplete.stateLabel).toBe('Ofullständigt underlag');
  });

  it('no assessment yet => every check is "Inte kontrollerat", never "ingen träff"; a run without assessment says so', () => {
    for (const c of presentLuControlChecks({ property, assessment: NONE, server: null }).filter((c) => c.key !== 'property')) {
      expect(c.state).toBe('NOT_CHECKED');
      expect(c.stateLabel).toBe('Inte kontrollerat');
      expect(c.summary).not.toMatch(/ingen (registrerad )?träff/i);
    }
    const notAssessed = presentLuControlChecks({ property, assessment: { status: 'not_assessed' }, server: null });
    expect(notAssessed.find((c) => c.key === 'water')!.summary).toBe('Den senaste körningen gav ingen bedömning – kontrollen är inte gjord.');
  });

  it('the evidence panel rows come from the server\'s evidenceDetails: count, cap, radius (never "avstånd"), source, version, time', () => {
    const { readBack, c } = present({ layers: { water: { kind: 'hit', count: 50 }, ebh: { kind: 'hit', count: 1, risk: 'HIGH' } } });
    const water = rowsOf(c.water!);
    expect(water.Resultat).toBe('Träff');
    expect(water.Antal).toBe('minst 50 objekt (räkningen stannar vid 50)');
    expect(water.Räknetak).toBe('Nått (50) – fler registrerade objekt kan finnas');
    expect(water.Sökradie).toBe('500 m (sökradie – inte ett uppmätt avstånd)');
    expect(water.Källa).toBe('SGU – Brunnar');
    expect(water.Källversion).toBe('2026-06-19');
    expect(water.Hämtad).not.toBe('Saknas i underlaget');
    expect(water['Upplösning/avgränsning']).toBe('Saknas i underlaget');
    expect(water.Importbatch).toBe('Saknas i underlaget');
    expect(rowsOf(c.ebh!).Räknetak).toBe('Inte nått (1 av högst 50)');
    expect(c.water!.searchRadiusMeters).toBe(500);
    expect(c.water!.evidenceArtifactId).toBe('evidence-water-test');
    for (const check of Object.values(c)) {
      expect(JSON.stringify(check.details) + check.summary).not.toMatch(/avstånd 500|500 m bort/i);
    }
    // Ids and hashes only in the technical rows.
    expect(water.Datasetversion).toBeUndefined();
    expect(c.water!.technical).toContainEqual({ label: 'Datasetversion', value: readBack.evidenceDetails[0]!.dataset_version_hash });
    expect(c.water!.technical).toContainEqual({ label: 'Underlags-id', value: 'evidence-water-test' });
  });

  it('preservation (SI-2): a negative register result says what it is -- never "no risk", "clean ground" or "no impact"', () => {
    const { c } = present();
    for (const layer of LU_LAYERS) {
      expect(c[layer]!.state).toBe('NO_HIT'); // machine-readable state unchanged
      expect(c[layer]!.registerNote).toMatch(/^Det är en registerkontroll/);
      expect(c[layer]!.registerNote).toMatch(/visar inte/);
      expect(`${c[layer]!.summary} ${c[layer]!.registerNote}`).not.toMatch(/inga risker|ingen risk|oförorenad|ren mark|inga avvikelser|LOW/i);
      expect(c[layer]!.registerNote).not.toContain(layer);
      expect(c[layer]!.technical).toContainEqual({ label: 'Dataset', value: layer });
    }
    expect(c.ebh!.registerNote).toBe(
      'Det är en registerkontroll, inte en markundersökning, och visar inte markens skick eller att föroreningar eller påverkan saknas.',
    );
    expect(rowsOf(c.ebh!).Evidenstyp).toBe('Registeruppgift / datasetobservation');
    expect(c.water!.registerNote).toContain('inte en inventering i fält');
    expect(c.document!.registerNote).toBeNull();
  });

  it('coverage: a check the server marks as limited states it in the chip and in the server\'s words -- no client contract table, no "rikstäckande"', () => {
    const { readBack, c, checks } = present();
    for (const layer of ['natura2000', 'protected_area', 'water_protection_area'] as const) {
      const server = readBack.governedLayerChecks.find((check) => check.layer === layer)!;
      expect(server.known_coverage_gaps.length).toBeGreaterThan(0);
      expect(c[layer]!.state).toBe('NO_HIT');
      expect(c[layer]!.coverageLimited).toBe(true);
      expect(c[layer]!.stateLabel).toBe('Kontrollerat – ingen registrerad träff · begränsad täckning');
      expect(c[layer]!.coverageNote).toBe(server.coverage_limitation_sv);
      expect(rowsOf(c[layer]!).Täckning).toBe(server.coverage_limitation_sv);
    }
    for (const layer of ['water', 'ebh'] as const) {
      expect(c[layer]!.coverageLimited).toBe(false);
      expect(c[layer]!.coverageNote).toBeNull();
      expect(rowsOf(c[layer]!).Täckning).toBe('Saknas i underlaget');
    }
    expect(JSON.stringify(checks)).not.toMatch(/rikstäckande|utpekade|beslutade/i);
    // A hit in a limited register is still a hit, with the limit stated.
    const hit = present({ layers: { natura2000: { kind: 'hit', risk: 'HIGH' } } }).c.natura2000!;
    expect(hit.state).toBe('HIT');
    expect(hit.stateLabel).toBe('Kontrollerat – träff · begränsad täckning');
  });

  it('the document check is the server\'s row; "limited" only because the server lists it as such', () => {
    const { readBack, c } = present({ documents: 'pinned' });
    expect(readBack.overallStatement.coverage?.limited_coverage_layers).toContain('document');
    expect(c.document!.state).toBe('HIT');
    expect(c.document!.stateLabel).toBe('Kontrollerat – träff · begränsad täckning');
    expect(c.document!.summary).toContain('Övriga dokument för fastigheten är inte kontrollerade.');
    const unreadable = present({ documents: 'unreadable' }).c.document!;
    expect(unreadable.state).toBe('TECHNICAL_ERROR');
    expect(unreadable.summary).toContain('Dokument och tidigare beslut: tekniskt fel.');
  });

  it('nothing is filled in: no checks in the answer, a check missing, an unknown or contradictory state -> "Ofullständigt underlag", never green', () => {
    const none = presentLuControlChecks({ property, assessment: PRESENT, server: { layerChecks: null, evidenceDetails: null, limitedCoverageLayers: [] } });
    for (const check of none.filter((c) => c.key !== 'property')) {
      expect(check.state).toBe('UNCERTAIN');
      expect(check.summary).toBe('Saknas i underlaget: svaret innehåller inga lagerkontroller för bedömningen.');
    }
    const { readBack } = present();
    const edited = presentLuControlChecks({
      property,
      assessment: PRESENT,
      server: {
        layerChecks: readBack.governedLayerChecks
          .filter((check) => check.layer !== 'ebh')
          .map((check) =>
            check.layer === 'water'
              ? { ...check, status: 'NOT_CHECKED' } // coverage_state CHECKED_NO_HIT contradicts its own status
              : check.layer === 'natura2000'
                ? { ...check, coverage_state: 'BRAND_NEW_STATE' }
                : check.layer === 'protected_area'
                  ? { ...check, coverage_state: undefined }
                  : check,
          ),
        evidenceDetails: readBack.evidenceDetails,
        limitedCoverageLayers: [],
      },
    });
    const c = Object.fromEntries(edited.map((check) => [check.key, check]));
    expect(c.ebh!.state).toBe('UNCERTAIN');
    expect(c.ebh!.summary).toBe('Saknas i underlaget: svaret innehåller ingen kontroll för detta lager.');
    expect(c.water!.state).toBe('UNCERTAIN');
    expect(c.water!.summary).toContain('motsägelsefull');
    expect(c.natura2000!.state).toBe('UNCERTAIN');
    expect(c.natura2000!.summary).toBe('Servern redovisar ett okänt kontrolltillstånd.');
    expect(c.protected_area!.state).toBe('UNCERTAIN');
    expect(c.protected_area!.summary).toBe('Saknas i underlaget: kontrolltillståndet saknas i svaret.');
  });

  it('a layer only the server reports is shown as the server states it, without its raw id in main text; garbage never crashes or goes green', () => {
    const { readBack } = present();
    const checks = presentLuControlChecks({
      property,
      assessment: PRESENT,
      server: {
        layerChecks: [
          ...readBack.governedLayerChecks,
          { layer: 'sgu_skred', rule_id: 'LU-SKRED-001', status: 'CHECKED_NO_HIT', coverage_state: 'CHECKED_NO_HIT', message_sv: 'Ingen registrerad träff.' },
          null,
          { ...readBack.governedLayerChecks[0]!, coverage_state: 'CHECKED_HIT', status: 'CHECKED_HIT' },
        ],
        evidenceDetails: readBack.evidenceDetails,
        limitedCoverageLayers: [],
      },
    });
    const c = Object.fromEntries(checks.map((check) => [check.key, check]));
    const extra = c['extra-sgu_skred']!;
    expect(extra.label).toBe('Annat underlag från servern');
    expect(`${extra.label} ${extra.summary} ${extra.registerNote}`).not.toContain('sgu_skred');
    expect(extra.technical).toContainEqual({ label: 'Lager', value: 'sgu_skred' });
    expect(extra.state).toBe('NO_HIT');
    expect(extra.registerNote).toBe('Servern redovisar inget registrerat objekt. Det visar inte att objekt eller påverkan saknas.');
    expect(c['extra-okand-7']!.state).toBe('UNCERTAIN');
    // The same check twice: the first is the check; the duplicate is never shown as a result.
    expect(c.water!.state).toBe('NO_HIT');
    expect(c['extra-water-8']!.state).toBe('UNCERTAIN');
  });

  it('M2b item 1: an unreadable saved assessment is "Tekniskt fel"; a governance refusal is "Ofullständigt underlag"', () => {
    const integrity = presentLuError(httpError(424, 'Governed LU assessment failed tamper verification.'), 'current-assessment');
    const unreadable = presentLuControlChecks({ property, assessment: { status: 'error', error: integrity }, server: null });
    expect(unreadable.find((c) => c.key === 'water')!.state).toBe('TECHNICAL_ERROR');
    expect(unreadable.find((c) => c.key === 'document')!.state).toBe('TECHNICAL_ERROR');
    const refused = presentLuError(
      httpError(409, 'Projektet har flera möjliga aktuella lokaliseringspunkter. Ingen bedömning görs förrän det är utrett vilken punkt som gäller.', {
        code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED',
        failureClass: 'AMBIGUOUS_CURRENT_GEOMETRY',
      }),
      'current-assessment',
    );
    const ambiguous = presentLuControlChecks({ property, assessment: { status: 'error', error: refused }, server: null }).find((c) => c.key === 'water')!;
    expect(ambiguous.state).toBe('UNCERTAIN');
  });

  it('property check: derived point is "Hittad"; refused geometry is "Ofullständigt underlag"; a fetch failure is "Tekniskt fel"; the root assurance is the server\'s', () => {
    const ok = presentLuControlChecks({ property, assessment: NONE, server: null })[0]!;
    expect(ok.state).toBe('HIT');
    expect(ok.stateLabel).toBe('Hittad');
    expect(ok.summary).toContain('beräknad mittpunkt av fastigheten (ej inmätt)');
    const refused = presentLuControlChecks({
      property: {
        lookedUp: true,
        geometryError: presentLuError(httpError(409, 'Lokaliseringen är tvetydig. Ingen bedömning görs.', { code: 'LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED' }), 'geometry-load'),
      },
      assessment: NONE,
      server: null,
    })[0]!;
    expect(refused.state).toBe('UNCERTAIN');
    const broken = presentLuControlChecks({
      property: { lookedUp: true, geometryError: presentLuError(new TypeError('Failed to fetch'), 'geometry-load') },
      assessment: NONE,
      server: null,
    })[0]!;
    expect(broken.state).toBe('TECHNICAL_ERROR');
    expect(broken.summary).toBe('Kontrollpunkten kunde inte hämtas. Servern kunde inte nås eller svarade oväntat.');
    expect(presentLuControlChecks({ property: { lookedUp: false }, assessment: NONE, server: null })[0]!.state).toBe('NOT_CHECKED');
    const { readBack } = present();
    const withRoot = presentLuControlChecks({ property: { ...property, propertyRoot: readBack.propertyRoot }, assessment: PRESENT, server: serverOf(readBack) })[0]!;
    expect(rowsOf(withRoot).Fastighetsunderlag).toBe(readBack.propertyRoot.message_sv);
    expect(withRoot.technical).toContainEqual({ label: 'Rotens säkerhet', value: 'UNKNOWN' });
  });

  it('M2b item 2 (map only): viewer evidence is accepted only when its ids are exactly the displayed assessment\'s spatial evidence refs', () => {
    const feature = (layer: string): LuViewerEvidenceProps => ({ cas_artifact_id: `evidence-${layer}-abc`, layer_id: layer, dataset: layer });
    const features = [feature('water'), feature('ebh')];
    expect(checkEvidenceBinding(features, ['evidence-water-abc', 'evidence-ebh-abc'])).toEqual({ ok: true });
    expect(checkEvidenceBinding(features, ['evidence-water-abc', 'evidence-ebh-abc', 'evidence-natura2000-abc']).ok).toBe(false);
    const foreign = checkEvidenceBinding([...features, feature('natura2000')], ['evidence-water-abc', 'evidence-ebh-abc']);
    expect(foreign.ok).toBe(false);
    if ('messageSv' in foreign) expect(foreign.messageSv).toBe('Kartans kontrollresultat hör inte till den visade bedömningen och visas därför inte på kartan.');
    expect(checkEvidenceBinding(features, null).ok).toBe(false);
    expect(checkEvidenceBinding([], []).ok).toBe(true);
    expect(checkEvidenceBinding([{}], []).ok).toBe(false);
  });

  it('formatMatchCount, parseViewerEvidence, parseServerArray and limitedCoverageLayersOf are defensive', () => {
    expect(formatMatchCount(3, 50)).toBe('3 objekt');
    expect(formatMatchCount(50, 50)).toBe('minst 50 objekt (räkningen stannar vid 50)');
    expect(formatMatchCount(undefined, 50)).toBeNull();
    expect(() => parseViewerEvidence({ ok: true, siteAnalyses: [] })).toThrow('Svaret var inte ett giltigt kontrollresultat.');
    expect(parseViewerEvidence({ type: 'FeatureCollection', features: [{ properties: { layer_id: 'ebh' } }] })).toEqual([{ layer_id: 'ebh' }]);
    expect(parseServerArray({ not: 'an array' })).toBeNull();
    expect(parseServerArray(undefined)).toBeNull();
    expect(parseServerArray([])).toEqual([]);
    expect(limitedCoverageLayersOf(undefined)).toEqual([]);
    expect(limitedCoverageLayersOf({ coverage: { limited_coverage_layers: ['natura2000', 3] } })).toEqual(['natura2000']);
  });
});
