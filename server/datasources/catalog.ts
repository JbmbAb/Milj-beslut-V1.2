export type ActivationClass = 'IMMEDIATE' | 'PERMIT_REQUIRED';

export interface SourceCatalogItem {
  name: string;
  activation: ActivationClass;
  reason: string;
  implementationKey?: string;
}

export const SOURCE_CATALOG: SourceCatalogItem[] = [
  {
    name: 'Lantmateriet',
    activation: 'PERMIT_REQUIRED',
    reason: 'Direktatkomst/licensavtal och behorighetsprocess kravs.',
    implementationKey: 'lantmateriet_licensed',
  },
  {
    name: 'Lantmateriet (Fastighetsomrade ATOM - ver)',
    activation: 'IMMEDIATE',
    reason: 'Publik ATOM-feed i ver-miljon kan anvandas for realistisk integrationstest utan licensnyckel.',
    implementationKey: 'lantmateriet_open_fastighetsomrade',
  },
  {
    name: 'Lantmateriet (OpenData FTP)',
    activation: 'IMMEDIATE',
    reason: 'Bulk-nedladdning av oppna dataset via ftp://download-opendata.lantmateriet.se/.',
    implementationKey: 'lantmateriet_open_ftp',
  },
  {
    name: 'Naturvardsverket',
    activation: 'IMMEDIATE',
    reason: 'Oppna data finns tillgangliga utan sarskilt avtal for grundlaggande konsumtion.',
    implementationKey: 'naturvardsverket',
  },
  {
    name: 'SGU (Sveriges Geologiska Undersokning)',
    activation: 'IMMEDIATE',
    reason: 'Oppna geodata och offentliga WMS/OGC-tjanster.',
    implementationKey: 'sgu',
  },
  {
    name: 'Lansstyrelsen',
    activation: 'IMMEDIATE',
    reason: 'Flera geodatatjanster ar oppna, men lagerinnehall kan variera.',
    implementationKey: 'lansstyrelsen',
  },
  {
    name: 'Riksantikvarieambetet',
    activation: 'IMMEDIATE',
    reason: 'Oppna data/API finns for flera kulturmiljodatamangder.',
    implementationKey: 'riksantikvarieambetet',
  },
  {
    name: 'MSB',
    activation: 'IMMEDIATE',
    reason: 'Visningstjanst svarar publikt, men vissa lager kan krava autentisering enligt capabilities.',
    implementationKey: 'msb',
  },
  {
    name: 'Artdatabanken (SLU)',
    activation: 'PERMIT_REQUIRED',
    reason: 'Utvecklarportal/prenumeration och villkor for API-anvandning.',
    implementationKey: 'slu',
  },
  {
    name: 'BankID',
    activation: 'PERMIT_REQUIRED',
    reason: 'Avtal + certifikat + teknisk anslutning kravs.',
    implementationKey: 'bankid',
  },
  {
    name: 'Bolagsverket',
    activation: 'PERMIT_REQUIRED',
    reason: 'Tjansteupplagg och atkomstvillkor kravs beroende pa datauttag.',
    implementationKey: 'bolagsverket',
  },
  {
    name: 'Din fil: Kontaktuppgifter kommuner.csv',
    activation: 'IMMEDIATE',
    reason: 'Intern datakalla.',
    implementationKey: 'kommun_kontakter_csv',
  },
  {
    name: 'Kommunernas Diarier',
    activation: 'IMMEDIATE',
    reason: 'Tekniskt mojligt direkt, men kraver robust process per kommun.',
    implementationKey: 'kommunala_diarier',
  },
  {
    name: 'Svenska Miljorapporteringsportalen (SMP)',
    activation: 'PERMIT_REQUIRED',
    reason: 'Portalen ar publik att na, men datauttag och arendehantering kraver behorig inloggning.',
    implementationKey: 'smp',
  },
  {
    name: 'SCB (Statistiska Centralbyran)',
    activation: 'IMMEDIATE',
    reason: 'Oppna API:er for statistikdata.',
    implementationKey: 'scb',
  },
  {
    name: 'Boverket',
    activation: 'IMMEDIATE',
    reason: 'Klimatdatabas ar oppen data; energideklarationsdata kraver separat tillstand.',
    implementationKey: 'boverket',
  },
  {
    name: 'SMHI (Sveriges Meteorologiska och Hydrologiska Institut)',
    activation: 'IMMEDIATE',
    reason: 'Oppna vader-/hydrologi-API:er finns.',
    implementationKey: 'smhi',
  },
  {
    name: 'Havs- och Vattenmyndigheten (HaV)',
    activation: 'IMMEDIATE',
    reason: 'Oppna geodata och metadatakatalog.',
    implementationKey: 'hav',
  },
  {
    name: 'Trafikverket',
    activation: 'PERMIT_REQUIRED',
    reason: 'Registrering, licens och API-nyckel kravs for API-uttag.',
    implementationKey: 'trafikverket',
  },
  {
    name: 'Lastkajen (Trafikverket)',
    activation: 'PERMIT_REQUIRED',
    reason: 'Konto kravs for maskinell nedladdning av publicerade datapaket (REST API).',
    implementationKey: 'lastkajen',
  },
];

function normalizeCatalogString(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function classifySource(sourceName: string): SourceCatalogItem | null {
  const normalized = normalizeCatalogString(sourceName);
  return (
    SOURCE_CATALOG.find((item) => normalized.includes(normalizeCatalogString(item.name))) ??
    SOURCE_CATALOG.find((item) => normalizeCatalogString(item.name).includes(normalized)) ??
    null
  );
}
