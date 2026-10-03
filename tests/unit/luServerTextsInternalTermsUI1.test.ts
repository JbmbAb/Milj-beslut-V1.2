/**
 * W-UI1 (C; owner decision 5, 2026-10-03) -- no internal terms in the Swedish texts the server writes for a
 * user (governedLayerChecks.ts, governedEvidenceDetails.ts): no "CAS", no machine code in parentheses, no
 * artifact-type code, no "(hash/id/typ)", no "replay". The machine values stay in their own fields
 * (technical_error_class, integrity, artifact_type), which the UI shows only under "Teknisk information".
 * TEXT ONLY: the states, classes and fields these tests also read are unchanged.
 * Pure: an in-memory repository, no database, no CAS root, no network.
 */
import { describe, expect, it } from 'vitest';
import { computeGovernedDocumentCheck } from '../../server/modules/localization/governedLayerChecks';
import { resolveGovernedAssessmentDetails } from '../../server/modules/localization/governedEvidenceDetails';
import { governedOverallStatementSv } from '../../server/modules/localization/governedCoverageStatement';

const INTERNAL = /\bCAS\b|\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?::[^)]*)?\)|hash\/id\/typ|replay|[A-Z]{3,}_[A-Z0-9_]{3,}/;

class CASIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CASIntegrityError';
  }
}

/** A repository that answers each ref as the test says: an object, the frozen not-found, a read error, a corrupt read. */
function repo(answers: Record<string, unknown | 'not_found' | 'read_error' | 'corrupted'>) {
  return {
    resolve: async <T>(ref: { artifact_id: string; artifact_type: string }): Promise<T> => {
      const answer = answers[ref.artifact_id];
      if (answer === 'not_found' || answer === undefined) throw new Error(`Artifact not found: ${ref.artifact_id}`);
      if (answer === 'read_error') throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      if (answer === 'corrupted') throw new CASIntegrityError('content hash mismatch');
      return answer as T;
    },
  } as never;
}

const assessment = (refs: Array<{ artifact_id: string; artifact_type: string }>) => ({ payload: { evidence_refs: refs, findings: [] } }) as never;

