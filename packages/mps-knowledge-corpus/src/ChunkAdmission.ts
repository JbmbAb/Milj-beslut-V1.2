import {
  chunkCourtDecision,
  chunkStandard,
  chunkSwedishLaw,
  chunkSwedishLawV24,
  hasGenuineChapterMarkerV24,
  detectSections,
  type ExtractedChunk,
} from '@miljobeslut/mps-chunking';
import {
  computeFragmentId,
  orderChunksDeterministically,
  type ChunkStructureKind,
  type CourtChunkIdentityFields,
  type EvidenceChunkIdentityFields,
  type LawChunkIdentityFields,
  type LegalChunkIdentityFields,
  type StandardChunkIdentityFields,
} from '@miljobeslut/mps-legal-corpus';

/**
 * LEGAL-CHUNK-ADMISSION-V1.
 *
 * The adapter from mps-chunking's raw chunker output to mps-legal-corpus's governed
 * LegalChunkIdentityFields (v2, family-aware). Lives outside both packages deliberately:
 * mps-legal-corpus is storage- AND chunker-agnostic by design, and mps-chunking has no
 * knowledge of corpus identity at all.
 *
 * The hard rule this enforces: `law` documents are admitted to paragraph-level identity ONLY
 * when a real chapter/paragraph marker was verified in the text -- never a silent "chapter 1" /
 * "paragraph 0" default. `court`/`evidence`/`standard` are never rejected merely for lacking
 * law structure, because that was never theirs to have.
 */
export type AdmissionDocumentStatus = 'ADMITTED' | 'STRUCTURE_PARTIAL' | 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS';

export interface RejectedFragment {
  readonly reason: string;
  readonly preview: string;
}

export interface ChunkAdmissionResult {
  readonly document_status: AdmissionDocumentStatus;
  readonly admitted: readonly LegalChunkIdentityFields[];
  readonly rejected: readonly RejectedFragment[];
}

const REAL_PARAGRAPH_MARKER = /\b\d+\s*[a-z]?\s*§/i;
// Deliberately identical to chunkSwedishLaw's OWN chapterRegex (mps-chunking, frozen text/v2.3):
// this only verifies what that chunker can actually detect and therefore what `c.chapter` can
// actually be trusted to reflect. KNOWN LIMITATION (upstream, not fixed by this unit): neither
// this check nor chunkSwedishLaw itself detects letter-suffixed chapters like "2 a kap." -- that
// citation currently falls through to NO_CHAPTER_DIVISION rather than being extracted as "2 a".
// Fixing it means changing chunkSwedishLaw's own regex, which is a frozen, versioned chunker
// (text/v2.3) — out of scope here per the chunking-strategy-gate skill's own rule that changing
// an approved strategy's detection logic requires a deliberate version bump, not an inline patch.
const REAL_CHAPTER_MARKER = /(\d+)\s+kap\./i;
const NO_CHAPTER_DIVISION = '(ingen kapitelindelning)';

/**
 * `law`: admits only fragments with a VERIFIED paragraph marker. `chunkSwedishLaw` defaults an
 * unmatched chapter to "1" internally (so its own output can never distinguish "really chapter
 * 1" from "no chapter heading ever appeared") -- so chapter presence is independently verified
 * here against the raw text, never trusted from the chunker's default.
 */
