/**
 * W-TEXT2 (LU 72h server text unit, 2026-10-03) -- the Swedish texts the server writes for a user on the LU error
 * surface carry no internal terms: no "CAS", no machine code in parentheses, no artifact id. This covers the
 * orchestrator's read-fault answers (assessmentResolutionFailure, currentAssessmentCandidateIntegrityFault,
 * assessmentArtifactReadFailure), the bootstrap gate's binding-fault texts, the two 424 integrity answers
 * (ASSESSMENT_RECORD_INTEGRITY_ERROR, GOVERNED_EVIDENCE_INTEGRITY_FAILED) and the fresh run's integrity warning
 * (U6-3). The machine values stay in their own fields (code, failureClass, reasonCode, record_integrity.basis_codes,
 * executionMotor.assessment_artifact_id), which the UI shows only under "Teknisk information".
 *
 * TEXT ONLY: the codes, classes, statuses and retry flags these answers carry are unchanged -- the behavioural
 * suites pin the rendered sentences and the fields (luAssessmentProjectionCasFaultChainAPR, luGovernedEvidenceDetailsU20D,
 * luRecordIntegrityFailClosedU20CDF4, luPinnedEvidenceReadFaultU20CDF5, luFreshRunU20CDF4, the two BOOT suites).
 * Pure: no database, no CAS root, no network.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectContextBootstrapBindingUnresolvedError } from '../../server/modules/localization/projectContextBootstrapBindingGate';

/** The same internal-term pattern as luServerTextsInternalTermsUI1: CAS as a word, a code in parentheses, a bare machine code. */
const INTERNAL = /\bCAS\b|\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?::[^)]*)?\)|[A-Z]{3,}_[A-Z0-9_]{3,}/;
const REASONS = ['READ_ERROR', 'STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS', 'REFUSED', 'BINDING_INDEX_INCONSISTENT'] as const;
const source = (relative: string) => readFileSync(path.resolve(__dirname, '../../', relative), 'utf8');

describe("W-TEXT2: the bootstrap gate's binding-fault texts (the bootstrap-status API shows them)", () => {
  it.each(REASONS)('%s: no internal terms; the class stays in reason and failureCode', (reason) => {
    const error = new ProjectContextBootstrapBindingUnresolvedError(reason, null, new Error('cause'));
    expect(error.reason).toBe(reason);
    expect(error.message.startsWith('Projektkontexten kunde inte etableras: ')).toBe(true);
    expect(error.message).not.toMatch(INTERNAL);
    expect(error.message).toContain(error.retryable ? 'Ett nytt försök kan lyckas.' : 'Felet är bestående och löses inte av ett nytt försök.');
  });

  it('a lasting storage or integrity fault behind the binding says "ur arkivet", never CAS', () => {
    for (const reason of ['STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS'] as const) {
      const error = new ProjectContextBootstrapBindingUnresolvedError(reason, null, null);
      expect(error.retryable).toBe(false);
      expect(error.failureCode).toBe('CURRENT_BINDING_INTEGRITY_FAULT');
      expect(error.message).toContain(
        'projektets befintliga bindning kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
      );
    }
  });
});

describe('W-TEXT2: drift guard -- the server sources build no user text with "ur CAS", a code in parentheses or the assessment id', () => {
  // The orchestrator's and the use case's texts are built inside private functions; the behavioural suites named in
  // the header pin the rendered sentences. This guards the templates themselves against the old forms coming back.
  it.each([
    'server/modules/localization/localizationOrchestrator.ts',
    'server/modules/localization/projectContextBootstrapBindingGate.ts',
    'src/application/generate-localization-report.usecase.ts',
  ])('%s', (file) => {
    const text = source(file);
    expect(text).not.toMatch(/ur CAS\b/);
    expect(text).not.toContain('(RECORD_INTEGRITY_ERROR: ${');
    expect(text).not.toContain('(${integrity.failureClass}: ');
    expect(text).not.toContain('formatet (RECORD_INTEGRITY_ERROR).');
    expect(text).not.toContain('sparade (${assessment_artifact_id})');
  });
});