describe('W-UI1 C: the server\'s user texts carry no internal terms -- the machine values stay in their fields', () => {
  it('the document check over unreadable pinned documents says "arkivet", not CAS', () => {
    const refs = [
      { artifact_id: 'doc-evidence-1', artifact_type: 'DOCUMENT_EVIDENCE' },
      { artifact_id: 'doc-fact-1', artifact_type: 'VERIFIED_DOCUMENT_FACT' },
    ];
    // W-U20CDF6 (OD-K0-3): the document check now also reads the record's findings (required); none here.
    const check = computeGovernedDocumentCheck(refs, { findings: [], unreadableArtifactIds: ['doc-evidence-1', 'doc-fact-1'] });
    expect(check.reason).toBe('PINNED_EVIDENCE_UNREADABLE');
    expect(check.message_sv).toMatch(/^Dokument och tidigare beslut: tekniskt fel\./);
    expect(check.message_sv).toContain('kunde inte läsas ur arkivet');
    expect(check.message_sv).not.toMatch(INTERNAL);
  });

  it('an evidence that could not be read, was not found or was corrupt: a plain sentence; the class stays in technical_error_class', async () => {
    const details = await resolveGovernedAssessmentDetails({
      assessment: assessment([
        { artifact_id: 'e-missing', artifact_type: 'SPATIAL_EVIDENCE' },
        { artifact_id: 'e-eio', artifact_type: 'SPATIAL_EVIDENCE' },
        { artifact_id: 'e-corrupt', artifact_type: 'SPATIAL_EVIDENCE' },
      ]),
      artifactRepository: repo({ 'e-missing': 'not_found', 'e-eio': 'read_error', 'e-corrupt': 'corrupted' }),
    });
    const byId = new Map(details.evidenceDetails.map((d) => [d.evidence_artifact_id, d]));
    expect(byId.get('e-missing')!.technical_error_class).toBe('EVIDENCE_NOT_FOUND');
    expect(byId.get('e-missing')!.message_sv).toBe('Tekniskt fel: evidensen hittades inte i arkivet.');
    expect(byId.get('e-eio')!.technical_error_class).toBe('EVIDENCE_READ_ERROR');
    expect(byId.get('e-eio')!.message_sv).toBe('Tekniskt fel: evidensen kunde inte läsas ur arkivet (läsfel).');
    expect(byId.get('e-corrupt')!.technical_error_class).toBe('EVIDENCE_CORRUPTED');
    expect(byId.get('e-corrupt')!.message_sv).toBe('Tekniskt fel: evidensens lagrade innehåll stämmer inte med sin innehållskontroll.');
    for (const d of details.evidenceDetails) {
      expect(d.message_sv, d.evidence_artifact_id).not.toMatch(INTERNAL);
      expect(d.binding_note_sv, d.evidence_artifact_id).not.toMatch(INTERNAL);
    }
  });

  it('a tampered evidence, an evidence type this view does not read and a document evidence: no codes, no "(hash/id/typ)", no "replay"', async () => {
    const details = await resolveGovernedAssessmentDetails({
      assessment: assessment([
        { artifact_id: 'e-tampered', artifact_type: 'SPATIAL_EVIDENCE' },
        { artifact_id: 'x-other', artifact_type: 'SOME_FUTURE_EVIDENCE' },
        { artifact_id: 'doc-1', artifact_type: 'DOCUMENT_EVIDENCE' },
      ]),
      artifactRepository: repo({
        // Another object under the id: an integrity verdict (TAMPERED).
        'e-tampered': { artifact_id: 'e-someone-else', artifact_type: 'SPATIAL_EVIDENCE', content_hash: { algorithm: 'sha256', value: 'x' }, payload: {} },
        'x-other': { artifact_id: 'x-other', artifact_type: 'SOME_FUTURE_EVIDENCE', content_hash: { value: 'h' } },
        'doc-1': { artifact_id: 'doc-1', artifact_type: 'DOCUMENT_EVIDENCE', content_hash: { algorithm: 'sha256', value: 'abc' }, payload: {} },
      }),
    });
    const byId = new Map(details.evidenceDetails.map((d) => [d.evidence_artifact_id, d]));
    expect(byId.get('e-tampered')!.integrity).toBe('TAMPERED');
    expect(byId.get('e-tampered')!.message_sv).toBe('Integritetsfel: den lagrade evidensen stämmer inte med sin egen identitet (innehåll, id eller typ).');
    expect(byId.get('x-other')!.integrity).toBe('NOT_INTERPRETED');
    expect(byId.get('x-other')!.artifact_type).toBe('SOME_FUTURE_EVIDENCE');
    expect(byId.get('x-other')!.message_sv).toBe('En evidenstyp som denna vy inte tolkar redovisas inte här.');
    // Verify checks consistency, never authenticity: no "fullständig", no "verifiering" of the document.
    expect(byId.get('doc-1')!.binding_note_sv).toBe(
      'Dokumentevidensen kontrolleras här bara strukturellt (typ, id och innehållskontroll finns). ' +
        'Reproducerbarhetskontrollen prövar konsistensen mot de pinnade artefakterna, inte äktheten.',
    );
    expect(byId.get('doc-1')!.binding_note_sv).not.toMatch(/fullständig|verifiering|innehållshash/i);
    for (const d of details.evidenceDetails) {
      expect(d.message_sv, d.evidence_artifact_id).not.toMatch(INTERNAL);
      expect(d.binding_note_sv, d.evidence_artifact_id).not.toMatch(INTERNAL);
    }
  });
});

/**
 * W-U20CDF6 (UI1-DEFERRED-C, prepared by W-UI1 and taken in by the owner of the server surface): the three texts W-UI1
 * could not change because tests it did not own quoted them -- the overall line over unreadable pinned evidence, the
 * unreadable layer row and the property root that could not be read. Same rule: no "CAS", no code in parentheses; the
 * class stays in its field (pinned_evidence.technical_error_class, technical_error_class). The PDF prints these texts.
 */
