export const A_STRUCTURE_ANNOTATION_VERSION = 'a-structure-annotations-v1' as const;
export const A_STRUCTURE_MARKER_VERSION = 'evidence-markers-v2.4-frozen' as const;

export type AStructureRole =
  | 'DECISION_BLOCK'
  | 'REQUIREMENT_CONDITION'
  | 'REQUIREMENT_PRECAUTION'
  | 'REQUIREMENT_CONTROL'
  | 'REASONING'
  | 'ADMIN'
  | 'GENERAL';

export interface AuthorityChunk {
  readonly chunk_id: string;
  readonly ordinal: number;
  readonly body: string;
  readonly [key: string]: unknown;
}

export interface AStructureSpanAnnotation {
  readonly source_span: { readonly start: number; readonly end: number };
  readonly local_span: { readonly start: number; readonly end: number };
  readonly section_role: AStructureRole;
  readonly heading_path: readonly string[];
  readonly paragraph_number: string | null;
  readonly requirement_block_id: string | null;
}
export interface AStructureAnnotatedChunk<T extends AuthorityChunk = AuthorityChunk> {
  readonly authority_chunk: T;
  readonly document_type: string;
  readonly section_role: AStructureRole;
  readonly heading_path: readonly string[];
  readonly paragraph_number: string | null;
  readonly requirement_block_id: string | null;
  readonly source_span: { readonly start: number; readonly end: number };
  readonly annotations: readonly AStructureSpanAnnotation[];
  readonly annotation_version: typeof A_STRUCTURE_ANNOTATION_VERSION;
  readonly marker_version: typeof A_STRUCTURE_MARKER_VERSION;
}

type Marker = {
  readonly name: string;
  readonly role: AStructureRole;
  readonly negative?: boolean;
  readonly regex: RegExp;
};

