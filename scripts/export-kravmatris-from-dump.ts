import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

export type AdminDatabaseDumpResponse = {
  generatedAt: string;
  countByTable: Record<string, number>;
  tables: Record<string, unknown[]>;
};

export type Options = {
  inputPath?: string;
  outputPath: string;
  maxPerDocument: number;
  limitDocs?: number;
  projectId?: string;
  projectNameIncludes?: string;
};

export const HEADER = [
  "CaseId",
  "Kommun",
  "Myndighetstyp",
  "Myndighet",
  "Diarienummer",
  "Dokumenttyp",
  "Dokumentdatum",
  "KallaFil",
  "KravId",
  "KravkallaTyp",
  "Kravkategori",
  "Kravsubkategori",
  "KravtextCitat",
  "TolkadKravtext",
  "Kravniva",
  "RattsligHanvisning",
  "Tidsfrist",
  "Kontrollfrekvens",
  "SanktionEllerKonsekvens",
  "UtlosandeVillkor",
  "Avfallsslag",
  "EWC",
  "MaxMangdTon",
  "MaxLagringstid",
  "KopplingKonstruktion",
  "KopplingLakvatten",
  "KopplingKontrollprogram",
  "KopplingRisk",
  "Mallavsnitt",
  "KommunBlankettFalt",
  "BilagaSomStods",
  "MinimikravJaNej",
  "KommunspecifiktJaNej",
  "StatusIAnmalan",
  "Kommentar",
] as const;

export type HeaderKey = (typeof HEADER)[number];
export type OutputRow = Record<HeaderKey, string>;
export type RequirementBuildRow = OutputRow & {
  _documentId: string;
  _projectId: string;
  _organisationId: string;
  _entryId: string;
  _caseKey: string;
  _subject: string;
  _originalName: string;
};

const requirementKeywords = [
  "ska",
  "skall",
  "maste",
  "far inte",
  "kravs",
  "villkor",
  "forelagg",
  "bor",
];

const domainKeywords = [
  "mellanlagr",
  "avfall",
  "platta",
  "ytkonstruktion",
  "tatskikt",
  "invall",
  "lakvatten",
  "dagvatten",
  "avrinning",
  "uppsamling",
  "kontrollprogram",
  "journal",
  "provtag",
  "lagringstid",
  "mangd",
  "ewc",
  "ton",
  "risk",
  "brand",
];

function printHelp() {
  const msg = [
    "Usage: tsx scripts/export-kravmatris-from-dump.ts [options]",
    "",
    "Options:",
    "  --input=PATH                Read existing /api/admin/database-dump JSON file",
    "  --output=PATH               Output CSV path (default: kravmatris_mellanlagring_autofylld.csv)",
    "  --max-per-document=NUMBER   Max auto-rader per dokument (default: 3)",
    "  --limit-docs=NUMBER         Process only first N matching documents",
    "  --project-id=ID             Filter by projectId",
    "  --project-name=TEXT         Filter by project propertyDesignation contains TEXT",
    "  --help                      Show this help",
    "",
    "If --input is omitted, script reads live DB via getAdminDatabaseDump().",
  ];
  console.log(msg.join("\n"));
}

export function parseOptions(argv: string[]): Options {
  const args = argv.slice(2);
  if (args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const read = (name: string): string | undefined => {
    const prefixed = args.find((arg) => arg.startsWith(`--${name}=`));
    if (prefixed) {
      return prefixed.slice(name.length + 3).trim();
    }
    const index = args.findIndex((arg) => arg === `--${name}`);
    if (index >= 0 && args[index + 1]) {
      return String(args[index + 1]).trim();
    }
    return undefined;
  };

  const maxPerDocumentRaw = Number(read("max-per-document") ?? 3);
  const maxPerDocument = Number.isFinite(maxPerDocumentRaw) && maxPerDocumentRaw > 0 ? Math.floor(maxPerDocumentRaw) : 3;

  const limitDocsRaw = read("limit-docs");
  const limitDocsParsed = Number(limitDocsRaw ?? "");
  const limitDocs = Number.isFinite(limitDocsParsed) && limitDocsParsed > 0 ? Math.floor(limitDocsParsed) : undefined;

  return {
    inputPath: read("input"),
    outputPath: read("output") || "kravmatris_mellanlagring_autofylld.csv",
    maxPerDocument,
    limitDocs,
    projectId: read("project-id"),
    projectNameIncludes: read("project-name"),
  };
}

function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object") as JsonRecord[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toIsoDate(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function firstMatch(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  return match?.[0] || "";
}

