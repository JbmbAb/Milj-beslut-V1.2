import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://rattspraxis.etjanst.domstol.se";
const DEFAULT_OUT_DIR = path.join("storage", "ingest", "legal", "rattspraxis");
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_DELAY_MS = 200;
const DEFAULT_MAX_PAGES = 2;
const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Miljobeslut/2.0 (+https://miljobeslut.se)",
};
const BINARY_HEADERS = {
  Accept: "*/*",
  "User-Agent": "Miljobeslut/2.0 (+https://miljobeslut.se)",
};

type Args = Record<string, string | boolean>;

type State = {
  totalItems: number;
  domstolar: Record<string, { lastPage: number; totalItems: number }>;
};

type PubliceringBilaga = {
  fillagringId?: string;
  filnamn?: string;
};

type Publicering = {
  id?: string;
  bilagaLista?: PubliceringBilaga[];
  rattsomradeLista?: string[];
};

type DomstolDTO = {
  domstolKod?: string;
  domstolNamn?: string;
};

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

function padNumber(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "attachment.bin";
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchDomstolar(baseUrl: string): Promise<DomstolDTO[]> {
  const url = `${baseUrl}/api/v1/domstolar`;
  return await fetchJson<DomstolDTO[]>(url);
}

function parseCsv(value: string | boolean | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function matchesPattern(value: string, pattern: string): boolean {
  return normalizeText(value).includes(normalizeText(pattern));
}

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isMiljomal(item: Publicering): boolean {
  return (item.rattsomradeLista ?? []).some((entry) => normalizeText(entry).includes("miljomal"));
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { headers: BINARY_HEADERS });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function loadState(statePath: string): Promise<State | null> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as State;
  } catch {
    return null;
  }
}