export function admitLawChunks(args: {
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  if (!REAL_PARAGRAPH_MARKER.test(args.text)) {
    return {
      document_status: 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS',
      admitted: [],
      rejected: [
        {
          reason:
            'NOT_ADMITTED_TO_PARAGRAPH_CORPUS: no verified § marker found anywhere in the projected text.',
          preview: args.text.slice(0, 120),
        },
      ],
    };
  }

  const hasVerifiedChapterDivision = REAL_CHAPTER_MARKER.test(args.text);
  const prepared = chunkSwedishLaw(args.text);

  const admitted: LawChunkIdentityFields[] = [];
  const rejected: RejectedFragment[] = [];
  let sequence = 0;

  for (const c of prepared) {
    if (!c.paragraph) {
      rejected.push({
        reason: 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS: no verified § marker for this fragment.',
        preview: c.chunkText.slice(0, 120),
      });
      continue;
    }
    // hasVerifiedChapterDivision is false only when the WHOLE document has zero "N kap."
    // headings -- a real, valid shape for a short flat-structure SFS ordinance. Using
    // chunkSwedishLaw's silently-defaulted "1" there would claim a chapter division that does
    // not exist; NO_CHAPTER_DIVISION says exactly what is true instead.
    const chapter = hasVerifiedChapterDivision ? (c.chapter ?? '1') : NO_CHAPTER_DIVISION;
    const base: Omit<LawChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'law',
      chapter,
      paragraph: c.paragraph,
      section: c.section,
      full_text: c.chunkText,
      references_to: [],
      case_citations: [],
      chunk_policy_version: args.chunkPolicyVersion,
      source_projection_ref: args.sourceProjectionRef,
      sequence: sequence++,
    };
    admitted.push({ ...base, fragment_id: computeFragmentId(base) });
  }

  // Canonical order (chapter, then paragraph, both numeric-aware) is NOT guaranteed by the raw
  // document's own top-to-bottom text order -- a cross-reference like "se 7 kap. 2 §" inside a
  // paragraph's body can be misread by chunkSwedishLaw's regex as a new boundary, producing an
  // occasional out-of-sequence fragment. computeChunkSetContentHash requires canonical order and
  // does not sort for the caller (by design -- see ChunkIdentity.ts), so this admitter, as a
  // producer, must sort its own output before handing it on. Sorting after fragment_id is
  // assigned is safe: fragment_id is derived from `sequence` (the original document position),
  // not from array position, so re-ordering the array never changes any fragment's identity.
  return {
    document_status:
      admitted.length === 0
        ? 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS'
        : rejected.length > 0
          ? 'STRUCTURE_PARTIAL'
          : 'ADMITTED',
    admitted: orderChunksDeterministically(admitted),
    rejected,
  };
}

/**
 * `law`, LEGAL-CHUNKING-LAW-V2.4: same admission contract as `admitLawChunks`, built on
 * `chunkSwedishLawV24` instead of `chunkSwedishLaw`. A new, separately-named function -- not a
 * flag branch inside `admitLawChunks` -- because `chunk_policy_version` is identity-bearing
 * (LEGAL-CORPUS-MATERIALIZATION-IDENTITY-V2): callers select this path explicitly by calling it,
 * and the resulting materializations get their own distinct identity, never silently replacing or
 * merging with anything produced by the v2.3 path.
 */
export function admitLawChunksV24(args: {
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  if (!REAL_PARAGRAPH_MARKER.test(args.text)) {
    return {
      document_status: 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS',
      admitted: [],
      rejected: [
        {
          reason:
            'NOT_ADMITTED_TO_PARAGRAPH_CORPUS: no verified § marker found anywhere in the projected text.',
          preview: args.text.slice(0, 120),
        },
      ],
    };
  }

  // LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01: uses the SAME genuine-vs-reference filtering as
  // chunkSwedishLawV24 itself (not a bare regex test), so a document containing only a
  // cross-reference to a different statute's chapter is correctly NOT treated as having a
  // verified chapter division.
  const hasVerifiedChapterDivision = hasGenuineChapterMarkerV24(args.text);
  const prepared = chunkSwedishLawV24(args.text);

  const admitted: LawChunkIdentityFields[] = [];
  const rejected: RejectedFragment[] = [];
  let sequence = 0;

  for (const c of prepared) {
    if (!c.paragraph) {
      rejected.push({
        reason: 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS: no verified § marker for this fragment.',
        preview: c.chunkText.slice(0, 120),
      });
      continue;
    }
    const chapter = hasVerifiedChapterDivision ? (c.chapter ?? '1') : NO_CHAPTER_DIVISION;
    const base: Omit<LawChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'law',
      chapter,
      paragraph: c.paragraph,
      section: c.section,
      full_text: c.chunkText,
      references_to: [],
      case_citations: [],
      chunk_policy_version: args.chunkPolicyVersion,
      source_projection_ref: args.sourceProjectionRef,
      sequence: sequence++,
    };
    admitted.push({ ...base, fragment_id: computeFragmentId(base) });
  }

  return {
    document_status:
      admitted.length === 0
        ? 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS'
        : rejected.length > 0
          ? 'STRUCTURE_PARTIAL'
          : 'ADMITTED',
    admitted: orderChunksDeterministically(admitted),
    rejected,
  };
}

