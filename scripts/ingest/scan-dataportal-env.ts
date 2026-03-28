import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_OUT_DIR = path.join("storage", "ingest", "legal", "dataportal-env");
const DEFAULT_LIMIT = 100;
const DEFAULT_DELAY_MS = 200;

type Args = Record<string, string | boolean>;

type RdfValue = {
  type?: "uri" | "literal" | "bnode";
  value?: string;
  lang?: string;
};

type Entry = {
  contextId?: string;
  entryId?: string;
  metadata?: Record<string, Record<string, RdfValue[]>>;
};

type SearchResponse = {
  offset?: number;
  limit?: number;
  results?: number;
  resource?: { children?: Entry[] };
};

type DatasetSummary = {
  contextId?: string;
  entryId?: string;
  uri: string;
  titleSv?: string;
  titleEn?: string;
  descriptionSv?: string;
  descriptionEn?: string;
  keywords: string[];
  themes: string[];
  distributions: string[];
  reasons: string[];
};

const DATASET_TYPE = "http://www.w3.org/ns/dcat#Dataset";
const PREDICATES = {
  title: "http://purl.org/dc/terms/title",
  description: "http://purl.org/dc/terms/description",
  keyword: "http://www.w3.org/ns/dcat#keyword",
  theme: "http://www.w3.org/ns/dcat#theme",
  distribution: "http://www.w3.org/ns/dcat#distribution",
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
};

const ENV_KEYWORDS = [
  "miljo",
  "miljö",
  "klimat",
  "utslapp",
  "utsläpp",
  "luft",
  "vatten",
  "grundvatten",
  "avfall",
  "fororening",
  "förorening",
  "biolog",
  "natur",
  "biodiversitet",
  "kemi",
  "natura",
  "recipient",
  "tillsyn",
  "miljobalk",
  "miljöbalk",
];

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.replace(/^--/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function toInt(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return fallback;
}

function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasKeyword(text: string): boolean {
  const normalized = normalize(text);
  return ENV_KEYWORDS.some((kw) => normalized.includes(normalize(kw)));
}

function getValues(entry: Entry, subject: string, predicate: string): RdfValue[] {
  return entry.metadata?.[subject]?.[predicate] ?? [];
}

function pickLiteral(values: RdfValue[], lang?: string): string | undefined {
  if (!values.length) return undefined;
  if (lang) {
    const match = values.find((item) => item.type === "literal" && item.lang === lang);
    if (match?.value) return match.value;
  }
  const first = values.find((item) => item.type === "literal" && item.value);
  return first?.value;
}

function pickAllLiterals(values: RdfValue[]): string[] {
  return values
    .filter((item) => item.type === "literal" && item.value)
    .map((item) => String(item.value));
}

function pickAllUris(values: RdfValue[]): string[] {
  return values
    .filter((item) => item.type === "uri" && item.value)
    .map((item) => String(item.value));
}

function findDatasetSubject(entry: Entry): string | null {
  const metadata = entry.metadata ?? {};
  for (const [subject, predicates] of Object.entries(metadata)) {
    const types = predicates[PREDICATES.type] ?? [];
    if (types.some((item) => item.value === DATASET_TYPE)) {
      return subject;
    }
  }
  return null;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return (await response.json()) as T;
}

function buildQueryUrl(limit: number, offset: number): string {
  const query = "rdfType:http\\://www.w3.org/ns/dcat#Dataset AND public:true";
  const encoded = encodeURIComponent(query);
  return `https://admin.dataportal.se/store/search?type=solr&query=${encoded}&limit=${limit}&offset=${offset}&sort=modified+desc`;
}

function summarizeEntry(entry: Entry): DatasetSummary | null {
  const subject = findDatasetSubject(entry);
  if (!subject) return null;

  const titles = getValues(entry, subject, PREDICATES.title);
  const descriptions = getValues(entry, subject, PREDICATES.description);
  const keywords = pickAllLiterals(getValues(entry, subject, PREDICATES.keyword));
  const themes = pickAllUris(getValues(entry, subject, PREDICATES.theme));
  const distributions = pickAllUris(getValues(entry, subject, PREDICATES.distribution));

  const titleSv = pickLiteral(titles, "sv");
  const titleEn = pickLiteral(titles, "en");
  const descriptionSv = pickLiteral(descriptions, "sv");
  const descriptionEn = pickLiteral(descriptions, "en");

  const reasons: string[] = [];
  if (themes.some((theme) => theme.includes("data-theme/ENVI"))) {
    reasons.push("Tema: ENVI");
  }
  const combined = [titleSv, titleEn, descriptionSv, descriptionEn, ...keywords].filter(Boolean).join(" ");
  if (combined && hasKeyword(combined)) {
    reasons.push("Matchar miljönyckelord");
  }

  return {
    contextId: entry.contextId,
    entryId: entry.entryId,
    uri: subject,
    titleSv,
    titleEn,
    descriptionSv,
    descriptionEn,
    keywords,
    themes,
    distributions,
    reasons,
  };
}

function toCsvRow(summary: DatasetSummary): string {
  const escape = (value: string | undefined) => {
    if (!value) return "";
    const sanitized = value.replace(/\"/g, "\"\"");
    return `"${sanitized}"`;
  };
  return [
    escape(summary.uri),
    escape(summary.titleSv ?? summary.titleEn),
    escape(summary.descriptionSv ?? summary.descriptionEn),
    escape(summary.keywords.join("; ")),
    escape(summary.themes.join("; ")),
    escape(summary.distributions.join("; ")),
    escape(summary.reasons.join("; ")),
  ].join(",");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = String(args.out ?? DEFAULT_OUT_DIR);
  const limit = toInt(args.limit, DEFAULT_LIMIT);
  const delayMs = toInt(args["delay-ms"], DEFAULT_DELAY_MS);
  const maxItems = toInt(args["max-items"], 0);
  const confirm = toBool(args.confirm, false);

  if (!confirm && maxItems === 0) {
    throw new Error("Refusing to run full scan without --confirm (set --max-items to limit).");
  }

  await ensureDir(outDir);

  const summaries: DatasetSummary[] = [];
  let offset = 0;
  let total = 0;
  let fetched = 0;

  while (true) {
    const url = buildQueryUrl(limit, offset);
    const data = await fetchJson<SearchResponse>(url);
    if (!total && typeof data.results === "number") {
      total = data.results;
    }
    const entries = data.resource?.children ?? [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const summary = summarizeEntry(entry);
      if (summary) summaries.push(summary);
    }

    fetched += entries.length;
    if (maxItems > 0 && fetched >= maxItems) break;

    offset += limit;
    if (total && offset >= total) break;
    await sleep(delayMs);
  }

  const envCandidates = summaries.filter((item) => item.reasons.length > 0);

  const manifest = {
    generatedAt: new Date().toISOString(),
    totalDatasetsSeen: summaries.length,
    totalEnvCandidates: envCandidates.length,
    limit,
    delayMs,
    maxItems: maxItems === 0 ? null : maxItems,
  };

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "env-candidates.json"), JSON.stringify(envCandidates, null, 2), "utf8");

  const csvHeader = [
    "uri",
    "title",
    "description",
    "keywords",
    "themes",
    "distributions",
    "reasons",
  ].join(",");
  const csvRows = envCandidates.map(toCsvRow);
  await fs.writeFile(path.join(outDir, "env-candidates.csv"), [csvHeader, ...csvRows].join("\n"), "utf8");

  console.log(`Done. Total datasets scanned: ${summaries.length}. Env candidates: ${envCandidates.length}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
