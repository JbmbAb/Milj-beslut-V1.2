import fs from 'node:fs/promises';
import path from 'node:path';

type RecordSummary = {
  id: string;
  title: string;
};

type RecordWithLinks = {
  id: string;
  title: string;
  links: string[];
};

const BASE_CSW = 'https://ext-geodatakatalog.lansstyrelsen.se/GeodataKatalogen/srv/swe/csw';
const BATCH_SIZE = Number(process.env.LST_CSW_BATCH_SIZE || '100');
const MAX_RECORDS = Number(process.env.LST_CSW_MAX_RECORDS || '0');
const CONCURRENCY = Number(process.env.LST_CSW_CONCURRENCY || '6');

const SERVICE_URL_PATTERN =
  /(arcgis|mapserver|featureserver|wms|wfs|wmts|wcs|ows|geoserver|download|zip|gpkg|geojson|rest\/services|opendata|api)/i;
const NOISE_URL_PATTERN =
  /(schemas\.opengis\.net|isotc211\.org|standards\.iso\.org|w3\.org|fao\.org\/geonetwork|loc\.gov\/standards|metagis\.se\/.*codelist|geodatakatalog-forv\.lansstyrelsen\.se\/GeodataKatalogen\/codelist)/i;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cswGetUrl(params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  return `${BASE_CSW}?${q.toString()}`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

function extractTotalMatched(xml: string): number {
  const m = xml.match(/numberOfRecordsMatched="(\d+)"/);
  return m ? Number(m[1]) : 0;
}

function extractSummaryRecords(xml: string): RecordSummary[] {
  const records: RecordSummary[] = [];
  const summaryBlocks = xml.match(/<csw:SummaryRecord[\s\S]*?<\/csw:SummaryRecord>/g) || [];
  for (const block of summaryBlocks) {
    const idMatch = block.match(/<dc:identifier>([\s\S]*?)<\/dc:identifier>/);
    const titleMatch = block.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
    if (!idMatch) continue;
    records.push({
      id: decodeXml(idMatch[1].trim()),
      title: decodeXml((titleMatch?.[1] || '').trim()),
    });
  }
  return records;
}

function extractTitleFromFullRecord(xml: string): string | null {
  const m = xml.match(
    /<gmd:title>[\s\S]*?<gco:CharacterString>([\s\S]*?)<\/gco:CharacterString>[\s\S]*?<\/gmd:title>/,
  );
  return m ? decodeXml(m[1].trim()) : null;
}

function extractServiceLinks(xml: string): string[] {
  const all = Array.from(xml.matchAll(/https?:\/\/[^\s"<)]+/g), (m) => m[0]);
  const cleaned = all
    .map((u) => u.replace(/&amp;/g, '&'))
    .map((u) => u.replace(/[\],.;]+$/, ''))
    .filter((u) => !NOISE_URL_PATTERN.test(u))
    .filter((u) => SERVICE_URL_PATTERN.test(u));
  return Array.from(new Set(cleaned));
}

async function fetchFullRecordWithLinks(summary: RecordSummary): Promise<RecordWithLinks | null> {
  const url = cswGetUrl({
    service: 'CSW',
    version: '2.0.2',
    request: 'GetRecordById',
    elementSetName: 'full',
    id: summary.id,
    outputSchema: 'http://www.isotc211.org/2005/gmd',
  });
  try {
    const xml = await fetchText(url);
    const links = extractServiceLinks(xml);
    if (links.length === 0) return null;
    const fullTitle = extractTitleFromFullRecord(xml);
    return {
      id: summary.id,
      title: fullTitle || summary.title || summary.id,
      links,
    };
  } catch (error) {
    console.warn(`skip ${summary.id}: ${(error as Error).message}`);
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toMarkdown(records: RecordWithLinks[], generatedAt: string): string {
  const lines: string[] = [];
  lines.push('# Länsstyrelsernas geodatakatalog - tjänstelänkar');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Records with links: ${records.length}`);
  lines.push('');
  lines.push('| ID | Titel | Länkar |');
  lines.push('| --- | --- | --- |');
  for (const record of records) {
    const links = record.links.map((u) => `[lank](${u})`).join('<br>');
    const safeTitle = record.title.replace(/\|/g, '\\|');
    lines.push(`| ${record.id} | ${safeTitle} | ${links} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const firstUrl = cswGetUrl({
    service: 'CSW',
    version: '2.0.2',
    request: 'GetRecords',
    resultType: 'results',
    typeNames: 'csw:Record',
    elementSetName: 'summary',
    startPosition: '1',
    maxRecords: '1',
  });
  const firstXml = await fetchText(firstUrl);
  const totalMatched = extractTotalMatched(firstXml);
  const target = MAX_RECORDS > 0 ? Math.min(MAX_RECORDS, totalMatched) : totalMatched;

  console.log(`totalMatched=${totalMatched} target=${target}`);

  const summaries: RecordSummary[] = [];
  for (let start = 1; start <= target; start += BATCH_SIZE) {
    const batch = Math.min(BATCH_SIZE, target - start + 1);
    const url = cswGetUrl({
      service: 'CSW',
      version: '2.0.2',
      request: 'GetRecords',
      resultType: 'results',
      typeNames: 'csw:Record',
      elementSetName: 'summary',
      startPosition: String(start),
      maxRecords: String(batch),
    });
    const xml = await fetchText(url);
    const extracted = extractSummaryRecords(xml);
    summaries.push(...extracted);
    console.log(`summary ${start}-${start + batch - 1}: ${extracted.length}`);
  }

  console.log(`summaries=${summaries.length}`);

  const fullRecords = await mapWithConcurrency(summaries, CONCURRENCY, async (summary, idx) => {
    if ((idx + 1) % 100 === 0) {
      console.log(`full ${idx + 1}/${summaries.length}`);
    }
    return await fetchFullRecordWithLinks(summary);
  });

  const withLinks = fullRecords.filter((r): r is RecordWithLinks => r !== null);

  const outDir = path.join(process.cwd(), 'knowledge-base', 'lansstyrelsen-geodata');
  await fs.mkdir(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const jsonPath = path.join(outDir, 'service-links.json');
  const mdPath = path.join(outDir, 'service-links.md');

  await fs.writeFile(
    jsonPath,
    JSON.stringify({ generatedAt, totalMatched, target, records: withLinks }, null, 2),
    'utf8',
  );
  await fs.writeFile(mdPath, toMarkdown(withLinks, generatedAt), 'utf8');

  console.log(`done recordsWithLinks=${withLinks.length}`);
  console.log(`json=${jsonPath}`);
  console.log(`md=${mdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
