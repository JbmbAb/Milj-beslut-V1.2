import { describe, expect, it } from 'vitest';
import { computeChunkSetContentHash, isCanonicallyOrdered } from '@miljobeslut/mps-legal-corpus';
import {
  admitChunks,
  admitCourtChunks,
  admitLawChunks,
  admitLawChunksV24,
  admitStandardChunks,
} from '../../server/modules/legal/materialization/ChunkAdmission';

const REF = 'sha256:test-projection';
const POLICY = 'legal-chunker-v2.3';

describe('LEGAL-CHUNK-ADMISSION-V1', () => {
  describe('law', () => {
    it('admits verified chapter/paragraph structure, never fabricating "chapter 0 / paragraph 0" — and a chapter heading before the first § is honestly reflected as STRUCTURE_PARTIAL, not a blanket pass or fail', () => {
      // A chapter heading ("2 kap. Allmänna...") always precedes the chapter's first § in real
      // SFS text, and that heading fragment genuinely has no paragraph of its own -- so a
      // realistic law document with any chapter heading is STRUCTURE_PARTIAL, not pure ADMITTED.
      // Forcing a "zero rejected" case here would misrepresent how this actually behaves.
      const text =
        '2 kap. Allmänna bestämmelser om denna rubrik som föregår första paragrafen i kapitlet.\n' +
        '1 § Detta är text för första paragrafens innehåll, tillräckligt lång för att bli en chunk.\n' +
        '2 § Detta är text för andra paragrafens innehåll, också tillräckligt lång för att räknas.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('STRUCTURE_PARTIAL');
      expect(result.admitted.length).toBeGreaterThan(0);
      expect(result.rejected.length).toBeGreaterThan(0);
      for (const chunk of result.admitted) {
        expect(chunk.structure_kind).toBe('law');
        if (chunk.structure_kind === 'law') {
          expect(chunk.chapter).not.toBe('0');
          expect(chunk.paragraph).not.toBe('0');
          expect(chunk.chapter).toBe('2');
        }
      }
    });

    it('a flat law with no chapter heading at all admits with zero rejections (a realistic pure-ADMITTED case)', () => {
      const text =
        '1 § Första paragrafens innehåll, tillräckligt lång text för att bli en egen chunk.\n' +
        '2 § Andra paragrafens innehåll, också tillräckligt lång text för att bli en egen chunk.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('ADMITTED');
      expect(result.admitted.length).toBeGreaterThan(0);
      expect(result.rejected).toHaveLength(0);
      for (const chunk of result.admitted) {
        if (chunk.structure_kind === 'law') expect(chunk.paragraph).toBeTruthy();
      }
    });

    it('a document with zero § markers is NOT_ADMITTED_TO_PARAGRAPH_CORPUS, not silently chapter-1/paragraph-1', () => {
      const text = 'Detta är löptext utan några paragrafmarkeringar alls, bara vanlig prosa som beskriver något.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('NOT_ADMITTED_TO_PARAGRAPH_CORPUS');
      expect(result.admitted).toHaveLength(0);
      expect(result.rejected[0]?.reason).toContain('NOT_ADMITTED_TO_PARAGRAPH_CORPUS');
    });

    it('a flat law with real § markers but no "kap." heading gets an honest "no chapter division" marker, not a fabricated "1"', () => {
      const text =
        '1 § Första bestämmelsen i denna författning, med tillräckligt lång text för en chunk.\n' +
        '2 § Andra bestämmelsen i denna författning, också med tillräckligt lång text.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('ADMITTED');
      for (const chunk of result.admitted) {
        if (chunk.structure_kind === 'law') {
          expect(chunk.chapter).toBe('(ingen kapitelindelning)');
          expect(chunk.chapter).not.toBe('1');
        }
      }
    });

    it('KNOWN LIMITATION (upstream chunkSwedishLaw, not fixed here): a letter-suffixed chapter ("2 a kap.") is not detected as a chapter division at all — falls through to the honest "no chapter division" marker rather than a wrong chapter number', () => {
      const text = '2 a kap. 5 § Text för paragrafen, tillräckligt lång för att räknas som en egen chunk.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      const first = result.admitted[0];
      expect(first?.structure_kind).toBe('law');
      if (first?.structure_kind === 'law') {
        // Not "2", not "2 a" -- chunkSwedishLaw's own chapterRegex does not match this pattern,
        // so no chapter division was verified. Honest, not silently wrong.
        expect(first.chapter).toBe('(ingen kapitelindelning)');
      }
    });

    it('REGRESSION (found via the real Part G Miljöbalken pilot): output is always in canonical order, even when a chapter/paragraph reference inside a paragraph body confuses chunkSwedishLaw\'s own boundary detection into emitting fragments out of document order', () => {
      // "se 10 kap. 32 §" inside chapter 7's body is exactly the shape that tripped
      // chunkSwedishLaw's regex-based boundary detection on the real statute text -- a
      // cross-reference read as if it were a new chapter/paragraph heading.
      const text =
        '7 kap. 2 § Text i kapitel sju, med en hänvisning se 10 kap. 32 § för mer information om ' +
        'ytterligare bestämmelser som gäller i det sammanhanget.\n' +
        '7 kap. 3 § Ytterligare text i kapitel sju som följer efter hänvisningen till kapitel tio.';
      const result = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(isCanonicallyOrdered(result.admitted)).toBe(true);
      expect(() => computeChunkSetContentHash(result.admitted)).not.toThrow();
    });
  });

  describe('law v2.4 (LEGAL-CHUNKING-LAW-V2.4)', () => {
    it('detects a letter-suffixed chapter ("2 a kap.") correctly, unlike v2.3\'s NO_CHAPTER_DIVISION fallback for the same text', () => {
      const text = '2 a kap. 5 § Text för paragrafen, tillräckligt lång för att räknas som en egen chunk.';
      const result = admitLawChunksV24({ text, sourceProjectionRef: REF, chunkPolicyVersion: 'legal-chunker-v2.4' });

      const first = result.admitted[0];
      expect(first?.structure_kind).toBe('law');
      if (first?.structure_kind === 'law') {
        expect(first.chapter).toBe('2 a');
      }
    });

    it('does not admit a cross-reference ("se 10 kap. 32 §") inside a paragraph body as its own chapter/paragraph fragment', () => {
      const text =
        '7 kap. 2 § Text i kapitel sju, med en hänvisning se 10 kap. 32 § för mer information om ' +
        'ytterligare bestämmelser som gäller i det sammanhanget.\n' +
        '7 kap. 3 § Ytterligare text i kapitel sju som följer efter hänvisningen till kapitel tio.';
      const result = admitLawChunksV24({ text, sourceProjectionRef: REF, chunkPolicyVersion: 'legal-chunker-v2.4' });

      expect(result.admitted.some((c) => c.structure_kind === 'law' && c.chapter === '10' && c.paragraph === '32')).toBe(false);
      expect(isCanonicallyOrdered(result.admitted)).toBe(true);
      expect(() => computeChunkSetContentHash(result.admitted)).not.toThrow();
    });

    it('produces a distinct fragment_id from the v2.3 admission of the same underlying text, because chunk_policy_version is identity-bearing', () => {
      const text = '1 § Text för första paragrafen, tillräckligt lång för att räknas som en egen chunk.';
      const v23 = admitLawChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: 'legal-chunker-v2.3' });
      const v24 = admitLawChunksV24({ text, sourceProjectionRef: REF, chunkPolicyVersion: 'legal-chunker-v2.4' });

      expect(v23.admitted[0]?.fragment_id).not.toBe(v24.admitted[0]?.fragment_id);
    });
  });

  describe('court', () => {
    it('is never rejected for lacking law (chapter/paragraph) structure', () => {
      const text =
        'BAKGRUND\nNågon bakgrundstext som beskriver ärendets tidigare handläggning i tillräcklig längd.\n\n' +
        'DOMSLUT\nMark- och miljööverdomstolen beslutar följande i detta mål, med tillräckligt lång text.';
      const result = admitCourtChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('ADMITTED');
      expect(result.admitted.length).toBeGreaterThan(0);
      for (const chunk of result.admitted) {
        expect(chunk.structure_kind).toBe('court');
        expect('chapter' in chunk).toBe(false);
        expect('paragraph' in chunk).toBe(false);
      }
    });
  });

  describe('standard', () => {
    it('is never rejected for lacking law structure and fabricates no anchor', () => {
      const text =
        'Första stycket med vägledningstext som är tillräckligt långt för att bli en egen chunk.\n\n' +
        'Andra stycket med ytterligare vägledningstext som också är tillräckligt långt för en chunk.';
      const result = admitStandardChunks({ text, sourceProjectionRef: REF, chunkPolicyVersion: POLICY });

      expect(result.document_status).toBe('ADMITTED');
      expect(result.admitted.length).toBeGreaterThan(0);
      for (const chunk of result.admitted) {
        expect(chunk.structure_kind).toBe('standard');
        expect('chapter' in chunk).toBe(false);
        expect('court_section' in chunk).toBe(false);
      }
    });
  });

  describe('admitChunks dispatcher', () => {
    it('routes to the correct family-specific admitter', () => {
      const lawResult = admitChunks({
        structureKind: 'law',
        text: '1 kap. 1 § Text som är tillräckligt lång för att bli en egen chunk i testet.',
        sourceProjectionRef: REF,
        chunkPolicyVersion: POLICY,
      });
      expect(lawResult.admitted[0]?.structure_kind).toBe('law');

      const courtResult = admitChunks({
        structureKind: 'court',
        text: 'DOMSLUT\nText som är tillräckligt lång för att bli en egen chunk i testet av domstolsavgörandet.',
        sourceProjectionRef: REF,
        chunkPolicyVersion: POLICY,
      });
      expect(courtResult.admitted[0]?.structure_kind).toBe('court');
    });
  });
});