async function saveState(statePath: string, state: State): Promise<void> {
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = String(args["out"] ?? DEFAULT_OUT_DIR);
  const baseUrl = String(args["base-url"] ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const pageSize = toInt(args["page-size"], DEFAULT_PAGE_SIZE);
  const delayMs = toInt(args["delay-ms"], DEFAULT_DELAY_MS);
  const maxPages = toInt(args["max-pages"], DEFAULT_MAX_PAGES);
  const resume = toBool(args.resume, false);
  const downloadBilagor = toBool(args["download-bilagor"], false);
  const splitMiljomal = toBool(args["split-miljomal"], false);
  const confirm = toBool(args.confirm, false);
  const domstolPattern = typeof args["domstol-pattern"] === "string" ? String(args["domstol-pattern"]) : "";
  const domstolKoder = parseCsv(args["domstol-koder"]);

  if (!confirm && downloadBilagor) {
    throw new Error("Refusing to download attachments without --confirm.");
  }
  if (!confirm && maxPages === 0) {
    throw new Error("Refusing to run without --max-pages unless --confirm is set.");
  }

  const statePath = path.join(outDir, "state.json");
  const manifestPath = path.join(outDir, "manifest.json");
  const errorLogPath = path.join(outDir, "errors.log");
  const resolveBaseDir = (bucket: "miljomal" | "ovrigt") => (splitMiljomal ? path.join(outDir, bucket) : outDir);

  await ensureDir(outDir);

  let domstolList: DomstolDTO[] = [];
  if (domstolPattern || domstolKoder.length > 0) {
    domstolList = await fetchDomstolar(baseUrl);
  }

  let targets: Array<{ codeKey: string; domstolKod?: string; domstolNamn?: string }> = [];
  if (domstolKoder.length > 0) {
    targets = domstolKoder.map((code) => {
      const match = domstolList.find((item) => item.domstolKod === code);
      return { codeKey: code, domstolKod: code, domstolNamn: match?.domstolNamn };
    });
  } else if (domstolPattern) {
    targets = domstolList
      .filter((item) => item.domstolKod && item.domstolNamn && matchesPattern(item.domstolNamn, domstolPattern))
      .map((item) => ({
        codeKey: String(item.domstolKod),
        domstolKod: String(item.domstolKod),
        domstolNamn: item.domstolNamn,
      }));
  } else {
    targets = [{ codeKey: "all" }];
  }

  const manifest = {
    source: "rattspraxis",
    baseUrl,
    generatedAt: new Date().toISOString(),
    pageSize,
    delayMs,
    maxPages,
    downloadBilagor,
    splitMiljomal,
    domstolPattern: domstolPattern || null,
    domstolKoder: domstolKoder.length > 0 ? domstolKoder : null,
    domstolTargets: targets.map((item) => ({ code: item.domstolKod ?? null, name: item.domstolNamn ?? null })),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const state = (resume ? await loadState(statePath) : null) ?? { totalItems: 0, domstolar: {} };
  let totalPagesProcessed = 0;

  for (const target of targets) {
    const key = target.codeKey;
    const targetState = state.domstolar[key] ?? { lastPage: 0, totalItems: 0 };
    let page = targetState.lastPage + 1;
    let pagesProcessed = 0;

    while (true) {
      if (maxPages > 0 && pagesProcessed >= maxPages) break;

    const domstolQuery = target.domstolKod ? `&domstolkod=${encodeURIComponent(target.domstolKod)}` : "";
    const url = `${baseUrl}/api/v1/publiceringar?page=${page}&pagesize=${pageSize}&asc=true${domstolQuery}`;
    const data = await fetchJson<Publicering[]>(url);
    if (!Array.isArray(data) || data.length === 0) break;

      const buckets: Record<"miljomal" | "ovrigt", Publicering[]> = splitMiljomal
        ? {
            miljomal: data.filter((item) => isMiljomal(item)),
            ovrigt: data.filter((item) => !isMiljomal(item)),
          }
        : { miljomal: [], ovrigt: data };

      for (const [bucket, items] of Object.entries(buckets) as Array<["miljomal" | "ovrigt", Publicering[]]>) {
        if (items.length === 0) continue;
        const bucketBaseDir = resolveBaseDir(bucket);
        const bucketMetaDir = path.join(bucketBaseDir, "metadata", key);
        await ensureDir(bucketMetaDir);
        const pageFile = path.join(bucketMetaDir, `page-${padNumber(page, 6)}.json`);
        await fs.writeFile(pageFile, JSON.stringify(items, null, 2), "utf8");

        if (downloadBilagor) {
          const bucketAttachmentsDir = path.join(bucketBaseDir, "attachments");
          await ensureDir(bucketAttachmentsDir);
          for (const item of items) {
            for (const bilaga of item.bilagaLista ?? []) {
              if (!bilaga.fillagringId) continue;
              const folder = path.join(bucketAttachmentsDir, bilaga.fillagringId);
              await ensureDir(folder);
              const fileName = sanitizeFileName(bilaga.filnamn ?? `${item.id ?? "attachment"}.bin`);
              const filePath = path.join(folder, fileName);
              try {
                await fs.access(filePath);
                continue;
              } catch {
                // File missing, continue to download.
              }
              const fileUrl = `${baseUrl}/api/v1/bilagor/${bilaga.fillagringId
                .split("/")
                .map((segment) => encodeURIComponent(segment))
                .join("/")}`;
              try {
                await downloadFile(fileUrl, filePath);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await fs.appendFile(errorLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
              }
              await sleep(delayMs);
            }
          }
        }
      }

      targetState.lastPage = page;
      targetState.totalItems += data.length;
      state.totalItems += data.length;
      state.domstolar[key] = targetState;
      await saveState(statePath, state);

      pagesProcessed += 1;
      totalPagesProcessed += 1;
      page += 1;
      await sleep(delayMs);
    }
  }

  console.log(`Done. Pages processed: ${totalPagesProcessed}. Items: ${state.totalItems}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
