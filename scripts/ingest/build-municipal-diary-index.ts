import { promises as fs } from "node:fs";
import path from "node:path";

const SOURCE_URL = "https://skr.se/kommunerochregioner/kommunerlista.8288.html";
const DEFAULT_OUT_DIR = path.join("storage", "ingest", "legal", "kommunala-diarier");
const REQUEST_HEADERS = {
  Accept: "text/html, */*",
  "User-Agent": "Miljobeslut/2.0 (+https://miljobeslut.se)",
};

type Args = Record<string, string | boolean>;

type KommunRow = {
  kommun: string;
  kommunWebb: string;
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

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return await response.text();
}

function extractKommuner(html: string): KommunRow[] {
  const startMarker = 'id="h-Adressertillkommunerna"';
  const startIndex = html.indexOf(startMarker);
  if (startIndex === -1) {
    throw new Error("Start marker not found in source HTML.");
  }
  const slice = html.slice(startIndex);
  const endIndex = slice.indexOf("</div></div>");
  const block = endIndex === -1 ? slice : slice.slice(0, endIndex);

  const regex = /<a href="(http[^"]+)"[^>]*>([^<]+)<svg/gi;
  const rows: KommunRow[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block))) {
    const url = decodeEntities(match[1]).trim();
    const name = decodeEntities(match[2]).trim();
    if (!name || !url) continue;
    const key = `${name}::${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kommun: name, kommunWebb: url });
  }
  return rows;
}

function csvEscape(value: string): string {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/\"/g, "\"\"")}"`;
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = String(args.out ?? DEFAULT_OUT_DIR);

  await ensureDir(outDir);
  const sourceDir = path.join(outDir, "source");
  await ensureDir(sourceDir);

  const html = await fetchHtml(SOURCE_URL);
  await fs.writeFile(path.join(sourceDir, "kommunerlista.html"), html, "utf8");

  const kommuner = extractKommuner(html);
  if (kommuner.length === 0) {
    throw new Error("No municipalities found in source HTML.");
  }

  const csvHeader = [
    "kommun",
    "kommun_webb",
    "diarie_url",
    "diarie_typ",
    "notes",
    "source_url",
  ];
  const lines = [csvHeader.join(",")];
  for (const row of kommuner) {
    lines.push(
      [
        csvEscape(row.kommun),
        csvEscape(row.kommunWebb),
        "",
        "",
        "",
        csvEscape(SOURCE_URL),
      ].join(",")
    );
  }

  await fs.writeFile(path.join(outDir, "index.csv"), lines.join("\n"), "utf8");

  const manifest = {
    source: "kommunala-diarier",
    sourceUrl: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    count: kommuner.length,
  };
  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log(`Done. Kommuner: ${kommuner.length}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
