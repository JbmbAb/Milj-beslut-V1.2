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
    expect(notAssessed.find((c) => c.key === 'water')!.summary).toBe('Den senaste körningen i den här fliken gav ingen bedömning – kontrollen är inte gjord.');
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
      expect(c[layer]!.stateLabel).toMatch(/^Kontrollerat – ingen registrerad träff · begränsad täckning/);
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
    expect(hit.stateLabel).toBe('Kontrollerat – träff · begränsad täckning · känd lucka i underlaget');
  });

  it('W-M2d item 3: Natura 2000 carries its known gaps as state-near metadata -- kind, date, "ej omkontrollerad" -- not only a footnote', () => {
    const { readBack, c } = present();
    const server = readBack.governedLayerChecks.find((check) => check.layer === 'natura2000')!;
    const natura = c.natura2000!;
    expect(natura.knownGaps.map((gap) => gap.id)).toEqual(server.known_coverage_gaps.map((gap) => gap.gap_id));
    expect(natura.knownGaps.map((gap) => gap.id)).toEqual(['NATURA2000_SPA_ONLY', 'NATURA2000_SPA_103_OF_558_ABSENT']);
    const [scope, incomplete] = natura.knownGaps;
    expect(scope!.text).toBe(
      'Avgränsning enligt importkontraktet: kontrollen avser endast inläst SPA-underlag (fågelskyddsområden), inte fullständig Natura 2000-täckning; särskilda bevarandeområden (SCI/SAC) ingår inte.',
    );
    expect(incomplete!.kind).toBe('KNOWN_INCOMPLETE_DATA');
    expect(incomplete!.text).toBe(
      'Känd lucka i underlaget (2026-09-25): underlaget är känt ofullständigt (103 av 558 SPA-områden saknas enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell).',
    );
    expect(incomplete!.rechecked).toBe(false);
    // The known incompleteness travels in the state chip itself.
    expect(natura.stateLabel).toBe('Kontrollerat – ingen registrerad träff · begränsad täckning · känd lucka i underlaget');
    // Basis and sources are reachable in the evidence panel / technical section.
    expect(rowsOf(natura)['Känd lucka 2']).toContain('enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell');
    expect(natura.technical.find((row) => row.label === 'Känd lucka 2 – källor')?.value).toContain('KNOWN-COVERAGE-GAPS.md');
    // Water protection: the server's NV-only scope is in the chip (never plain green).
    expect(c.water_protection_area!.stateLabel).toBe('Kontrollerat – ingen registrerad träff · begränsad täckning');
    expect(c.water_protection_area!.knownGaps.map((gap) => gap.id)).toEqual(['WATER_PROTECTION_NV_ONLY']);
  });

  it('W-M2d item 3: a dataset version the import contracts do not know never gives an unexplained "ingen registrerad träff"', () => {
    const { readBack, c } = present({ layers: { natura2000: { kind: 'no_hit', version: 'f'.repeat(64) } } });
    const detail = readBack.evidenceDetails.find((d) => d.layer === 'natura2000')!;
    expect(detail.binding_assurance).toBe('HASH_BOUND_CONTRACT_UNKNOWN');
    const natura = c.natura2000!;
    expect(natura.state).toBe('NO_HIT'); // the server's state, unchanged
    expect(natura.datasetVersionUnknown).toBe(true);
    expect(natura.stateLabel).toBe('Kontrollerat – ingen registrerad träff · okänd datasetversion');
    expect(natura.coverageNote).toBe(
      'Datasetversionen finns inte i importkontrakten (ADMIT v1): källa, källversion och täckning kan inte anges (Saknas i underlaget).',
    );
    expect(c.ebh!.datasetVersionUnknown).toBe(false);
    expect(c.ebh!.stateLabel).toBe('Kontrollerat – ingen registrerad träff');
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

  it('W-M2e item 3 (M2d verification finding 5): a "no hit" whose own evidence is unreadable or fails integrity is never shown as checked; a HIT is never hidden', () => {
    const { readBack } = present({ layers: { water: { kind: 'hit' }, ebh: { kind: 'no_hit' } } });
    const withEvidence = (layer: string, patch: Record<string, unknown>) => {
      const check = readBack.governedLayerChecks.find((c) => c.layer === layer)!;
      const evidenceId = (check as { evidence_artifact_id?: string }).evidence_artifact_id;
      expect(evidenceId, `${layer} has pinned evidence in the fixture`).toBeTruthy();
      return presentLuControlChecks({
        property,
        assessment: PRESENT,
        server: {
          ...serverOf(readBack),
          evidenceDetails: readBack.evidenceDetails.map((d) => (d.evidence_artifact_id === evidenceId ? { ...d, ...patch } : d)),
        },
      }).find((row) => row.key === layer)!;
    };
    // The combination the server does not produce today (probe G): a CHECKED_NO_HIT row over evidence
    // the server itself reports unreadable or failing integrity.
    for (const patch of [{ technical_error_class: 'EVIDENCE_READ_ERROR' }, { technical_error_class: 'EVIDENCE_NOT_FOUND' }, { integrity: 'TAMPERED' }, { integrity: 'CORRUPTED' }]) {
      const row = withEvidence('ebh', patch);
      expect(row.state, JSON.stringify(patch)).toBe('UNCERTAIN');
      expect(row.stateLabel).toBe('Ofullständigt underlag');
      expect(row.summary).toBe('Kontrollposten från servern är motsägelsefull och visas därför inte som kontrollerad.');
      expect(row.registerNote).toBeNull();
    }
    // A HIT stays a HIT -- a stored risk is never hidden by the UI (the server names the inconsistency).
    expect(withEvidence('water', { technical_error_class: 'EVIDENCE_READ_ERROR' }).state).toBe('HIT');
    // Sound evidence leaves the no-hit as it is.
    expect(withEvidence('ebh', { integrity: 'CONTENT_HASH_VERIFIED' }).state).toBe('NO_HIT');
  });

  it('W-M2e item 2: a coverage_state named like an Object.prototype member is an unknown state (UNCERTAIN), never a mapped one', () => {
    const { readBack } = present();
    for (const coverage_state of ['constructor', 'toString', '__proto__']) {
      const rows = presentLuControlChecks({
        property,
        assessment: PRESENT,
        server: {
          layerChecks: readBack.governedLayerChecks.map((check) => (check.layer === 'water' ? { ...check, coverage_state } : check)),
          evidenceDetails: readBack.evidenceDetails,
          limitedCoverageLayers: [],
        },
      });
      const water = rows.find((row) => row.key === 'water')!;
      expect(water.state).toBe('UNCERTAIN');
      expect(water.stateLabel).toBe('Ofullständigt underlag');
      expect(water.summary).toBe('Servern redovisar ett okänt kontrolltillstånd.');
    }
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

  it('W-M2e item 3 (M2d verification finding 6): the property chip never says plain "Hittad" when the server states a lower assurance of the property root', () => {
    const { readBack } = present();
    const rowWith = (root: Record<string, unknown>) =>
      presentLuControlChecks({ property: { ...property, propertyRoot: { ...readBack.propertyRoot, ...root } }, assessment: PRESENT, server: serverOf(readBack) })[0]!;
    const lower = 'Fastighetsunderlaget har lägre säkerhet (rotens datasetbindning saknas).';
    for (const root of [{ status: 'RESOLVED', assurance: 'UNBOUND_METADATA' }, { status: 'NOT_RECORDED', assurance: 'UNKNOWN' }]) {
      const row = rowWith(root);
      expect(row.state).toBe('HIT');
      expect(row.stateLabel).toBe('Hittad · lägre säkerhet i fastighetsunderlaget');
      expect(row.rootAssuranceQualified).toBe(true);
      expect(row.summary).toContain(lower);
    }
    const unreadable = rowWith({ status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR', assurance: 'UNKNOWN' });
    expect(unreadable.stateLabel).toBe('Hittad · fastighetsunderlagets ursprung kunde inte läsas');
    expect(unreadable.summary).not.toMatch(/ROOT_READ_ERROR/);
    expect(rowWith({ status: 'TAMPERED', assurance: 'UNKNOWN' }).stateLabel).toBe('Hittad · fastighetsunderlagets ursprung klarade inte kontrollen');
    // A status or assurance this UI does not know is never shown as stronger than the server says.
    for (const root of [{ status: 'RESOLVED', assurance: 'SOMETHING_NEW' }, { status: 'BRAND_NEW', assurance: 'UNBOUND_METADATA' }, { status: 'constructor' }]) {
      expect(rowWith(root).stateLabel).toBe('Hittad · okänd säkerhet i fastighetsunderlaget');
    }
    // Without a displayed assessment there is no root statement: the lookup result alone is "Hittad".
    const noAssessment = presentLuControlChecks({ property, assessment: NONE, server: null })[0]!;
    expect(noAssessment.stateLabel).toBe('Hittad');
    expect(noAssessment.rootAssuranceQualified).toBe(false);
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