function splitSentences(text: string): string[] {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!cleaned) return [];

  const rough = cleaned
    .split(/(?<=[.!?;])\s+|\n+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  const rows: string[] = [];
  for (const row of rough) {
    const singleLine = row.replace(/\s+/g, " ").trim();
    if (singleLine.length < 24) continue;
    if (singleLine.length > 700) continue;
    if (unique.has(singleLine)) continue;
    unique.add(singleLine);
    rows.push(singleLine);
  }
  return rows;
}

function looksLikeRequirement(sentence: string): boolean {
  const n = normalize(sentence);
  const hasReq = requirementKeywords.some((kw) => n.includes(kw));
  const hasDomain = domainKeywords.some((kw) => n.includes(kw));
  return hasReq && hasDomain;
}

function scoreSentence(sentence: string): number {
  const n = normalize(sentence);
  let score = 0;
  for (const kw of requirementKeywords) {
    if (n.includes(kw)) score += 2;
  }
  for (const kw of domainKeywords) {
    if (n.includes(kw)) score += 1;
  }
  if (n.includes("lakvatten")) score += 2;
  if (n.includes("dagvatten")) score += 2;
  if (n.includes("platta") || n.includes("tatskikt") || n.includes("invall")) score += 2;
  return score;
}

function extractCandidates(text: string, maxPerDocument: number): string[] {
  const sentences = splitSentences(text);
  const candidates = sentences
    .filter(looksLikeRequirement)
    .map((sentence) => ({ sentence, score: scoreSentence(sentence) }))
    .sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)
    .slice(0, maxPerDocument)
    .map((item) => item.sentence);

  return candidates;
}

function detectDocumentType(subject: string, fileName: string): string {
  const text = normalize(`${subject} ${fileName}`);
  if (text.includes("kompletter")) return "Komplettering";
  if (text.includes("forelagg")) return "Forelaggande";
  if (text.includes("anmal")) return "Anmalan";
  if (text.includes("beslut")) return "Beslut";
  return "Beslut";
}

function mapKravKallaTyp(documentType: string): string {
  if (documentType === "Komplettering" || documentType === "Forelaggande") return "Kompletteringskrav";
  if (documentType === "Beslut") return "Beslutsvillkor";
  if (documentType === "Anmalan") return "Informationskrav";
  return "Informationskrav";
}

function detectKravNiva(text: string): string {
  const n = normalize(text);
  if (n.includes("ska") || n.includes("skall") || n.includes("maste") || n.includes("far inte") || n.includes("kravs")) return "SKA";
  if (n.includes("bor") || n.includes("rekommender")) return "BOR";
  if (n.includes("kan")) return "KAN";
  return "INFO";
}

function detectAuthorityType(subject: string, municipality: string): string {
  if (municipality) return "Kommun";
  const n = normalize(subject);
  if (n.includes("lansstyrelse")) return "Lansstyrelse";
  return "Kommun";
}

function guessAuthorityName(municipality: string, subject: string): string {
  if (municipality) return `${municipality} kommun`;
  const n = normalize(subject);
  if (n.includes("lansstyrelse")) return "Lansstyrelse";
  return "";
}

