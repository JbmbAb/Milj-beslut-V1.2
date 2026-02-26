export type ActivationClass = "IMMEDIATE" | "PERMIT_REQUIRED";

export interface SourceCatalogItem {
  name: string;
  activation: ActivationClass;
  reason: string;
  implementationKey?: string;
}

export const SOURCE_CATALOG: SourceCatalogItem[] = [
  {
    name: "Lantmäteriet",
    activation: "PERMIT_REQUIRED",
    reason: "Direktåtkomst/licensavtal och behörighetsprocess krävs.",
  },
  {
    name: "Lantmateriet (Fastighetsomrade ATOM - ver)",
    activation: "IMMEDIATE",
    reason: "Publik ATOM-feed i ver-miljon kan anvandas for realistisk integrationstest utan licensnyckel.",
    implementationKey: "lantmateriet_open_fastighetsomrade",
  },
  {
    name: "Lantmateriet (OpenData FTP)",
    activation: "IMMEDIATE",
    reason: "Bulk-nedladdning av oppna dataset via ftp://download-opendata.lantmateriet.se/.",
    implementationKey: "lantmateriet_open_ftp",
  },
  {
    name: "Naturvårdsverket",
    activation: "IMMEDIATE",
    reason: "Öppna data finns tillgängliga utan särskilt avtal för grundläggande konsumtion.",
    implementationKey: "naturvardsverket",
  },
  {
    name: "SGU (Sveriges Geologiska Undersökning)",
    activation: "IMMEDIATE",
    reason: "Öppna geodata och offentliga WMS/OGC-tjänster.",
    implementationKey: "sgu",
  },
  {
    name: "Länsstyrelsen",
    activation: "IMMEDIATE",
    reason: "Flera geodatatjänster är öppna, men lagerinnehåll kan variera.",
  },
  {
    name: "Riksantikvarieämbetet",
    activation: "IMMEDIATE",
    reason: "Öppna data/API finns för flera kulturmiljödatamängder.",
  },
  {
    name: "MSB",
    activation: "IMMEDIATE",
    reason: "Visningstjänst svarar publikt, men vissa lager kan kräva autentisering enligt capabilities.",
    implementationKey: "msb",
  },
  {
    name: "Artdatabanken (SLU)",
    activation: "PERMIT_REQUIRED",
    reason: "Utvecklarportal/prenumeration och villkor för API-användning.",
    implementationKey: "slu",
  },
  {
    name: "BankID",
    activation: "PERMIT_REQUIRED",
    reason: "Avtal + certifikat + teknisk anslutning krävs.",
  },
  {
    name: "Bolagsverket",
    activation: "PERMIT_REQUIRED",
    reason: "Tjänsteupplägg och åtkomstvillkor krävs beroende på datauttag.",
  },
  {
    name: "Din fil: Kontaktuppgifter kommuner.csv",
    activation: "IMMEDIATE",
    reason: "Intern datakälla.",
  },
  {
    name: "Kommunernas Diarier",
    activation: "IMMEDIATE",
    reason: "Tekniskt möjligt direkt, men kräver robust process per kommun.",
  },
  {
    name: "SCB (Statistiska Centralbyrån)",
    activation: "IMMEDIATE",
    reason: "Öppna API:er för statistikdata.",
    implementationKey: "scb",
  },
  {
    name: "Boverket",
    activation: "IMMEDIATE",
    reason: "Klimatdatabas är öppen data; energideklarationsdata kräver separat tillstånd.",
    implementationKey: "boverket",
  },
  {
    name: "SMHI (Sveriges Meteorologiska och Hydrologiska Institut)",
    activation: "IMMEDIATE",
    reason: "Öppna väder-/hydrologi-API:er finns.",
    implementationKey: "smhi",
  },
  {
    name: "Havs- och Vattenmyndigheten (HaV)",
    activation: "IMMEDIATE",
    reason: "Öppna geodata och metadatakatalog.",
  },
  {
    name: "Trafikverket",
    activation: "PERMIT_REQUIRED",
    reason: "Registrering, licens och API-nyckel krävs för API-uttag.",
  },
];

export function classifySource(sourceName: string): SourceCatalogItem | null {
  const normalized = sourceName.trim().toLowerCase();
  return (
    SOURCE_CATALOG.find((item) => normalized.includes(item.name.toLowerCase())) ??
    SOURCE_CATALOG.find((item) => item.name.toLowerCase().includes(normalized)) ??
    null
  );
}
