export const CONTRACT_VERSION = '1.0.0';

export const INPUT_FILENAMES = {
  cases: 'cases.csv',
  requirements: 'requirements.csv',
  citations: 'citations.csv',
  summary: 'summary.json',
};

export const CASE_HEADERS = [
  'CaseId',
  'DocumentId',
  'ProjectId',
  'OrganisationId',
  'Kommun',
  'Myndighetstyp',
  'Myndighet',
  'Diarienummer',
  'Dokumenttyp',
  'Dokumentdatum',
  'KallaFil',
  'Kallrubrik',
  'CaseReviewStatus',
  'ValidatedBy',
  'ValidatedAt',
  'Notes',
];

export const REQUIREMENT_HEADERS = [
  'RequirementId',
  'CaseId',
  'DocumentId',
  'ProjectId',
  'KravkallaTyp',
  'Kravkategori',
  'Kravsubkategori',
  'KravtextCitat',
  'TolkadKravtext',
  'Kravniva',
  'RattsligHanvisning',
  'Tidsfrist',
  'Kontrollfrekvens',
  'SanktionEllerKonsekvens',
  'UtlosandeVillkor',
  'Avfallsslag',
  'EWC',
  'MaxMangdTon',
  'MaxLagringstid',
  'KopplingKonstruktion',
  'KopplingLakvatten',
  'KopplingKontrollprogram',
  'KopplingRisk',
  'Mallavsnitt',
  'KommunBlankettFalt',
  'BilagaSomStods',
  'MinimikravJaNej',
  'KommunspecifiktJaNej',
  'StatusIAnmalan',
  'Kommentar',
  'Kodningssakerhet',
  'Verifieringsstatus',
  'VerifieradJaNej',
  'VerifieradAv',
  'VerifieradDatum',
  'Feltyp',
  'ValideringsKommentar',
];

export const CITATION_HEADERS = [
  'CitationId',
  'RequirementId',
  'CaseId',
  'DocumentId',
  'QuoteText',
  'PageNumber',
  'CharStart',
  'CharEnd',
  'Extractor',
  'VerifieradJaNej',
  'VerifieradAv',
  'VerifieradDatum',
  'Kommentar',
];

export const REPORT_HEADERS = {
  tableA: ['Kommun', 'Myndighet', 'Dokumenttyp', 'AntalArenden'],
  tableB: ['Kravkategori', 'AntalKrav', 'AndelProcent'],
  tableC: ['Kommun', 'YtkonstruktionAntal', 'DagvattenLakvattenAntal', 'TotaltVerifieradeKrav', 'AndelYtkonstruktionProcent', 'AndelDagvattenLakvattenProcent'],
  tableD: ['Avfallsslag', 'EWC', 'AntalKrav'],
  evidenceIndex: [
    'RequirementId',
    'CitationId',
    'CaseId',
    'DocumentId',
    'Kommun',
    'Myndighet',
    'Dokumenttyp',
    'Kravkategori',
    'Kravsubkategori',
    'Kravniva',
    'RattsligHanvisning',
    'VerifieradAv',
    'VerifieradDatum',
    'PageNumber',
    'Kommentar',
    'KallfilRef',
  ],
};

export const ALLOWED_REQUIREMENT_STATUSES = new Set(['VERIFIED']);
export const ALLOWED_CITATION_REVIEW_STATES = new Set(['VERIFIED', 'REVIEWED']);

export const DOUBLE_REVIEW_CATEGORIES = new Set(['YTKONSTRUKTION', 'DAGVATTENLAKVATTEN']);