function detectMunicipality(subject: string, fileName: string, text: string, explicitMunicipality: string): string {
  const explicit = explicitMunicipality.trim();
  if (explicit) return explicit;

  const source = `${subject} ${fileName} ${text.slice(0, 1500)}`;
  const direct = source.match(/\b([A-ZÅÄÖa-zåäö\- ]{2,40})\s+kommun\b/u);
  if (direct?.[1]) {
    return direct[1].replace(/\s+/g, " ").trim();
  }

  const alt = source.match(/\bkommunen\s+i\s+([A-ZÅÄÖa-zåäö\- ]{2,40})\b/u);
  if (alt?.[1]) {
    return alt[1].replace(/\s+/g, " ").trim();
  }

  return "";
}

type CategoryMapping = {
  kravkategori: string;
  kravsubkategori: string;
  mallavsnitt: string;
  kommunBlankettFalt: string;
  bilagaSomStods: string;
  kopplingKonstruktion: string;
  kopplingLakvatten: string;
  kopplingKontrollprogram: string;
  kopplingRisk: string;
  utlosandeVillkor: string;
};

function classifyCategory(text: string): CategoryMapping {
  const n = normalize(text);

  if (n.includes("lakvatten") || n.includes("dagvatten") || n.includes("avrinning") || n.includes("uppsaml") || n.includes("rening")) {
    return {
      kravkategori: "DagvattenLakvatten",
      kravsubkategori: "Uppsamling",
      mallavsnitt: "6",
      kommunBlankettFalt: "Lakvattenhantering",
      bilagaSomStods: "Flodesschema dagvatten-lakvatten",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Ja",
      kopplingKontrollprogram: "Ja",
      kopplingRisk: "Nej",
      utlosandeVillkor: "Vid nederbord och avrinning",
    };
  }

  if (n.includes("platta") || n.includes("tatskikt") || n.includes("invall") || n.includes("barighet") || n.includes("yt") || n.includes("sprick")) {
    return {
      kravkategori: "Ytkonstruktion",
      kravsubkategori: "Tat yta",
      mallavsnitt: "5",
      kommunBlankettFalt: "Teknisk beskrivning av platta",
      bilagaSomStods: "Teknisk ritning platta",
      kopplingKonstruktion: "Ja",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Nej",
      kopplingRisk: "Nej",
      utlosandeVillkor: "Vid mellanlagring av avfall",
    };
  }

  if (n.includes("kontrollprogram") || n.includes("journal") || n.includes("provtag") || n.includes("egenkontroll") || n.includes("inspek")) {
    return {
      kravkategori: "DriftEgenkontroll",
      kravsubkategori: "Journalforing",
      mallavsnitt: "7",
      kommunBlankettFalt: "Egenkontrollrutiner",
      bilagaSomStods: "Egenkontrollprogram",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Ja",
      kopplingRisk: "Nej",
      utlosandeVillkor: "Lopande drift",
    };
  }

  if (n.includes("brand") || n.includes("risk") || n.includes("spill") || n.includes("olycka")) {
    return {
      kravkategori: "Riskhantering",
      kravsubkategori: "Riskkontroll",
      mallavsnitt: "8",
      kommunBlankettFalt: "Riskhantering",
      bilagaSomStods: "Risk-PM",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Ja",
      kopplingRisk: "Ja",
      utlosandeVillkor: "Vid risk for incident",
    };
  }

  if (n.includes("mangd") || n.includes("ton") || n.includes("lagringstid") || n.includes("samtidig")) {
    return {
      kravkategori: "LagringsvolymTid",
      kravsubkategori: "Maxmangd",
      mallavsnitt: "4",
      kommunBlankettFalt: "Avfallsmangder och lagringstid",
      bilagaSomStods: "Avfallsforteckning",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Nej",
      kopplingRisk: "Nej",
      utlosandeVillkor: "Alltid",
    };
  }

  if (n.includes("transport") || n.includes("infart") || n.includes("utfart")) {
    return {
      kravkategori: "TransportLogistik",
      kravsubkategori: "Transportvagar",
      mallavsnitt: "9",
      kommunBlankettFalt: "Transporter och logistik",
      bilagaSomStods: "Trafikplan",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Nej",
      kopplingRisk: "Ja",
      utlosandeVillkor: "Vid transporter",
    };
  }

  if (n.includes("lokalisering") || n.includes("avstand") || n.includes("karta") || n.includes("skyddsobjekt")) {
    return {
      kravkategori: "LokaliseringPlats",
      kravsubkategori: "Skyddsobjekt",
      mallavsnitt: "3",
      kommunBlankettFalt: "Platsforutsattningar",
      bilagaSomStods: "Situationsplan",
      kopplingKonstruktion: "Nej",
      kopplingLakvatten: "Nej",
      kopplingKontrollprogram: "Nej",
      kopplingRisk: "Nej",
      utlosandeVillkor: "Fore beslut",
    };
  }

  if (n.includes("avveckl") || n.includes("efterbehandling")) {
    return {
      kravkategori: "AvvecklingEfterbehandling",
      kravsubkategori: "Atgardsplan",
      mallavsnitt: "11",
      kommunBlankettFalt: "Avveckling och efterbehandling",
      bilagaSomStods: "Avvecklingsplan",
      kopplingKonstruktion: "Ja",
      kopplingLakvatten: "Ja",
      kopplingKontrollprogram: "Ja",
      kopplingRisk: "Ja",
      utlosandeVillkor: "Vid avslut av verksamhet",
    };
  }

  return {
    kravkategori: "MiljopaverkanForsiktighet",
    kravsubkategori: "Skyddsatgarder",
    mallavsnitt: "10",
    kommunBlankettFalt: "Miljopaverkan och forsiktighetsmatt",
    bilagaSomStods: "Miljo-PM",
    kopplingKonstruktion: "Nej",
    kopplingLakvatten: "Nej",
    kopplingKontrollprogram: "Nej",
    kopplingRisk: "Nej",
    utlosandeVillkor: "Alltid",
  };
}

