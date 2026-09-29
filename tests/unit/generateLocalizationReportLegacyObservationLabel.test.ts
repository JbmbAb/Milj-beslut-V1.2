/**
 * W3a -- SEM-2/SEM-3 labelling (Q2) + J-7/J-12 disclaimer.
 *
 * `restrictions`/`rules` from the legacy compliance engine (`evaluateComplianceRules`) pass
 * through the governed verdict merge unlabeled today -- see
 * generate-localization-report.usecase.ts:957-965. ADR-28A's SEM-2 requires the legacy engine's
 * output to be retained only as an "explicitly labelled observation layer", never presented as
 * equivalent to the governed verdict. `legacyObservationTag` is the pure, DB-independent function
 * that decides that label, exported (like `governedVerdictFromFindings` before it) specifically so
 * this claim can be proven without the full ExecutionKernel/Prisma pipeline.
 *
 * This also pins the exact J-7/J-12 disclaimer text as an owner decision (K-146 cold review + the
 * owner's own final wording), exported as `HUMAN_IN_THE_LOOP` for the same reason.
 */
import { describe, expect, it } from 'vitest';
import {
  legacyObservationTag,
  HUMAN_IN_THE_LOOP,
} from '../../src/application/generate-localization-report.usecase';
import type { SiteAnalysis } from '../../src/application/evaluate-compliance-rules.usecase';

function siteAnalysis(overrides: Partial<SiteAnalysis> = {}): SiteAnalysis {
  return {
    overallRisk: 'LOW',
    permitProbability: 0.95,
    restrictions: [],
    rules: [],
    summary: 'fixture',
    ...overrides,
  };
}

describe('W3a: legacyObservationTag labels the legacy engine\'s own output (SEM-2/Q2)', () => {
  it('tags the site when restrictions is non-empty', () => {
    const tag = legacyObservationTag(siteAnalysis({ restrictions: ['Naturreservat'] }));
    expect(tag.legacyObservation).toEqual({ source: 'legacy_observation', version: 'v1' });
  });

  it('tags the site when rules is non-empty, even if restrictions is empty', () => {
    const tag = legacyObservationTag(
      siteAnalysis({
        rules: [
          {
            ruleId: 'MB-2-3',
            chapter: 'MB 2:3',
            title: 'Försiktighetsprincipen',
            risk: 'MEDIUM',
            description: 'x',
            recommendation: 'y',
          },
        ],
      }),
    );
    expect(tag.legacyObservation).toEqual({ source: 'legacy_observation', version: 'v1' });
  });

  it('does not tag a site with no legacy restrictions or rules at all', () => {
    const tag = legacyObservationTag(siteAnalysis());
    expect(tag.legacyObservation).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(tag, 'legacyObservation')).toBe(false);
  });
});

describe('W3a: HUMAN_IN_THE_LOOP pins the owner-decided J-7/J-12 disclaimer text', () => {
  it('states Mimer is decision support and does not make the formal (myndighets) decision', () => {
    expect(HUMAN_IN_THE_LOOP).toContain('Mimer är ett beslutsstödsystem och fattar inte myndighetsbeslut');
  });

  it('states a named, authorized handläggare reviews and makes/justifies/issues the formal decision', () => {
    expect(HUMAN_IN_THE_LOOP).toContain('En behörig handläggare ansvarar för att granska underlaget');
    expect(HUMAN_IN_THE_LOOP).toContain('fatta, motivera och expediera det formella beslutet');
  });
});
