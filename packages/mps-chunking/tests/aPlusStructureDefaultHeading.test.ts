import { describe, expect, it } from 'vitest';
import { annotateAuthorityChunks, type AuthorityChunk } from '../src/text/APlusStructureAnnotator.js';

const chunk = (body: string): AuthorityChunk => ({ chunk_id: 'a-0', ordinal: 0, body, body_sha256: 'frozen' });

describe('A+STRUCTURE control-program default heading', () => {
  it('does not alias an unobserved default to the real EGENKONTROLL marker', () => {
    const plain = 'Kontroll ska ske varje månad.';
    const [defaultResult] = annotateAuthorityChunks(plain, 'control_program', [chunk(plain)]);
    expect(defaultResult?.annotations.every((a) => a.heading_path[0] === 'GENERAL')).toBe(true);

    const headed = 'EGENKONTROLL\nKontroll ska ske varje månad.';
    const [headingResult] = annotateAuthorityChunks(headed, 'control_program', [chunk(headed)]);
    expect(headingResult?.annotations.some((a) => a.heading_path[0] === 'EGENKONTROLL')).toBe(true);
    expect(headingResult?.annotations.some((a) => a.heading_path[0] === 'EGENKONTROLL' && a.section_role === 'REQUIREMENT_CONTROL')).toBe(true);
  });
});