function detectRattsligHanvisning(text: string): string {
  const n = normalize(text);
  const refs: string[] = [];
  if (n.includes("miljobalk")) refs.push("Miljobalken");
  if (n.includes("miljoprovningsforordning") || /\bmpf\b/.test(n)) refs.push("MPF");
  if (n.includes("miljofarlig verksamhet") || /\bfmh\b/.test(n)) refs.push("FMH");
  if (n.includes("naturvardsverk")) refs.push("Naturvardsverket");
  return refs.join(", ");
}

function detectTidsfrist(text: string): string {
  const source = normalize(text);
  const date = firstMatch(source, /\b\d{4}-\d{2}-\d{2}\b/);
  if (date) return date;
  const within = firstMatch(source, /\binom\s+\d+\s+(dag(ar)?|veck(or)?|manad(er)?|ar)\b/);
  if (within) return within;
  const latest = firstMatch(source, /\bsenast\s+[a-z0-9\- ]{3,30}/);
  return latest;
}

function detectKontrollfrekvens(text: string): string {
  const n = normalize(text);
  if (n.includes("daglig")) return "Daglig";
  if (n.includes("veckovis")) return "Veckovis";
  if (n.includes("manad")) return "Manadskontroll";
  if (n.includes("kvartal")) return "Kvartalsvis";
  if (n.includes("arlig")) return "Arlig";
  if (n.includes("lopande")) return "Lopande";
  return "";
}

function detectSanktion(text: string): string {
  const n = normalize(text);
  if (n.includes("vite")) return "Vite";
  if (n.includes("forbud")) return "Forbud";
  if (n.includes("forelagg")) return "Forelaggande vid brist";
  if (n.includes("far inte")) return "Driftbegransning vid avvikelse";
  return "";
}

function detectEwc(text: string): string {
  const match = text.match(/\b\d{2}\s?\d{2}\s?\d{2}\*?\b/);
  return match?.[0]?.replace(/\s+/g, " ") || "";
}

function detectMaxMangdTon(text: string): string {
  const n = normalize(text).replace(",", ".");
  const m = n.match(/\b(?:max(?:imal)?\s*)?(\d+(?:\.\d+)?)\s*(?:ton|t)\b/);
  return m?.[1] || "";
}