const MARKERS: readonly Marker[] = [
  {
    name: 'BESLUT_OM_FORSIKTIGHETSMATT',
    role: 'REQUIREMENT_PRECAUTION',
    regex:
      /^(?:F[ÖO]RSLAG\s+(?:P[ÅA]|TILL)\s+)?BESLUT(?:\s+(?:OM|P[ÅA]))?\s+F[ÖO]RSIKTIGHETSM[ÅA]TT\s*[:.=-]*\s*$/i,
  },
  {
    name: 'VILLKOR',
    role: 'REQUIREMENT_CONDITION',
    regex: /^(?:\d+[.)]?\s*)?VILLKOR(?:\s+OCH\s+F[ÖO]RSIKTIGHETSM[ÅA]TT)?\s*$/i,
  },
  {
    name: 'FORSIKTIGHETSMATT',
    role: 'REQUIREMENT_PRECAUTION',
    regex: /^(?:\d+[.)]?\s*)?(?:F[ÖO]RSLAG\s+TILL\s+)?F[ÖO]RSIKTIGHETSM[ÅA]TT\s*[:.=-]*\s*$/i,
  },
  {
    name: 'SKYDDSATGARDER',
    role: 'REQUIREMENT_PRECAUTION',
    regex:
      /^(?:\d+[.)]?\s*)?(?:F[ÖO]RSLAG\s+TILL\s+)?SKYDDS[ÅA]TG[ÄA]RDER(?:\s+OCH\s+F[ÖO]RSIKTIGHETSM[ÅA]TT)?\s*[:.=-]*\s*$/i,
  },
  {
    name: 'KONTROLL_OCH_BEREDSKAP',
    role: 'REQUIREMENT_CONTROL',
    regex: /^(?:\d+[.)]?\s*)?KONTROLL\s+OCH\s+BEREDSKAP\s*$/i,
  },
  {
    name: 'OVERVAKNING_KONTROLL',
    role: 'REQUIREMENT_CONTROL',
    regex: /^(?:\d+[.)]?\s*)?F[ÖO]RSLAG\s+(?:TILL\s+)?[ÖO]VERVAKNING\s+OCH\s+KONTROLL\s*[:.=-]*\s*$/i,
  },
  { name: 'KONTROLLPROGRAM', role: 'REQUIREMENT_CONTROL', regex: /^(?:\d+[.)]?\s*)?KONTROLLPROGRAM\s*$/i },
  {
    name: 'EGENKONTROLL',
    role: 'REQUIREMENT_CONTROL',
    regex: /^(?:\d+[.)]?\s*)?(?:BESKRIVNING\s+AV\s+)?EGENKONTROLL\s*[:.=-]*\s*$/i,
  },
  { name: 'PROVTAGNING', role: 'REQUIREMENT_CONTROL', regex: /^(?:\d+[.)]?\s*)?PROVTAGNING\s*$/i },
  { name: 'MATNING', role: 'REQUIREMENT_CONTROL', regex: /^(?:\d+[.)]?\s*)?M[ÄA]TNING\s*$/i },
  {
    name: 'DAGVATTEN',
    role: 'REQUIREMENT_CONTROL',
    regex: /^(?:\d+[.)]?\s*)?DAGVATTEN(?:HANTERING)?\s*[:.=-]*\s*$/i,
  },
  {
    name: 'UTSLAPP_TILL_VATTEN',
    role: 'REQUIREMENT_CONTROL',
    regex: /^(?:\d+[.)]?\s*)?UTSL[ÄA]PP\s+TILL\s+VATTEN\s*$/i,
  },
  { name: 'RAPPORTERING', role: 'REQUIREMENT_CONTROL', regex: /^(?:\d+[.)]?\s*)?RAPPORTERING\s*$/i },
  { name: 'DRIFTSTORNINGAR', role: 'REQUIREMENT_CONTROL', regex: /^(?:\d+[.)]?\s*)?DRIFTST[ÖO]RNINGAR\s*$/i },
  {
    name: 'KOMPLETTERING',
    role: 'REQUIREMENT_CONDITION',
    regex: /^(?:\d+[.)]?\s*)?KOMPLETTERING(?:AR)?\s*$/i,
  },
  {
    name: 'DOMSLUT_BESLUT',
    role: 'DECISION_BLOCK',
    regex:
      /^(?:\d+[.)]?\s*)?(?:F[ÖO]RSLAG\s+(?:P[ÅA]|TILL)\s+)?(?:BESLUTETS\s+INNEB[ÖO]RD|DOMSLUT|BESLUT)\s*[:.=-]*\s*$/i,
  },
  { name: 'BAKGRUND', role: 'REASONING', negative: true, regex: /^(?:\d+[.)]?\s*)?BAKGRUND\s*$/i },
  { name: 'LAGSTOD', role: 'REASONING', negative: true, regex: /^(?:\d+[.)]?\s*)?LAGST[ÖO]D\s*$/i },
  {
    name: 'OVERKLAGANDE',
    role: 'ADMIN',
    negative: true,
    regex: /^(?:\d+[.)]?\s*)?(?:UPPLYSNINGAR\s+OM\s+)?[ÖO]VERKLAGANDE\s*$/i,
  },
  { name: 'AVGIFT', role: 'ADMIN', negative: true, regex: /^(?:\d+[.)]?\s*)?AVGIFT(?:ER)?\s*$/i },
  { name: 'INFORMATION', role: 'ADMIN', negative: true, regex: /^(?:\d+[.)]?\s*)?INFORMATION\s*$/i },
];

const MKB_MARKERS: readonly Marker[] = [
  {
    name: 'LOKALISERINGSUTREDNING',
    role: 'GENERAL',
    regex: /^(?:1[.)]?\s+LOKALISERINGSUTREDNING|PLATSVAL\s*)$/i,
  },
  {
    name: 'BULLER_VIBRATIONER',
    role: 'GENERAL',
    regex: /^(?:2[.)]?\s+N[ÄA]RBOENDE|BULLER\s*)$/i,
  },
  {
    name: 'VATTENMILJO_UTSLAPP',
    role: 'GENERAL',
    regex: /^(?:3[.)]?\s+VATTEN|RECEPIENT\s*|VATTEN\s*)$/i,
  },
];

const TECHNICAL_MARKERS: readonly Marker[] = [
  {
    name: 'PROCESSBESKRIVNING',
    role: 'GENERAL',
    regex: /^(?:1[.)]?\s+PROCESSBESKRIVNING|DRIFT\s*)$/i,
  },
  {
    name: 'RENINGSTEKNIK_FILTER',
    role: 'GENERAL',
    regex: /^(?:2[.)]?\s+RENINGSTEKNIK|FILTER\s*)$/i,
  },
];

