/**
 * U20CDF2 (U20CDF verification G3; owner's locked specification 2026-10-02 night).
 *
 * The rule engine and the layer check used to read the same spatial evidence differently: the rule
 * engine fires on `result.exists` alone (LURuleEngine.ts), while the layer check also required the
 * admitted result kind and a match count consistent with `exists`. Evidence `{ exists: true,
 * match_count_observed: 0 }` therefore gave a MEDIUM finding next to "0 av 6".
 *
 * Owner: one common, validated normal form applied BEFORE both consumers; an invalid combination is
 * fail-closed, not a second interpretation; and a layer with a stored HIGH/MEDIUM/LOW finding was
 * processed and counts as completed. This file pins
 *  - the normal form itself (readSpatialEvidenceForm) and the fresh-run gate built on it
 *    (assertGovernedSpatialQueryOutcome: REJECT_SPATIAL_EVIDENCE_FORM, never reaching the rules),
 *  - that the layer check reads evidence through the same normal form, and
 *  - that a stored risk finding makes its layer CHECKED_HIT, also when its evidence is not the
 *    consistent evidence the current producer pins (reason FINDING_WITHOUT_CONSISTENT_EVIDENCE).
 * Pure functions plus the REAL LURuleEngine (deep import, as the kernel uses it); no DB, no CAS.
 */
import { describe, expect, it } from 'vitest';
import { LURuleEngine } from '../../packages/mps-lu/src/rules/LURuleEngine';
import {
  assertGovernedSpatialQueryOutcome,
  GovernedSpatialEvidenceFormError,
  readSpatialEvidenceForm,
} from '../../server/modules/localization/governedSpatialEvidenceForm';
import { computeGovernedLayerChecks } from '../../server/modules/localization/governedLayerChecks';

function ev(layer: string, result: Record<string, unknown> | undefined, kind: unknown = 'EXISTENCE_WITHIN_DISTANCE') {
  return {
    artifact_id: `evidence-${layer}-u20cdf2`,
    artifact_type: 'SPATIAL_EVIDENCE' as const,
    payload: {
      source_metadata: { dataset: layer },
      result_semantics: { ...(kind === undefined ? {} : { kind }), ...(result === undefined ? {} : { result }) },
    },
  };
}

