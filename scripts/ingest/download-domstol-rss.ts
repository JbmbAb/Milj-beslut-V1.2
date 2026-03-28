import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_OUT_DIR = path.join("storage", "ingest", "legal", "domstol-rss");
const DEFAULT_DELAY_MS = 200;
const DEFAULT_MAX_ITEMS = 200;
const REQUEST_HEADERS = {
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "User-Agent": "Miljobeslut/2.0 (+https://miljobeslut.se)",
};
const BINARY_HEADERS = {
  Accept: "*/*",
  "User-Agent": "Miljobeslut/2.0 (+https://miljobeslut.se)",
};

type Args = Record<string, string | boolean>;

type RssItem = {
  guid?: string;
  link?: string;
  title?: string;
  pubDate?: string;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function slugify(value: string): string {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return undefined;
  return decodeEntities(normalizeWhitespace(match[1]));
}

function extractItemsFromRss(xml: string): RssItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => ({
    guid: extractTag(item, "guid"),
    link: extractTag(item, "link"),
    title: extractTag(item, "title"),
    pubDate: extractTag(item, "pubDate"),
  }));
}

function extractPdfLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href=["']([^"']+?\.pdf[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl).toString();
      links.push(url);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return Array.from(new Set(links));
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return await response.text();
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { headers: BINARY_HEADERS });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = String(args.out ?? DEFAULT_OUT_DIR);
  const delayMs = toInt(args["delay-ms"], DEFAULT_DELAY_MS);
  const maxItems = toInt(args["max-items"], DEFAULT_MAX_ITEMS);
  const downloadPages = toBool(args["download-pages"], true);
  const downloadPdfs = toBool(args["download-pdfs"], false);
  const confirm = toBool(args.confirm, false);
  const feedUrlArg = typeof args["feed-url"] === "string" ? String(args["feed-url"]) : "";

  if (!feedUrlArg) {
    throw new Error("Missing --feed-url.");
  }
  if (!confirm && maxItems === 0) {
    throw new Error("Refusing to run without --max-items unless --confirm is set.");
  }
  if (!confirm && downloadPdfs) {
    throw new Error("Refusing to download PDFs without --confirm.");
  }

  const feedUrls = feedUrlArg
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (feedUrls.length === 0) {
    throw new Error("No feed URLs provided.");
  }

  await ensureDir(outDir);
  const feedDir = path.join(outDir, "feeds");
  const metaDir = path.join(outDir, "metadata");
  const pageDir = path.join(outDir, "pages");
  const pdfDir = path.join(outDir, "pdfs");
  const manifestPath = path.join(outDir, "manifest.json");
  const errorLogPath = path.join(outDir, "errors.log");

  await ensureDir(feedDir);
  await ensureDir(metaDir);
  if (downloadPages) await ensureDir(pageDir);
  if (downloadPdfs) await ensureDir(pdfDir);

  const manifest = {
    source: "domstol-rss",
    feedUrls,
    generatedAt: new Date().toISOString(),
    maxItems,
    downloadPages,
    downloadPdfs,
    delayMs,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  for (const feedUrl of feedUrls) {
    const slug = slugify(feedUrl);
    const feedPath = path.join(feedDir, `${slug}.xml`);
    const metadataPath = path.join(metaDir, `${slug}.json`);
    const feedXml = await fetchText(feedUrl);
    await fs.writeFile(feedPath, feedXml, "utf8");

    const items = extractItemsFromRss(feedXml);
    const limitedItems = maxItems > 0 ? items.slice(0, maxItems) : items;
    await fs.writeFile(metadataPath, JSON.stringify(limitedItems, null, 2), "utf8");

    if (!downloadPages) continue;

    const feedPageDir = path.join(pageDir, slug);
    await ensureDir(feedPageDir);
    const feedPdfDir = path.join(pdfDir, slug);
    if (downloadPdfs) await ensureDir(feedPdfDir);

    for (const item of limitedItems) {
      if (!item.link) continue;
      const safeGuid = slugify(item.guid ?? item.link);
      const pagePath = path.join(feedPageDir, `${safeGuid}.html`);
      try {
        await fs.access(pagePath);
        continue;
      } catch {
        // Continue to download.
      }

      let html = "";
      try {
        html = await fetchText(item.link);
        await fs.writeFile(pagePath, html, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await fs.appendFile(errorLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
        continue;
      }

      if (!downloadPdfs || html.length === 0) {
        await sleep(delayMs);
        continue;
      }

      const pdfLinks = extractPdfLinks(html, item.link);
      for (const pdfLink of pdfLinks) {
        const pdfName = slugify(pdfLink).slice(0, 120) || "document";
        const pdfPath = path.join(feedPdfDir, `${safeGuid}-${pdfName}.pdf`);
        try {
          await fs.access(pdfPath);
          continue;
        } catch {
          // Missing.
        }
        try {
          await downloadFile(pdfLink, pdfPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await fs.appendFile(errorLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
        }
        await sleep(delayMs);
      }
    }
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