function markerForLine(line: string, documentType: string): Marker | undefined {
  const documentMarkers =
    documentType === 'mkb' ? MKB_MARKERS : documentType === 'technical_description' ? TECHNICAL_MARKERS : [];
  return [...MARKERS, ...documentMarkers].find((candidate) => candidate.regex.test(line));
}

type SourceSegment = {
  start: number;
  end: number;
  role: AStructureRole;
  headingPath: string[];
  paragraphNumber: string | null;
  requirementBlockId: string | null;
};

function operative(role: AStructureRole): boolean {
  return (
    role === 'DECISION_BLOCK' ||
    role === 'REQUIREMENT_CONDITION' ||
    role === 'REQUIREMENT_PRECAUTION' ||
    role === 'REQUIREMENT_CONTROL'
  );
}
function defaultRole(documentType: string): AStructureRole {
  if (documentType === 'decision') return 'REASONING';
  if (documentType === 'control_program') return 'REQUIREMENT_CONTROL';
  return 'GENERAL';
}

function parseStructure(sourceText: string, documentType: string): SourceSegment[] {
  const lines = sourceText.split('\n');
  const segments: SourceSegment[] = [];
  let role = defaultRole(documentType);
  let headingPath = [
    role === 'GENERAL' ? 'GENERAL' : documentType === 'decision' ? 'BAKGRUND' : 'EGENKONTROLL',
  ];
  let paragraphNumber: string | null = null;
  let requirementBlockId: string | null = null;
  let operativeHeading = documentType === 'control_program';
  let segmentStart = 0;
  let cursor = 0;

  const push = (end: number) => {
    if (end > segmentStart) {
      segments.push({
        start: segmentStart,
        end,
        role,
        headingPath: [...headingPath],
        paragraphNumber,
        requirementBlockId,
      });
    }
  };

  for (const rawLine of lines) {
    const lineStart = cursor;
    const lineEnd = lineStart + rawLine.length;
    const trimmed = rawLine.trim();
    const marker = markerForLine(trimmed, documentType);

    if (marker) {
      push(lineStart);
      role = marker.role;
      headingPath = [marker.name];
      paragraphNumber = null;
      requirementBlockId = null;
      operativeHeading = operative(marker.role) && !marker.negative;
      segmentStart = lineStart;
    } else {
      const numbered = trimmed.match(/^(\d{1,3})[.)]\s+.+$/);
      if (numbered && operativeHeading && operative(role)) {
        push(lineStart);
        paragraphNumber = numbered[1] ?? null;
        requirementBlockId = paragraphNumber ? `${headingPath[0]}:${paragraphNumber}` : null;
        headingPath = [headingPath[0] ?? 'GENERAL', `BLOCK_${paragraphNumber}`];
        segmentStart = lineStart;
      }
    }
    cursor = lineEnd + 1;
  }
  push(sourceText.length);
  return segments;
}
type TextProjection = {
  text: string;
  offsets: number[];
};

type LocatedAuthorityChunk<T extends AuthorityChunk> = {
  chunk: T;
  start: number;
  end: number;
  projectedStart: number;
  sourceProjection: TextProjection;
  bodyProjection: TextProjection;
};

function projectNonWhitespace(text: string): TextProjection {
  let projected = '';
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const value = text[index] ?? '';
    if (/\s/u.test(value)) continue;
    projected += value;
    offsets.push(index);
  }
  return { text: projected, offsets };
}

function allOccurrences(text: string, needle: string): number[] {
  const result: number[] = [];
  if (needle.length === 0) return result;
  let from = 0;
  while (from <= text.length - needle.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    result.push(at);
    from = at + 1;
  }
  return result;
}