describe('U20CDF2 (G3): the one normal form of a governed spatial evidence result', () => {
  it.each<[string, Record<string, unknown> | undefined, unknown, { valid: boolean; exists?: boolean; violation?: string }]>([
    ['negative, count 0', { exists: false, match_count_observed: 0 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: true, exists: false }],
    ['positive, count 3', { exists: true, match_count_observed: 3 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: true, exists: true }],
    ['negative, count absent', { exists: false }, 'EXISTENCE_WITHIN_DISTANCE', { valid: true, exists: false }],
    ['positive, count null (absent)', { exists: true, match_count_observed: null }, 'EXISTENCE_WITHIN_DISTANCE', { valid: true, exists: true }],
    ['kind absent (older evidence), positive', { exists: true }, undefined, { valid: true, exists: true }],
    ['exists:true with count 0 (G3)', { exists: true, match_count_observed: 0 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_CONTRADICTS_EXISTS' }],
    ['exists:false with count 3', { exists: false, match_count_observed: 3 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_CONTRADICTS_EXISTS' }],
    ['exists missing', { match_count_observed: 3 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'EXISTS_NOT_BOOLEAN' }],
    ['exists null', { exists: null }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'EXISTS_NOT_BOOLEAN' }],
    ['exists "true" (string; truthy for the rule engine)', { exists: 'true' }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'EXISTS_NOT_BOOLEAN' }],
    ['exists "false" (string; truthy for the rule engine)', { exists: 'false', match_count_observed: 0 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'EXISTS_NOT_BOOLEAN' }],
    ['count negative', { exists: false, match_count_observed: -1 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_NOT_A_COUNT' }],
    ['count fractional', { exists: true, match_count_observed: 1.5 }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_NOT_A_COUNT' }],
    ['count a string', { exists: true, match_count_observed: '3' }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_NOT_A_COUNT' }],
    ['count NaN', { exists: true, match_count_observed: Number.NaN }, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'MATCH_COUNT_NOT_A_COUNT' }],
    ['unadmitted kind', { exists: true, match_count_observed: 1 }, 'FEATURE_GEOMETRY', { valid: false, violation: 'RESULT_KIND_NOT_ADMITTED' }],
    ['result missing', undefined, 'EXISTENCE_WITHIN_DISTANCE', { valid: false, violation: 'RESULT_MISSING' }],
  ])('%s', (_label, result, kind, expected) => {
    expect(readSpatialEvidenceForm(ev('water', result, kind))).toMatchObject({ ...expected, ...(expected.valid ? { dataset: 'water' } : {}) });
  });

  // U20CDF3 (low 7a; mutation M30 survived without this): an array is not the plain result object of
  // the contract, also when it carries the contract's field names as own properties.
  it('an array-shaped result or result_semantics is not in the normal form, whatever properties it carries', () => {
    const arrayResult = Object.assign([], { exists: false, match_count_observed: 0 });
    expect(readSpatialEvidenceForm(ev('water', arrayResult as never))).toMatchObject({ valid: false, violation: 'RESULT_MISSING' });
    const arraySemantics = Object.assign([], { kind: 'EXISTENCE_WITHIN_DISTANCE', result: { exists: false } });
    const evidence = { artifact_id: 'a', payload: { source_metadata: { dataset: 'water' }, result_semantics: arraySemantics } };
    expect(readSpatialEvidenceForm(evidence)).toMatchObject({ valid: false, violation: 'RESULT_MISSING' });
  });

  it('evidence without a dataset name is not in the normal form', () => {
    const noDataset = { artifact_id: 'x', payload: { source_metadata: {}, result_semantics: { result: { exists: true } } } };
    expect(readSpatialEvidenceForm(noDataset)).toMatchObject({ valid: false, violation: 'DATASET_MISSING' });
    expect(readSpatialEvidenceForm(null)).toMatchObject({ valid: false, violation: 'DATASET_MISSING' });
  });
});

describe('U20CDF2 (G3): the fresh-run gate fails closed before the rule engine', () => {
  const valid = { evidence: [ev('water', { exists: true, match_count_observed: 3 }), ev('ebh', { exists: false, match_count_observed: 0 })], unavailable_layers: [{ dataset: 'natura2000', reason: 'SOURCE_UNAVAILABLE' }] };
  // U20CDF3: the gate is told which layers were requested; `valid` answers exactly these.
  const REQUESTED = ['water', 'ebh', 'natura2000'];
  const ALL_LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'];

  it('a provider outcome in the normal form passes', () => {
    expect(() => assertGovernedSpatialQueryOutcome(valid, REQUESTED)).not.toThrow();
  });

  // U20CDF3 (U20CDF2 verification H5.2 / low 5): silence about a requested layer -- neither evidence
  // nor an unavailable entry -- is not what any real provider returns (it answers every requested
  // layer). In a fresh run it is an invalid outcome form and fails closed, instead of producing a
  // record whose text says "denna historiska bedömning".
  it.each<[string, { evidence: unknown[]; unavailable_layers: unknown[] }, string]>([
    ['a provider that says nothing at all', { evidence: [], unavailable_layers: [] }, 'water'],
    ['a provider silent about one layer', { ...valid, evidence: [...valid.evidence, ev('water_protection_area', { exists: false, match_count_observed: 0 })] }, 'protected_area'],
    ['a provider silent about the last layer', {
      evidence: ['water', 'ebh', 'protected_area', 'natura2000'].map((layer) => ev(layer, { exists: false, match_count_observed: 0 })),
      unavailable_layers: [],
    }, 'water_protection_area'],
  ])('U20CDF3 (low 5): %s -> LAYER_NOT_ANSWERED for the first silent requested layer', (_label, outcome, layer) => {
    let thrown: unknown;
    try {
      assertGovernedSpatialQueryOutcome(outcome, ALL_LAYERS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GovernedSpatialEvidenceFormError);
    expect(thrown).toMatchObject({ violation: 'LAYER_NOT_ANSWERED', layer });
  });

  it.each<[string, Record<string, unknown> | undefined, unknown]>([
    ['exists:true with count 0', { exists: true, match_count_observed: 0 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['exists:false with count 3', { exists: false, match_count_observed: 3 }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['exists not a boolean', { exists: 'yes' }, 'EXISTENCE_WITHIN_DISTANCE'],
    ['unadmitted kind', { exists: true, match_count_observed: 1 }, 'FEATURE_GEOMETRY'],
    ['count not a count', { exists: true, match_count_observed: -2 }, 'EXISTENCE_WITHIN_DISTANCE'],
  ])('%s -> REJECT_SPATIAL_EVIDENCE_FORM (fail-closed, no second interpretation)', (_label, result, kind) => {
    const outcome = { ...valid, evidence: [...valid.evidence, ev('protected_area', result, kind)] };
    expect(() => assertGovernedSpatialQueryOutcome(outcome, [...REQUESTED, 'protected_area'])).toThrow(/^REJECT_SPATIAL_EVIDENCE_FORM: /);
  });

  it('evidence AND an unavailable entry for the same layer -> REJECT_SPATIAL_EVIDENCE_FORM', () => {
    const outcome = { ...valid, unavailable_layers: [...valid.unavailable_layers, { dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }] };
    expect(() => assertGovernedSpatialQueryOutcome(outcome, REQUESTED)).toThrow(/^REJECT_SPATIAL_EVIDENCE_FORM: water EVIDENCE_AND_UNAVAILABLE$/);
  });

  it('an unavailable entry without a dataset name -> REJECT_SPATIAL_EVIDENCE_FORM', () => {
    expect(() => assertGovernedSpatialQueryOutcome({ evidence: [], unavailable_layers: [{ dataset: '', reason: 'x' }] }, ALL_LAYERS)).toThrow(
      /^REJECT_SPATIAL_EVIDENCE_FORM: /,
    );
  });

  // U20CDF3 (U20CDF2 verification H6 / low 6): the rejection is its own typed class with a stable
  // machine code and the exact violation -- the fresh run can name it truthfully instead of
  // "ExecutionKernel error" / EXECUTION_KERNEL_ERROR (the kernel is never reached).
  it.each<[string, { evidence: unknown[]; unavailable_layers: unknown[] }, string, string | null]>([
    ['exists:true with count 0', { ...valid, evidence: [...valid.evidence, ev('protected_area', { exists: true, match_count_observed: 0 })] }, 'MATCH_COUNT_CONTRADICTS_EXISTS', 'protected_area'],
    ['exists not a boolean', { ...valid, evidence: [...valid.evidence, ev('protected_area', { exists: 'yes' })] }, 'EXISTS_NOT_BOOLEAN', 'protected_area'],
    ['evidence and unavailable for one layer', { ...valid, unavailable_layers: [...valid.unavailable_layers, { dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }] }, 'EVIDENCE_AND_UNAVAILABLE', 'water'],
    ['unavailable without a dataset', { evidence: [], unavailable_layers: [{ reason: 'x' }] }, 'UNAVAILABLE_WITHOUT_DATASET', null],
    ['evidence without a dataset', { evidence: [{ artifact_id: 'x', payload: { source_metadata: {}, result_semantics: { result: { exists: false } } } }], unavailable_layers: [] }, 'DATASET_MISSING', null],
  ])('U20CDF3 (low 6): %s -> a GovernedSpatialEvidenceFormError with code, violation and layer', (_label, outcome, violation, layer) => {
    let thrown: unknown;
    try {
      assertGovernedSpatialQueryOutcome(outcome, [...REQUESTED, 'protected_area']);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GovernedSpatialEvidenceFormError);
    expect(thrown).toMatchObject({ name: 'GovernedSpatialEvidenceFormError', code: 'REJECT_SPATIAL_EVIDENCE_FORM', violation, layer });
    expect((thrown as Error).message).toBe(`REJECT_SPATIAL_EVIDENCE_FORM: ${layer ?? 'okänt-lager'} ${violation}`);
  });

  it('for every outcome the gate admits, the rule engine and the layer check agree layer by layer', () => {
    const engine = new LURuleEngine();
    const states: Array<Record<string, unknown> | 'UNAVAILABLE'> = [
      { exists: false, match_count_observed: 0 },
      { exists: false },
      { exists: true, match_count_observed: 2 },
      { exists: true },
      'UNAVAILABLE',
    ];
    const layers = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'];
    for (const state of states) {
      for (const layer of layers) {
        const outcome = state === 'UNAVAILABLE'
          ? { evidence: [], unavailable_layers: [{ dataset: layer, reason: 'SOURCE_UNAVAILABLE' }] }
          : { evidence: [ev(layer, state)], unavailable_layers: [] };
        assertGovernedSpatialQueryOutcome(outcome, [layer]);
        const findings = engine.evaluate({
          spatial_evidence: outcome.evidence as never,
          document_evidence: [],
          unavailable_layers: outcome.unavailable_layers as never,
        });
        const [check] = computeGovernedLayerChecks({ requestedLayers: [layer], evidence: outcome.evidence, unavailableLayers: [], findings });
        const risk = findings.some((f) => f.risk_level === 'HIGH' || f.risk_level === 'MEDIUM' || f.risk_level === 'LOW');
        expect(check!.status === 'CHECKED_HIT', `${layer} ${JSON.stringify(state)}`).toBe(risk);
        expect(check!.reason === null || check!.status === 'NOT_CHECKED', `${layer} ${JSON.stringify(state)}`).toBe(true);
        if (state === 'UNAVAILABLE') expect(check).toMatchObject({ status: 'NOT_CHECKED', reason: 'NOT_CHECKED_FINDING' });
      }
    }
  });
});

describe('U20CDF3 (U20CDF2 verification H4 / low 2): every outcome names a distinct REQUESTED layer -- an unknown or mis-cased dataset is fail-closed, never a seventh row', () => {
  const ALL_LAYERS = ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'];
  const negatives = ALL_LAYERS.map((layer) => ev(layer, { exists: false, match_count_observed: 0 }));
  const rejection = (outcome: { evidence: unknown[]; unavailable_layers: unknown[] }) => {
    try {
      assertGovernedSpatialQueryOutcome(outcome, ALL_LAYERS);
    } catch (error) {
      return error;
    }
    return null;
  };

  it('the real provider outcome (one entry per requested layer, exact names) passes', () => {
    expect(rejection({ evidence: negatives, unavailable_layers: [] })).toBeNull();
    expect(rejection({ evidence: negatives.slice(1), unavailable_layers: [{ dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }] })).toBeNull();
  });

  it.each<[string, string]>([
    ['an unknown layer (verifier probe: flood, exists:true)', 'flood'],
    ['a mis-cased governed layer (WATER)', 'WATER'],
    ['a mis-cased governed layer (Natura2000)', 'Natura2000'],
    ['a governed layer with surrounding space', ' water'],
    ['a governed layer with a trailing space', 'ebh '],
    ['the document check name (not a spatial layer)', 'document'],
  ])('evidence for %s -> DATASET_NOT_REQUESTED, the provider string is never echoed as a layer', (_label, dataset) => {
    for (const exists of [true, false]) {
      const error = rejection({ evidence: [...negatives, ev(dataset, { exists, match_count_observed: exists ? 1 : 0 })], unavailable_layers: [] });
      expect(error).toBeInstanceOf(GovernedSpatialEvidenceFormError);
      expect(error).toMatchObject({ violation: 'DATASET_NOT_REQUESTED', layer: null });
      expect((error as Error).message).toBe('REJECT_SPATIAL_EVIDENCE_FORM: okänt-lager DATASET_NOT_REQUESTED');
    }
  });

  it('an unavailable entry for a layer that was not requested -> DATASET_NOT_REQUESTED', () => {
    const error = rejection({ evidence: negatives.slice(1), unavailable_layers: [{ dataset: 'WATER', reason: 'SOURCE_UNAVAILABLE' }] });
    expect(error).toMatchObject({ violation: 'DATASET_NOT_REQUESTED', layer: null });
  });

  it.each<[string, { evidence: unknown[]; unavailable_layers: unknown[] }]>([
    ['two evidences for one layer (one hit, one no-hit)', { evidence: [...negatives, ev('water', { exists: true, match_count_observed: 2 })], unavailable_layers: [] }],
    ['two identical negative evidences for one layer', { evidence: [...negatives, negatives[1]!], unavailable_layers: [] }],
    ['two unavailable entries for one layer', {
      evidence: negatives.slice(1),
      unavailable_layers: [{ dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }, { dataset: 'water', reason: 'SOURCE_UNAVAILABLE' }],
    }],
  ])('%s -> DUPLICATE_LAYER_OUTCOME', (_label, outcome) => {
    const error = rejection(outcome);
    expect(error).toBeInstanceOf(GovernedSpatialEvidenceFormError);
    expect((error as GovernedSpatialEvidenceFormError).violation).toBe('DUPLICATE_LAYER_OUTCOME');
  });
});

describe('U20CDF2 (G3 / owner invariant): a layer with a stored risk finding was processed and counts as completed', () => {
  it('the verifier probe F1: exists:true + count 0 gives a MEDIUM finding from the real rule engine -> the layer is CHECKED_HIT, never NOT_CHECKED', () => {
    const water = ev('water', { exists: true, match_count_observed: 0, max_features_per_layer: 50 });
    const unavailable = ['ebh', 'protected_area', 'natura2000', 'water_protection_area'].map((dataset) => ({ dataset, reason: 'SOURCE_UNAVAILABLE' }));
    // The fresh run never gets here (the gate rejects this evidence); a stored record can still hold it.
    expect(() => assertGovernedSpatialQueryOutcome({ evidence: [water], unavailable_layers: unavailable }, ['water', ...unavailable.map((u) => u.dataset)])).toThrow(/REJECT_SPATIAL_EVIDENCE_FORM/);
    const findings = new LURuleEngine().evaluate({ spatial_evidence: [water] as never, document_evidence: [], unavailable_layers: unavailable as never });
    expect(findings.find((f) => f.rule_id === 'LU-WATER-001')?.risk_level).toBe('MEDIUM');

    const checks = computeGovernedLayerChecks({
      requestedLayers: ['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area'],
      evidence: [water],
      unavailableLayers: [],
      findings,
    });
    expect(checks[0]).toEqual({
      layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT', evidence_artifact_id: water.artifact_id,
      // Counted as completed. U20CDF4 (owner decision 2026-10-03 (4) point 2): the evidence declares the
      // result contract and breaks it, so the row names that integrity error (was
      // FINDING_WITHOUT_CONSISTENT_EVIDENCE, a historical class); the stored risk is still a hit.
      reason: 'EVIDENCE_VIOLATES_RESULT_CONTRACT',
    });
    expect(checks.slice(1).map((c) => [c.status, c.reason])).toEqual(Array(4).fill(['NOT_CHECKED', 'NOT_CHECKED_FINDING']));
  });

  it.each<[string, readonly ReturnType<typeof ev>[], readonly { rule_id: string; risk_level: string }[]]>([
    ['a risk finding without any evidence for the layer', [], [{ rule_id: 'LU-EBH-001', risk_level: 'HIGH' }]],
    ['a risk finding next to negative evidence', [ev('ebh', { exists: false, match_count_observed: 0 })], [{ rule_id: 'LU-EBH-001', risk_level: 'HIGH' }]],
    ['a risk finding AND a NOT_CHECKED finding', [ev('ebh', { exists: true, match_count_observed: 1 })], [
      { rule_id: 'LU-EBH-001', risk_level: 'MEDIUM' }, { rule_id: 'LU-EBH-001', risk_level: 'NOT_CHECKED' },
    ]],
  ])('%s -> CHECKED_HIT / FINDING_WITHOUT_CONSISTENT_EVIDENCE', (_label, evidence, findings) => {
    const [check] = computeGovernedLayerChecks({ requestedLayers: ['ebh'], evidence, unavailableLayers: [], findings });
    expect(check).toMatchObject({ layer: 'ebh', status: 'CHECKED_HIT', reason: 'FINDING_WITHOUT_CONSISTENT_EVIDENCE' });
  });

  // U20CDF4 (owner decision 2026-10-03 (4) point 2): moved out of the case list above -- an
  // uninterpretable result that DECLARES the result contract breaks it (an integrity error); the layer
  // still counts as completed (the stored risk finding is a hit, never NOT_CHECKED).
  it('a risk finding next to a result that breaks the contract it declares -> CHECKED_HIT / EVIDENCE_VIOLATES_RESULT_CONTRACT', () => {
    const [check] = computeGovernedLayerChecks({
      requestedLayers: ['ebh'], evidence: [ev('ebh', { exists: 'yes' })], unavailableLayers: [], findings: [{ rule_id: 'LU-EBH-001', risk_level: 'LOW' }],
    });
    expect(check).toMatchObject({ layer: 'ebh', status: 'CHECKED_HIT', reason: 'EVIDENCE_VIOLATES_RESULT_CONTRACT' });
  });

  it('the consistent case keeps reason null; a NOT_CHECKED finding still wins over evidence when no risk finding exists', () => {
    const hit = ev('ebh', { exists: true, match_count_observed: 2 });
    expect(computeGovernedLayerChecks({ requestedLayers: ['ebh'], evidence: [hit], unavailableLayers: [], findings: [{ rule_id: 'LU-EBH-001', risk_level: 'HIGH' }] })).toEqual([
      { layer: 'ebh', rule_id: 'LU-EBH-001', status: 'CHECKED_HIT', evidence_artifact_id: hit.artifact_id, reason: null },
    ]);
    const negative = ev('ebh', { exists: false, match_count_observed: 0 });
    // U20CDF3 (low 4): the NOT_CHECKED finding still wins (never a no-hit), and the row now says that the
    // record ALSO holds evidence for the layer -- an invalid combination (RECORD_INTEGRITY_ERROR).
    expect(computeGovernedLayerChecks({ requestedLayers: ['ebh'], evidence: [negative], unavailableLayers: [], findings: [{ rule_id: 'LU-EBH-001', risk_level: 'NOT_CHECKED' }] })).toEqual([
      { layer: 'ebh', rule_id: 'LU-EBH-001', status: 'NOT_CHECKED', evidence_artifact_id: negative.artifact_id, reason: 'NOT_CHECKED_FINDING_WITH_EVIDENCE' },
    ]);
    expect(computeGovernedLayerChecks({ requestedLayers: ['ebh'], evidence: [], unavailableLayers: [], findings: [{ rule_id: 'LU-EBH-001', risk_level: 'NOT_CHECKED' }] })).toEqual([
      { layer: 'ebh', rule_id: 'LU-EBH-001', status: 'NOT_CHECKED', evidence_artifact_id: null, reason: 'NOT_CHECKED_FINDING' },
    ]);
  });
});