function detectMaxLagringstid(text: string): string {
  const n = normalize(text);
  const m = n.match(/\b(\d+\s*(?:dag(?:ar)?|dygn|vecka(?:r)?|manad(?:er)?|ar))\b/);
  return m?.[1] || "";
}

function detectDiarienummer(subject: string, fullText: string): string {
  const candidate = `${subject} ${fullText.slice(0, 3000)}`;
  const patterns = [
    /\b\d{4}[-:/]\d{2,8}\b/,
    /\b\d{2,4}[-/]\d{2,8}\b/,
    /\bdnr[:\s]*[a-z0-9\-/:]+\b/i,
  ];
  for (const pattern of patterns) {
    const found = firstMatch(candidate, pattern);
    if (found) return found.replace(/^dnr[:\s]*/i, "").trim();
  }
  return "";
}

function looksRelevantDocument(subject: string, fileName: string, text: string): boolean {
  const n = normalize(`${subject} ${fileName} ${text.slice(0, 5000)}`);
  return domainKeywords.some((kw) => n.includes(kw));
}

function toCsvCell(value: string): string {
  const clean = (value || "").replace(/\r?\n/g, " ").trim();
  if (clean.includes(";") || clean.includes('"')) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

function toCsv(rows: OutputRow[]): string {
  const lines = [HEADER.join(";")];
  for (const row of rows) {
    lines.push(HEADER.map((key) => toCsvCell(row[key] || "")).join(";"));
  }
  return `${lines.join("\n")}\n`;
}

export async function readDumpFromFile(filePath: string): Promise<AdminDatabaseDumpResponse> {
  const absolute = path.resolve(process.cwd(), filePath);
  const payload = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(payload) as AdminDatabaseDumpResponse;
  if (!parsed || typeof parsed !== "object" || !parsed.tables) {
    throw new Error("Ogiltig dumpfil. Forvantat format: { generatedAt, countByTable, tables }");
  }
  return parsed;
}

export async function readDumpFromDb(): Promise<AdminDatabaseDumpResponse> {
  const moduleRef = await import("../server/repositories/adminReportRepository.ts");
  const getAdminDatabaseDump = moduleRef.getAdminDatabaseDump as (input?: {
    limitPerTable?: number;
    includeSearchText?: boolean;
    includeChunkText?: boolean;
  }) => Promise<AdminDatabaseDumpResponse>;
  return getAdminDatabaseDump({
    includeSearchText: true,
    includeChunkText: false,
  });
}

export function buildRows(dump: AdminDatabaseDumpResponse, options: Options): RequirementBuildRow[] {
  const docs = asArray(dump.tables.documentRecords);
  const contents = asArray(dump.tables.documentContents);
  const projects = asArray(dump.tables.projects);

  const contentByDocumentId = new Map<string, string>();
  for (const content of contents) {
    const documentId = asString(content.documentId);
    if (!documentId) continue;
    const searchText = asString(content.searchText);
    if (!searchText) continue;
    contentByDocumentId.set(documentId, searchText);
  }

  const projectById = new Map<string, JsonRecord>();
  for (const project of projects) {
    const id = asString(project.id);
    if (!id) continue;
    projectById.set(id, project);
  }

  const rows: RequirementBuildRow[] = [];
  let kravCounter = 1;
  let processed = 0;

  for (const doc of docs) {
    const documentId = asString(doc.id);
    const projectId = asString(doc.projectId);
    const organisationId = asString(doc.organisationId);
    const project = projectById.get(projectId);
    const projectName = asString(project?.propertyDesignation);

    if (options.projectId && options.projectId !== projectId) continue;
    if (options.projectNameIncludes && !normalize(projectName).includes(normalize(options.projectNameIncludes))) continue;

    if (options.limitDocs && processed >= options.limitDocs) break;
    processed += 1;

    const subject = asString(doc.subject);
    const originalName = asString(doc.originalName);
    const municipality = detectMunicipality(subject, originalName, asString(contentByDocumentId.get(documentId) || ""), asString(doc.municipality));
    const wasteType = asString(doc.wasteType);
    const receivedTime = asString(doc.receivedTime);
    const createdAt = asString(doc.createdAt);
    const text = contentByDocumentId.get(documentId) || "";
    const metadataText = `${subject} ${originalName}`;

    if (!looksRelevantDocument(subject, originalName, text)) continue;

    const candidates = extractCandidates(text, options.maxPerDocument);
    if (candidates.length === 0) continue;

    const documentType = detectDocumentType(subject, originalName);
    const kravKallaTyp = mapKravKallaTyp(documentType);
    const myndighetstyp = detectAuthorityType(subject, municipality);
    const myndighet = guessAuthorityName(municipality, subject);
    const diarienummer = detectDiarienummer(subject, text);

    for (const candidate of candidates) {
      const category = classifyCategory(candidate);
      const ewc = detectEwc(`${candidate} ${text.slice(0, 1500)}`);
      const maxMangdTon = detectMaxMangdTon(candidate);
      const maxLagringstid = detectMaxLagringstid(candidate);
      const caseIdBase = projectName || projectId || "PROJECT";
      const entryId = asString(doc.entryId) || asString(doc.id);

      const caseId = `${caseIdBase}-${entryId}`;
      const row: RequirementBuildRow = {
        CaseId: `${caseIdBase}-${entryId}`,
        Kommun: municipality,
        Myndighetstyp: myndighetstyp,
        Myndighet: myndighet,
        Diarienummer: diarienummer,
        Dokumenttyp: documentType,
        Dokumentdatum: toIsoDate(receivedTime || createdAt),
        KallaFil: originalName || asString(doc.diskName),
        KravId: `KRAV-AUTO-${String(kravCounter).padStart(6, "0")}`,
        KravkallaTyp: kravKallaTyp,
        Kravkategori: category.kravkategori,
        Kravsubkategori: category.kravsubkategori,
        KravtextCitat: candidate,
        TolkadKravtext: candidate.slice(0, 320),
        Kravniva: detectKravNiva(candidate),
        RattsligHanvisning: detectRattsligHanvisning(`${candidate} ${metadataText}`),
        Tidsfrist: detectTidsfrist(candidate),
        Kontrollfrekvens: detectKontrollfrekvens(candidate),
        SanktionEllerKonsekvens: detectSanktion(candidate),
        UtlosandeVillkor: category.utlosandeVillkor,
        Avfallsslag: wasteType,
        EWC: ewc,
        MaxMangdTon: maxMangdTon,
        MaxLagringstid: maxLagringstid,
        KopplingKonstruktion: category.kopplingKonstruktion,
        KopplingLakvatten: category.kopplingLakvatten,
        KopplingKontrollprogram: category.kopplingKontrollprogram,
        KopplingRisk: category.kopplingRisk,
        Mallavsnitt: category.mallavsnitt,
        KommunBlankettFalt: category.kommunBlankettFalt,
        BilagaSomStods: category.bilagaSomStods,
        MinimikravJaNej: "Nej",
        KommunspecifiktJaNej: "Nej",
        StatusIAnmalan: "Ej behandlad",
        Kommentar: "AUTO_GENERERAD. Verifiera citat mot kallfil.",
        _documentId: documentId,
        _projectId: projectId,
        _organisationId: organisationId,
        _entryId: entryId,
        _caseKey: caseId,
        _subject: subject,
        _originalName: originalName,
      };

      rows.push(row);
      kravCounter += 1;
    }
  }

  return rows;
}

async function main() {
  const options = parseOptions(process.argv);
  const dump = options.inputPath ? await readDumpFromFile(options.inputPath) : await readDumpFromDb();
  const rows = buildRows(dump, options);
  const csv = toCsv(rows);
  const outputAbsolute = path.resolve(process.cwd(), options.outputPath);
  await fs.writeFile(outputAbsolute, csv, "utf8");

  console.log(`Klar. Skrev ${rows.length} rader till: ${outputAbsolute}`);
}

function isExecutedAsCli(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  const cliHref = pathToFileURL(path.resolve(argvPath)).href;
  return cliHref === import.meta.url;
}

if (isExecutedAsCli()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