function locateAuthorityChunks<T extends AuthorityChunk>(
  sourceText: string,
  chunks: readonly T[],
): LocatedAuthorityChunk<T>[] {
  const sourceProjection = projectNonWhitespace(sourceText);
  let previousProjectedStart = 0;

  return chunks.map((chunk, index) => {
    const bodyProjection = projectNonWhitespace(chunk.body);
    if (bodyProjection.text.length === 0) {
      throw new Error(`A_STRUCTURE_EMPTY_AUTHORITY_BODY:${index}:${chunk.chunk_id}`);
    }
    const occurrences = allOccurrences(sourceProjection.text, bodyProjection.text);
    const projectedStart = occurrences.find((value) => value >= previousProjectedStart);
    if (projectedStart === undefined) {
      throw new Error(`A_STRUCTURE_AUTHORITY_BODY_NOT_FOUND:${index}:${chunk.chunk_id}`);
    }
    const projectedEnd = projectedStart + bodyProjection.text.length;
    const start = sourceProjection.offsets[projectedStart];
    const finalOffset = sourceProjection.offsets[projectedEnd - 1];
    if (start === undefined || finalOffset === undefined) {
      throw new Error(`A_STRUCTURE_SOURCE_OFFSET_MISSING:${index}:${chunk.chunk_id}`);
    }
    previousProjectedStart = projectedStart + 1;
    return {
      chunk,
      start,
      end: finalOffset + 1,
      projectedStart,
      sourceProjection,
      bodyProjection,
    };
  });
}

function sourceBoundaryToLocal(boundary: number, located: LocatedAuthorityChunk<AuthorityChunk>): number {
  const { projectedStart, sourceProjection, bodyProjection, chunk } = located;
  const projectedEnd = projectedStart + bodyProjection.text.length;
  let globalIndex = projectedStart;
  while (globalIndex < projectedEnd && (sourceProjection.offsets[globalIndex] ?? Infinity) < boundary) {
    globalIndex += 1;
  }
  const relative = globalIndex - projectedStart;
  if (relative <= 0) return 0;
  if (relative >= bodyProjection.offsets.length) return chunk.body.length;
  return bodyProjection.offsets[relative] ?? chunk.body.length;
}

function annotationsFor(
  located: LocatedAuthorityChunk<AuthorityChunk>,
  segments: readonly SourceSegment[],
): AStructureSpanAnnotation[] {
  return segments.flatMap((segment) => {
    const start = Math.max(located.start, segment.start);
    const end = Math.min(located.end, segment.end);
    if (end <= start) return [];
    return [
      {
        source_span: { start, end },
        local_span: {
          start: sourceBoundaryToLocal(start, located),
          end: sourceBoundaryToLocal(end, located),
        },
        section_role: segment.role,
        heading_path: segment.headingPath,
        paragraph_number: segment.paragraphNumber,
        requirement_block_id: segment.requirementBlockId,
      },
    ];
  });
}

function primaryAnnotation(
  annotations: readonly AStructureSpanAnnotation[],
): AStructureSpanAnnotation | undefined {
  return annotations.reduce<AStructureSpanAnnotation | undefined>((best, item) => {
    if (!best) return item;
    const bestSize = best.local_span.end - best.local_span.start;
    const itemSize = item.local_span.end - item.local_span.start;
    return itemSize > bestSize ? item : best;
  }, undefined);
}
export function annotateAuthorityChunks<T extends AuthorityChunk>(
  sourceText: string,
  documentType: string,
  authorityChunks: readonly T[],
): AStructureAnnotatedChunk<T>[] {
  const ordered = [...authorityChunks].sort((a, b) => a.ordinal - b.ordinal);
  const located = locateAuthorityChunks(sourceText, ordered);
  const segments = parseStructure(sourceText, documentType);

  return located.map((locatedChunk) => {
    const { chunk, start, end } = locatedChunk;
    const annotations = annotationsFor(locatedChunk, segments);
    const primary = primaryAnnotation(annotations);
    return {
      authority_chunk: chunk,
      document_type: documentType,
      section_role: primary?.section_role ?? defaultRole(documentType),
      heading_path: primary?.heading_path ?? ['GENERAL'],
      paragraph_number: primary?.paragraph_number ?? null,
      requirement_block_id: primary?.requirement_block_id ?? null,
      source_span: { start, end },
      annotations,
      annotation_version: A_STRUCTURE_ANNOTATION_VERSION,
      marker_version: A_STRUCTURE_MARKER_VERSION,
    };
  });
}