describe('W-U20CDF6 (UI1-DEFERRED-C): the coverage line, the unreadable layer row and the property root carry no internal terms either', () => {
  it('the overall line over unreadable pinned evidence says "ur arkivet" and (hittades inte) / (läsfel) -- the class stays in pinned_evidence', () => {
    const rows = [{ layer: 'water', rule_id: 'LU-WATER-001', status: 'NOT_CHECKED', evidence_artifact_id: 'e1', reason: 'PINNED_EVIDENCE_UNREADABLE' }];
    const line = (technical_error_class: 'EVIDENCE_NOT_FOUND' | 'EVIDENCE_READ_ERROR' | null, retryable: boolean | null) =>
      governedOverallStatementSv('LOW', rows, {
        findings: [],
        pinnedEvidence: { pinned_total: 5, unreadable_artifact_ids: ['e1'], technical_error_class, retryable },
      });
    expect(line('EVIDENCE_NOT_FOUND', false)).toBe(
      'Den pinnade evidensen kan inte verifieras: 1 av 5 bundna evidensobjekt kunde inte läsas ur arkivet (hittades inte). ' +
        'Felet är bestående och löses inte av ett nytt försök. Täckningsgrad och samlad risknivå kan därför inte fastställas.',
    );
    expect(line('EVIDENCE_READ_ERROR', true)).toBe(
      'Den pinnade evidensen kan inte verifieras: 1 av 5 bundna evidensobjekt kunde inte läsas ur arkivet (läsfel). ' +
        'Ett nytt försök kan lyckas. Täckningsgrad och samlad risknivå kan därför inte fastställas.',
    );
    expect(line(null, null)).toBe(
      'Den pinnade evidensen kan inte verifieras: 1 av 5 bundna evidensobjekt kunde inte läsas ur arkivet. ' +
        'Täckningsgrad och samlad risknivå kan därför inte fastställas.',
    );
    for (const text of [line('EVIDENCE_NOT_FOUND', false), line('EVIDENCE_READ_ERROR', true), line(null, null)]) expect(text).not.toMatch(INTERNAL);
  });

  it('the layer row whose pinned evidence could not be read says "ur arkivet"; the class stays in the evidence detail', async () => {
    const details = await resolveGovernedAssessmentDetails({
      assessment: assessment([{ artifact_id: 'e-lost', artifact_type: 'SPATIAL_EVIDENCE' }]),
      artifactRepository: repo({ 'e-lost': 'not_found' }),
    });
    const water = details.governedLayerChecks.find((row) => row.layer === 'water')!;
    expect(water).toMatchObject({ reason: 'PINNED_EVIDENCE_UNREADABLE', coverage_state: 'TECHNICAL_ERROR' });
    expect(water.message_sv).toBe('Tekniskt fel: den pinnade evidensen för Brunnar kunde inte läsas ur arkivet och kan inte verifieras. Ingen slutsats om lagret.');
    for (const row of details.governedLayerChecks) expect(row.message_sv, row.layer).not.toMatch(INTERNAL);
    expect(details.evidenceDetails[0]!.technical_error_class).toBe('EVIDENCE_NOT_FOUND');
  });

  // W-GAP1 (F2, owner decision Round 15-16): the "not found" case used to be ROOT_ARTIFACT_NOT_FOUND "finns inte i arkivet"
  // (an absence claim); a well-formed root ref the CAS does not hold is a LOST referenced artifact (ROOT_MISSING_FROM_CAS)
  // and its text claims no absence.
  it('the property root that could not be read: "just nu (läsfel)" for a read error, "kunde inte läsas eller verifieras ur arkivet" for a root the CAS does not hold -- the class stays in technical_error_class', async () => {
    const root = async (answer: 'read_error' | 'not_found') =>
      (
        await resolveGovernedAssessmentDetails({
          assessment: { payload: { evidence_refs: [], findings: [], property_ref: { artifact_id: 'prop-1', artifact_type: 'LU_PROPERTY_CONTEXT' } } } as never,
          artifactRepository: repo({ 'prop-1': answer }),
        })
      ).propertyRoot;
    const readError = await root('read_error');
    expect(readError).toMatchObject({ status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_READ_ERROR' });
    expect(readError.message_sv).toBe('Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas just nu (läsfel).');
    const notFound = await root('not_found');
    expect(notFound).toMatchObject({ status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_MISSING_FROM_CAS' });
    expect(notFound.message_sv).toBe(
      'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas eller verifieras ur arkivet (bestående lagrings- eller integritetsfel).',
    );
    // Neither a read error nor a lost root claims an absence; neither text names its class or the id.
    for (const text of [readError.message_sv, notFound.message_sv]) {
      expect(text).not.toMatch(/finns inte|bevisat saknad|prop-1/);
      expect(text).not.toMatch(INTERNAL);
    }
  });
});