/** `court`: never gated on law structure. `chunkCourtDecision` already only assigns a section
 *  label from a real marker match (DOMSLUT/DOMSKÄL/...), defaulting to "ÖVRIGT" -- an honest
 *  catch-all, not a fabricated legal-structure claim -- so every fragment it produces is admitted. */
export function admitCourtChunks(args: {
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  const prepared = chunkCourtDecision(args.text);
  let sequence = 0;
  const admitted: CourtChunkIdentityFields[] = prepared.map((c) => {
    const base: Omit<CourtChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'court',
      court_section: c.section ?? 'ÖVRIGT',
      full_text: c.chunkText,
      references_to: [],
      case_citations: [],
      chunk_policy_version: args.chunkPolicyVersion,
      source_projection_ref: args.sourceProjectionRef,
      sequence: sequence++,
    };
    return { ...base, fragment_id: computeFragmentId(base) };
  });
  return {
    document_status: admitted.length === 0 ? 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS' : 'ADMITTED',
    admitted: orderChunksDeterministically(admitted),
    rejected: [],
  };
}

/** `evidence`: uses `detectSections`' real marker-based section labels as `evidence_anchor` when
 *  the chunker actually found one for a given fragment -- never invented for symmetry. */
export function admitEvidenceChunks(args: {
  readonly text: string;
  readonly docType: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  const sections = detectSections(args.text, args.docType);
  const extracted: ExtractedChunk[] = Object.entries(sections).map(([section, content]) => ({
    section,
    content,
    relations: [],
  }));
  let sequence = 0;
  const admitted: EvidenceChunkIdentityFields[] = extracted
    .filter((c) => c.content.trim().length > 0)
    .map((c) => {
      const base: Omit<EvidenceChunkIdentityFields, 'fragment_id'> = {
        structure_kind: 'evidence',
        evidence_anchor: c.section,
        full_text: c.content,
        references_to: c.relations.map((r) => r.target),
        case_citations: [],
        chunk_policy_version: args.chunkPolicyVersion,
        source_projection_ref: args.sourceProjectionRef,
        sequence: sequence++,
      };
      return { ...base, fragment_id: computeFragmentId(base) };
    });
  return {
    document_status: admitted.length === 0 ? 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS' : 'ADMITTED',
    admitted: orderChunksDeterministically(admitted),
    rejected: [],
  };
}

/** `standard`: the honest fallback. No structural anchor beyond `sequence`, and never rejected
 *  for lacking one. */
export function admitStandardChunks(args: {
  readonly text: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  const prepared = chunkStandard(args.text);
  let sequence = 0;
  const admitted: StandardChunkIdentityFields[] = prepared.map((c) => {
    const base: Omit<StandardChunkIdentityFields, 'fragment_id'> = {
      structure_kind: 'standard',
      full_text: c.chunkText,
      references_to: [],
      case_citations: [],
      chunk_policy_version: args.chunkPolicyVersion,
      source_projection_ref: args.sourceProjectionRef,
      sequence: sequence++,
    };
    return { ...base, fragment_id: computeFragmentId(base) };
  });
  return {
    document_status: admitted.length === 0 ? 'NOT_ADMITTED_TO_PARAGRAPH_CORPUS' : 'ADMITTED',
    admitted: orderChunksDeterministically(admitted),
    rejected: [],
  };
}

export function admitChunks(args: {
  readonly structureKind: ChunkStructureKind;
  readonly text: string;
  readonly evidenceDocType?: string;
  readonly sourceProjectionRef: string;
  readonly chunkPolicyVersion: string;
}): ChunkAdmissionResult {
  switch (args.structureKind) {
    case 'law':
      return admitLawChunks(args);
    case 'court':
      return admitCourtChunks(args);
    case 'evidence':
      return admitEvidenceChunks({ ...args, docType: args.evidenceDocType ?? 'decision' });
    case 'standard':
      return admitStandardChunks(args);
  }
}
