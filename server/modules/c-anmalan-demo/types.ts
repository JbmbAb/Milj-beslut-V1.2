/**
 * DEMO-01 C-anmälan demo (K-20/K-26). Demo branch only — not PROVEN, not governed.
 *
 * Core rule: every proposal row carries a provenance. A row without one is a bug, not a
 * fallback (see assertEveryRowHasProvenance in proposalEngine.ts).
 */

/** Marking for a fictional underlag (K-36): view, both PDFs (header + every footer). */
export const FICTIONAL_MARK = 'FIKTIVA UPPGIFTER — demo';

/** C-code menu of the demo view (K-36: regulation, not the case; all Anmälningsplikt C). "annan kod" stays free text. */
export const DEMO_CODES = ['90.40', '90.80', '90.110', '90.141'] as const;

/** Where a row comes from. There is no "generated"/"ai" kind on purpose. */
export type RowProvenance =
  | {
      kind: 'municipal_corpus';
      /** K-24 requirements.jsonl row */
      rowId: string;
      documentSha256: string;
      page: number;
      kommun: string;
      diarienummer: string;
      /** true only for gold-set rows manually checked (K-21 d) */
      verified: boolean;
    }
  | {
      kind: 'legal_corpus';
      recordKey: string;
      contentHash: string;
      paragraph: string;
      caveat: string;
    }
  | {
      kind: 'mimer_layer';
      layer: string;
      datasetVersion: string | null;
      bundleSha256: string | null;
      query: string;
    }
  | {
      kind: 'user_input';
      field: string;
      /** Files in the user's underlag the text is quoted from (set only by the underlag loader). */
      sources?: UnderlagFileRef[];
      /** The underlag is marked as fictional demo data. */
      fictional?: boolean;
    }
  | { kind: 'template_default'; templateId: string };

export const PROVENANCE_LABEL: Record<RowProvenance['kind'], string> = {
  municipal_corpus: 'kommunalt beslut',
  legal_corpus: 'lagtext (korpus)',
  mimer_layer: 'Mimer-lager',
  user_input: 'användarens uppgift',
  template_default: 'mallstandard',
};

export type ProposalSectionId =
  | 'verksamhetsutovare'
  | 'verksamhet'
  | 'lokalisering'
  | 'teknisk_beskrivning'
  | 'forsiktighetsmatt'
  | 'egenkontroll'
  | 'bilagor';

export interface ProposalRow {
  id: string;
  section: ProposalSectionId;
  label: string;
  text: string;
  provenance: RowProvenance;
  /** Set when the user edited the row: the source the edit started from (not claimed as source). */
  editedFrom?: RowProvenance;
  /** Shown next to the row, e.g. "ej analyserat – underlag saknas". */
  note?: string;
  /** Present only on attachment rows (K-54): the image is embedded from the blob store by hash. */
  attachment?: AttachmentRef;
  /** Per egenkontroll cell: the underlag files the cell text is quoted from (K-94b). */
  controlSources?: Partial<Record<'frekvens' | 'metod' | 'ansvarig' | 'dokumentation' | 'avvikelse', UnderlagFileRef[]>>;
  /** Present only on egenkontroll rows. */
  control?: {
    frekvens: string;
    metod: string;
    ansvarig: string;
    dokumentation: string;
    avvikelse: string;
  };
}

export interface UnderlagFileRef {
  file: string;
  sha256: string;
}

/** Where the user's facts came from. Set only server-side by the underlag loader, never by the API. */
/** An image from the user's underlag (K-54): JPG/PNG only, stored content-addressed by sha256. */
export interface AttachmentRef {
  title: string;
  file: string;
  sha256: string;
  mime: 'image/jpeg' | 'image/png';
  bytes: number;
}

export interface UnderlagRef {
  label: string;
  sha256: string;
  fictional: boolean;
  /** Per input field: the files its text is quoted from, verbatim. */
  fieldSources: Partial<Record<string, UnderlagFileRef[]>>;
  /** Drawings attached to the anmälan (e.g. situationsplan, sektion). */
  attachments?: AttachmentRef[];
  /** Egenkontroll cells from the user's underlag, per template point id and column (K-94b). */
  controlCells?: Record<string, Partial<Record<'frekvens' | 'metod' | 'ansvarig' | 'dokumentation' | 'avvikelse', { text: string; sources: UnderlagFileRef[] }>>>;
}

/** User-supplied facts. Everything here renders as "användarens uppgift". */
export interface DemoCaseInput {
  propertyDesignation: string;
  /** Chosen by the user; no classifier in the demo path (K-26 §4). */
  verksamhetskoder: string[];
  avfallstyper: string;
  mangdPerArTon: string;
  maxSamtidigtLagradTon: string;
  verksamhetsutovare: string;
  ytansKonstruktion: string;
  jordart: string;
  lutningAvrinning: string;
  dagvatten: string;
  verksamhetsbeskrivning?: string;
  /** The user's own precautions (dust, noise, transports). */
  anvandarensForsiktighetsmatt?: string;
  /** The user's own control routines, feeds the egenkontroll PDF. */
  anvandarensEgenkontroll?: string;
  /** true while the user's underlag is not loaded: every user field is a placeholder. */
  placeholder: boolean;
}

export interface DemoCase {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  organisationId: string | null;
  input: DemoCaseInput;
  underlag?: UnderlagRef;
  status: 'DRAFT' | 'PROPOSED' | 'APPROVED';
  proposal?: Proposal;
  approval?: ApprovalRecord;
}

export interface Proposal {
  generatedAt: string;
  rows: ProposalRow[];
  /** Status of the external inputs the proposal was built from. */
  inputs: {
    requirements: RequirementsSourceStatus;
    localizationLabel: string;
    legalCorpusCaveat: string;
  };
}

export type RowDecision =
  | { rowId: string; action: 'accept' }
  | { rowId: string; action: 'strike' }
  | { rowId: string; action: 'edit'; text: string };

export interface ApprovalRecord {
  approvedAt: string;
  approvedByUserId: string;
  frozenSha256: string;
  frozenPath: string;
  releaseSha: string;
}

export interface RequirementsSourceStatus {
  state: 'missing' | 'invalid' | 'loaded';
  dir: string;
  file?: string;
  fileSha256?: string;
  rowCount?: number;
  invalidRows?: number;
  message: string;
}
