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
    const check = computeGovernedDocumentCheck(refs, { unreadableArtifactIds: ['doc-evidence-1', 'doc-fact-1'] });
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
