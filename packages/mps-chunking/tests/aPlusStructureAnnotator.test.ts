import { describe, expect, it } from 'vitest';
import {
  A_STRUCTURE_ANNOTATION_VERSION,
  A_STRUCTURE_MARKER_VERSION,
  annotateAuthorityChunks,
  type AuthorityChunk,
} from '../src/text/APlusStructureAnnotator.js';

function chunksFrom(source: string, bodies: string[]): AuthorityChunk[] {
  return bodies.map((body, ordinal) => ({
    chunk_id: `a-${ordinal}`,
    ordinal,
    body,
    body_sha256: `frozen-${ordinal}`,
  }));
}

describe('A+STRUCTURE authority preservation', () => {
  it('preserves authority chunk bytes, objects and order', () => {
    const source = 'BAKGRUND\nBakgrundstext.\n\nVILLKOR\n1. Buller ska begränsas.\n2. Journal ska föras.';
    const authority = chunksFrom(source, [
      'BAKGRUND\nBakgrundstext.\n\nVILLKOR\n1. Buller ska begränsas.',
      '1. Buller ska begränsas.\n2. Journal ska föras.',
    ]);
    const before = JSON.stringify(authority);
    const result = annotateAuthorityChunks(source, 'decision', authority);

    expect(JSON.stringify(authority)).toBe(before);
    expect(result.map((item) => item.authority_chunk.body)).toEqual(authority.map((item) => item.body));
    expect(result.map((item) => item.authority_chunk.chunk_id)).toEqual(['a-0', 'a-1']);
    expect(result.every((item) => item.annotation_version === A_STRUCTURE_ANNOTATION_VERSION)).toBe(true);
    expect(result.every((item) => item.marker_version === A_STRUCTURE_MARKER_VERSION)).toBe(true);
  });

  it('keeps one authority body when a structural boundary crosses it', () => {
    const source = 'BAKGRUND\nSkäl här.\nVILLKOR\n1. Utsläpp ska begränsas.';
    const body = 'Skäl här.\nVILLKOR\n1. Utsläpp ska begränsas.';
    const [result] = annotateAuthorityChunks(source, 'decision', chunksFrom(source, [body]));

    expect(result?.authority_chunk.body).toBe(body);
    expect(result?.annotations.length).toBeGreaterThan(1);
    expect(result?.annotations.map((item) => item.section_role)).toContain('REASONING');
    expect(result?.annotations.map((item) => item.section_role)).toContain('REQUIREMENT_CONDITION');
    for (const annotation of result?.annotations ?? []) {
      expect(annotation.local_span.start).toBeGreaterThanOrEqual(0);
      expect(annotation.local_span.end).toBeLessThanOrEqual(body.length);
    }
  });
  it('promotes numbered blocks only below an operative heading', () => {
    const source = 'BAKGRUND\n1. Historik från 2020.\nVILLKOR\n1. Buller ska begränsas.';
    const [result] = annotateAuthorityChunks(source, 'decision', chunksFrom(source, [source]));
    const backgroundNumber = result?.annotations.find(
      (item) => item.section_role === 'REASONING' && item.paragraph_number !== null,
    );
    const requirementNumber = result?.annotations.find(
      (item) => item.section_role === 'REQUIREMENT_CONDITION' && item.paragraph_number === '1',
    );

    expect(backgroundNumber).toBeUndefined();
    expect(requirementNumber?.requirement_block_id).toBe('VILLKOR:1');
  });

  it('stops operative inheritance at an administrative heading', () => {
    const source = 'VILLKOR\n1. Buller ska begränsas.\nÖVERKLAGANDE\n1. Skrivelsen ska lämnas in.';
    const [result] = annotateAuthorityChunks(source, 'decision', chunksFrom(source, [source]));
    const admin = result?.annotations.filter((item) => item.section_role === 'ADMIN') ?? [];

    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((item) => item.requirement_block_id === null)).toBe(true);
  });
  it('is deterministic including repeated authority bodies', () => {
    const source = 'VILLKOR\n1. A ska göras.\n1. A ska göras.\n2. B ska göras.';
    const authority = chunksFrom(source, ['1. A ska göras.', '1. A ska göras.\n2. B ska göras.']);
    const first = annotateAuthorityChunks(source, 'decision', authority);
    const second = annotateAuthorityChunks(source, 'decision', authority);

    expect(second).toEqual(first);
    expect(first[0]?.source_span.start).toBeLessThan(first[1]?.source_span.start ?? 0);
  });

  it('binds authority bytes through whitespace-only source normalization', () => {
    const source = 'VILLKOR  \n \n\n  1.  Buller ska begränsas.  ';
    const body = 'VILLKOR \n1. Buller ska begränsas.';
    const [result] = annotateAuthorityChunks(source, 'decision', chunksFrom(source, [body]));

    expect(result?.authority_chunk.body).toBe(body);
    expect(result?.source_span.start).toBe(0);
    expect(result?.annotations.some((item) => item.section_role === 'REQUIREMENT_CONDITION')).toBe(true);
    expect(result?.annotations.every((item) => item.local_span.end <= body.length)).toBe(true);
  });

  it('recognizes frozen MKB headings as structural metadata without promoting legal effect', () => {
    const source = 'PLATSVAL\nAlternativ plats har utretts.\nBULLER\nBuller beskrivs här.';
    const [result] = annotateAuthorityChunks(source, 'mkb', chunksFrom(source, [source]));
    expect(result?.annotations.some((item) => item.heading_path[0] === 'LOKALISERINGSUTREDNING')).toBe(true);
    expect(result?.annotations.some((item) => item.heading_path[0] === 'BULLER_VIBRATIONER')).toBe(true);
    expect(
      result?.annotations.every(
        (item) =>
          item.section_role !== 'REQUIREMENT_CONDITION' &&
          item.section_role !== 'REQUIREMENT_PRECAUTION' &&
          item.section_role !== 'REQUIREMENT_CONTROL',
      ),
    ).toBe(true);
  });

  it('recognizes document-specific MKB headings without changing authority bytes', () => {
    const source =
      '1. LOKALISERINGSUTREDNING\nPlatsval beskrivet.\n2. NÄRBOENDE\nBuller beskrivet.\n3. VATTEN\nRecipient beskriven.';
    const [result] = annotateAuthorityChunks(source, 'mkb', chunksFrom(source, [source]));

    expect(result?.authority_chunk.body).toBe(source);
    expect(result?.annotations.map((item) => item.heading_path[0])).toEqual(
      expect.arrayContaining(['LOKALISERINGSUTREDNING', 'BULLER_VIBRATIONER', 'VATTENMILJO_UTSLAPP']),
    );
  });

  it('recognizes technical-description headings with whitespace-sensitive regexes intact', () => {
    const source = '1. PROCESSBESKRIVNING\nDrifttext.\n2. RENINGSTEKNIK\nFiltertext.';
    const [result] = annotateAuthorityChunks(source, 'technical_description', chunksFrom(source, [source]));

    expect(result?.authority_chunk.body).toBe(source);
    expect(result?.annotations.map((item) => item.heading_path[0])).toEqual(
      expect.arrayContaining(['PROCESSBESKRIVNING', 'RENINGSTEKNIK_FILTER']),
    );
  });

  it('fails closed when non-whitespace authority content cannot be located in source text', () => {
    const authority = chunksFrom('VILLKOR\n1. A ska göras.', ['text som inte finns']);
    expect(() => annotateAuthorityChunks('VILLKOR\n1. A ska göras.', 'decision', authority)).toThrow(
      /A_STRUCTURE_AUTHORITY_BODY_NOT_FOUND/,
    );
  });
});
