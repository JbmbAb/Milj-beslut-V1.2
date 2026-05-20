export type SewageEvidenceReadiness = 'IMPORT_READY' | 'PARTIAL' | 'MANUAL_REVIEW';

export interface SewageEvidenceSource {
  id: string;
  title: string;
  authorityName: string;
  sourceSystem: string;
  sourceType: string;
  readiness: SewageEvidenceReadiness;
  sourceUrl: string;
  note: string;
}

export const SEWAGE_EVIDENCE_SOURCES: readonly SewageEvidenceSource[] = [
  {
    id: 'sewage.mb',
    title: 'Miljöbalken (1998:808)',
    authorityName: 'Riksdagen',
    sourceSystem: 'SFS',
    sourceType: 'FOUNDATION_LAW',
    readiness: 'IMPORT_READY',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
    note: 'Grundläggande miljörättslig ram för tillstånd, hänsynsregler och skydd av hälsa och miljö.',
  },
  {
    id: 'sewage.fmh',
    title: 'Förordningen (1998:899) om miljöfarlig verksamhet och hälsoskydd',
    authorityName: 'Regeringen',
    sourceSystem: 'SFS',
    sourceType: 'ORDINANCE',
    readiness: 'IMPORT_READY',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:899',
    note: 'Central för anmälan och tillståndsprocess kring små avloppsanordningar och hälsoskydd.',
  },
  {
    id: 'sewage.hvmfs',
    title: 'HVMFS 2016:17 - Allmänna råd om små avloppsanordningar för hushållsspillvatten',
    authorityName: 'Havs- och vattenmyndigheten',
    sourceSystem: 'HAV',
    sourceType: 'GUIDANCE',
    readiness: 'IMPORT_READY',
    sourceUrl: 'https://www.havochvatten.se/vagledning-foreskrifter-och-lagar/foreskrifter/register-avlopp/sma-avloppsanordningar-for-hushallsspillvatten-hvmfs-201617.html',
    note: 'Viktigaste vägledningen för skyddsnivå, markförutsättningar, skyddsavstånd och platsbedömning.',
  },
  {
    id: 'sewage.domstolsverket',
    title: 'Domstolsverket RSS - miljöavgöranden',
    authorityName: 'Domstolsverket',
    sourceSystem: 'DOMSTOL_RSS',
    sourceType: 'JUDGMENT_FEED',
    readiness: 'IMPORT_READY',
    sourceUrl: 'https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972',
    note: 'Befintligt ingest-spår för domar och avgöranden som kan filtreras vidare mot avloppspraxis.',
  },
  {
    id: 'sewage.mod',
    title: 'Mark- och miljööverdomstolen (MÖD) praxis',
    authorityName: 'Mark- och miljööverdomstolen',
    sourceSystem: 'DOMSTOL_RSS',
    sourceType: 'JUDGMENT_SCOPE',
    readiness: 'PARTIAL',
    sourceUrl: 'https://www.domstol.se/mark--och-miljooverdomstolen/',
    note: 'Behöver filtrering/taggning ovanpå Domstolsverkets flöde för att bli ett säkert avloppsunderlag.',
  },
  {
    id: 'sewage.lansstyrelsen',
    title: 'Länsstyrelsernas vägledningar för enskilt avlopp',
    authorityName: 'Länsstyrelsen',
    sourceSystem: 'LANSSTYRELSEN',
    sourceType: 'GUIDANCE_PORTAL',
    readiness: 'MANUAL_REVIEW',
    sourceUrl: 'https://www.lansstyrelsen.se/',
    note: 'Viktigt regionalt stöd men kräver urval per län och kommunal tillämpning.',
  },
  {
    id: 'sewage.dataportal',
    title: 'Dataportal och geodata för skyddsområden, recipienter och brunnar',
    authorityName: 'Offentliga dataportaler',
    sourceSystem: 'DATAPORTAL',
    sourceType: 'SPATIAL_DATASET',
    readiness: 'PARTIAL',
    sourceUrl: 'https://www.dataportal.se/',
    note: 'Behöver ombyggd discovery för att ge samma platsbundna underlag till avloppsbedömningen.',
  },
];

export function listSewageEvidenceSources(): SewageEvidenceSource[] {
  return [...SEWAGE_EVIDENCE_SOURCES];
}
