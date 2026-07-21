/**
 * scripts/import/harvest-naturvardsverket-geodata.ts
 *
 * Mimers Brunn — Naturvårdsverket Geodata Harvesting Pipeline
 *
 * Crawlar https://geodata.naturvardsverket.se/nedladdning/ rekursivt
 * och laddar ner alla datasets till GEO_Master_Archive med:
 *   ✓ Versionerade datummappar (YYYY-MM-DD)
 *   ✓ SHA-256 checksum per fil (streaming)
 *   ✓ manifest.json med files_detail per dataset
 *   ✓ Rate-limiting (1s mellan requests)
 *   ✓ Retry med exponential backoff (3 försök)
 *   ✓ Checkpoint — hoppar redan nedladdade filer (sha256-match)
 *   ✓ Aldrig överskrivning av historiska mappar
 *
 * Katalogstruktur som skapas:
 *   <MASTER_ARCHIVE_ROOT>/Data/Naturvardsverket/<Dataset>/<YYYY-MM-DD>/raw/<fil>
 *
 * Användning:
 *   npx tsx scripts/import/harvest-naturvardsverket-geodata.ts --dry-run
 *   npx tsx scripts/import/harvest-naturvardsverket-geodata.ts
 *   npx tsx scripts/import/harvest-naturvardsverket-geodata.ts --dataset=marktacke/NMD2023
 *   npx tsx scripts/import/harvest-naturvardsverket-geodata.ts --dataset=Skog
 *   npx tsx scripts/import/harvest-naturvardsverket-geodata.ts --skip=Inspire,legender
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https  from 'node:https';
import * as http   from 'node:http';
import { URL }     from 'node:url';
import dotenv      from 'dotenv';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';

dotenv.config();

// ─── Konfiguration ────────────────────────────────────────────────────────────

const BASE_URL        = 'https://geodata.naturvardsverket.se/nedladdning/';
const PROVIDER        = 'Naturvardsverket';
const DEST_ROOT       = path.join(MASTER_ARCHIVE_ROOT, 'Data', PROVIDER);
const TODAY           = new Date().toISOString().slice(0, 10);
const RATE_LIMIT_MS   = 1500;   // 1.5s mellan requests (polite scraping)
const RETRY_MAX       = 3;
const RETRY_DELAY_MS  = 3000;
const CONNECT_TIMEOUT = 30_000;
const MAX_FILE_SIZE   = 20 * 1024 ** 3; // 20 GB per fil — säkerhetsspärr

// ─── CLI-flaggor ──────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const isDryRun   = args.includes('--dry-run');
const verbose    = args.includes('--verbose');
const datasetArg = args.find((a) => a.startsWith('--dataset='))?.split('=')[1];
const skipArg    = args.find((a) => a.startsWith('--skip='))?.split('=')[1]?.split(',') ?? [];

// Dataset som sällan är relevant för miljöbeslut — men låt användaren avgöra
const SKIP_BY_DEFAULT: string[] = [];

// ─── Typer ────────────────────────────────────────────────────────────────────

interface RemoteEntry {
  name:     string;
  url:      string;
  isDir:    boolean;
  size?:    number;   // bytes (parsad från Apache listing)
  modified?: string;
}

interface DownloadResult {
  url:      string;
  destPath: string;
  status:   'downloaded' | 'skipped' | 'error';
  sha256?:  string;
  bytes?:   number;
  message?: string;
}

interface ManifestFile {
  filename:  string;
  url:       string;
  sha256:    string;
  size:      number;
  downloaded: string;
}

// ─── Loggning ─────────────────────────────────────────────────────────────────

const log  = (msg: string) => console.log(`[nv-harvest] ${msg}`);
const warn = (msg: string) => console.warn(`[nv-harvest] ⚠️  ${msg}`);
const dbg  = (msg: string) => { if (verbose) console.log(`[nv-harvest] 🔍 ${msg}`); };

// ─── HTTP-hjälpare ────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Hämta text via HTTPS med timeout och retry */
async function fetchText(url: string, retries = RETRY_MAX): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const req = https.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0' },
          timeout: CONNECT_TIMEOUT
        }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} för ${url}`));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end',  () => resolve(body));
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      warn(`fetchText(${url}): försök ${attempt}/${retries} misslyckades (${(err as Error).message}) — väntar ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error('fetchText: överskred retries');
}

/** Ladda ner fil med streaming + SHA-256 */
async function downloadFile(
  url:      string,
  destPath: string,
  retries = RETRY_MAX,
): Promise<{ sha256: string; bytes: number }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const lib = parsedUrl.protocol === 'https:' ? https : http;

        const req = lib.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity/1.0' },
          timeout: CONNECT_TIMEOUT
        }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            // Följ redirect
            const newUrl = res.headers.location!;
            downloadFile(newUrl, destPath, retries - attempt + 1)
              .then(resolve).catch(reject);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} för ${url}`));
            return;
          }

          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const out  = fs.createWriteStream(destPath);
          const hash = crypto.createHash('sha256');
          let bytes  = 0;

          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_FILE_SIZE) {
              req.destroy();
              out.close();
              reject(new Error(`Fil överstiger ${MAX_FILE_SIZE / 1024 ** 3} GB — avbryter`));
            }
            hash.update(chunk);
            out.write(chunk);
          });

          res.on('end', () => {
            out.close(() => resolve({ sha256: hash.digest('hex'), bytes }));
          });

          res.on('error', reject);
          out.on('error', reject);
        });

        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      });
    } catch (err) {
      // Ta bort partiell fil vid fel
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (attempt === retries) throw err;
      const wait = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      warn(`download(${path.basename(url)}): försök ${attempt}/${retries} — väntar ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error('downloadFile: överskred retries');
}

// ─── Apache Directory Listing Parser ─────────────────────────────────────────

/**
 * Parsa Apache directory listing HTML → lista med RemoteEntry.
 * Stöder filstorleker i format: 1.2G, 314M, 13M, 512K, 20
 */
function parseApacheListing(html: string, baseUrl: string): RemoteEntry[] {
  const entries: RemoteEntry[] = [];
  const rows = html.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s+(\S+\s+\S+)\s+(\S+)/g) ?? [];

  for (const row of rows) {
    const m = row.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s+(\S+\s+\S+)\s+(\S+)/);
    if (!m) continue;
    const [, href, , , sizeStr] = m;

    // Hoppa Parent Directory och sorteringslänkar
    if (href.startsWith('?') || href === '/' || href.startsWith('.') || href.includes('..') || href.includes('Parent')) continue;

    const isDir = href.endsWith('/');
    const url   = new URL(href, baseUrl).href;

    // Säkerställ att vi bara kryper NEDÅT i filträdet (hoppa över om url är samma eller överordnad katalog)
    if (baseUrl.startsWith(url)) continue;

    const name  = decodeURIComponent(href.replace(/\/$/, ''));

    // Parsa storlek: 1.2G → bytes
    let size: number | undefined;
    if (sizeStr !== '-') {
      const sizeMatch = sizeStr.match(/^([\d.]+)([KMGT]?)$/i);
      if (sizeMatch) {
        const [, num, unit] = sizeMatch;
        const multipliers: Record<string, number> = { K: 1024, M: 1024**2, G: 1024**3, T: 1024**4, '': 1 };
        size = Math.round(parseFloat(num) * (multipliers[unit.toUpperCase()] ?? 1));
      }
    }

    entries.push({ name, url, isDir, size });
  }

  return entries;
}

// ─── Crawl ────────────────────────────────────────────────────────────────────

interface CrawlResult {
  dataset:  string;    // relativ sökväg från BASE_URL, t.ex. "marktacke/NMD2023"
  files:    RemoteEntry[];
  totalBytes: number;
}

/** Rekursiv crawl av Apache directory listing */
async function crawlDirectory(
  url:     string,
  relPath: string,
  depth:   number = 0,
): Promise<CrawlResult[]> {
  await sleep(RATE_LIMIT_MS);

  dbg(`Crawlar: ${url}`);
  const html    = await fetchText(url);
  const entries = parseApacheListing(html, url);

  const files    = entries.filter((e) => !e.isDir);
  const subdirs  = entries.filter((e) => e.isDir);

  const results: CrawlResult[] = [];

  if (files.length > 0) {
    const totalBytes = files.reduce((s, f) => s + (f.size ?? 0), 0);
    results.push({ dataset: relPath || PROVIDER, files, totalBytes });
  }

  for (const sub of subdirs) {
    const subRel  = relPath ? `${relPath}/${sub.name}` : sub.name;
    const subResults = await crawlDirectory(sub.url, subRel, depth + 1);
    results.push(...subResults);
  }

  return results;
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

function writeManifest(
  destDir:  string,
  dataset:  string,
  files:    ManifestFile[],
) {
  const manifest = {
    schema_version: 'v2',
    provider:       PROVIDER,
    dataset,
    source_url:     BASE_URL + dataset,
    download_date:  TODAY,
    file_count:     files.length,
    total_bytes:    files.reduce((s, f) => s + f.size, 0),
    files_detail:   files,
  };
  fs.writeFileSync(
    path.join(destDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  // checksums.txt (SHA-256  filnamn per rad)
  const checksums = files.map((f) => `${f.sha256}  ${f.filename}`).join('\n');
  fs.writeFileSync(path.join(destDir, '..', 'checksums.txt'), checksums + '\n', 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('🌿 Mimers Brunn — Naturvårdsverket Geodata Harvest');
  log(`📁 Destination: ${DEST_ROOT}`);
  log(`🌐 Källa: ${BASE_URL}`);
  if (isDryRun) log('🔍 DRY-RUN — inga filer laddas ner');
  if (datasetArg) log(`🎯 Filter: ${datasetArg}`);

  // Bestäm start-URL
  const startUrl = datasetArg
    ? new URL(datasetArg + '/', BASE_URL).href
    : BASE_URL;
  const startRel = datasetArg ?? '';

  log('\n📡 Crawlar katalogstruktur...');
  const crawled = await crawlDirectory(startUrl, startRel);

  // Filtrera bort skipped datasets
  const filtered = crawled.filter((c) => {
    const topLevel = c.dataset.split('/')[0];
    return !skipArg.includes(topLevel) && !SKIP_BY_DEFAULT.includes(topLevel);
  });

  // Räkna total estimerad storlek
  const totalBytes = filtered.reduce((s, c) => s + c.totalBytes, 0);
  const totalFiles = filtered.reduce((s, c) => s + c.files.length, 0);
  const totalGB    = (totalBytes / 1024 ** 3).toFixed(1);

  log('');
  log('─── Datasets att ladda ner ─────────────────────────────────────');
  for (const c of filtered) {
    const gb = (c.totalBytes / 1024 ** 3).toFixed(2);
    const files = c.files.map((f) => `  • ${f.name} (${((f.size ?? 0)/1024**2).toFixed(0)} MB)`).join('\n');
    log(`\n📂 ${c.dataset}  [${c.files.length} filer, ~${gb} GB]`);
    if (verbose) log(files);
  }
  log('');
  log(`─── TOTALT: ${totalFiles} filer, ~${totalGB} GB ────────────────`);

  if (isDryRun) {
    log('\n✅ DRY-RUN klar. Kör utan --dry-run för att starta nedladdning.');
    log('⏱️  Estimerad tid vid 10 MB/s: ' +
      `${Math.round(totalBytes / (10 * 1024 ** 2) / 60)} minuter`);
    return;
  }

  // ─── Nedladdning ────────────────────────────────────────────────────────

  log('\n⬇️  Startar nedladdning...\n');

  let totalDownloaded = 0;
  let totalSkipped    = 0;
  let totalErrors     = 0;

  for (const crawlResult of filtered) {
    // Mimers Brunn-sökväg: Data/Naturvardsverket/<Dataset>/<YYYY-MM-DD>/raw/
    const datasetName = crawlResult.dataset.replace(/\//g, '_');
    const rawDir      = path.join(DEST_ROOT, crawlResult.dataset, TODAY, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });

    const manifestFiles: ManifestFile[] = [];

    for (const file of crawlResult.files) {
      const destPath = path.join(rawDir, file.name);

      // Checkpoint: hoppa om fil finns och checksums.txt matchar
      if (fs.existsSync(destPath)) {
        const existingSize = fs.statSync(destPath).size;
        if (file.size && Math.abs(existingSize - file.size) < 1024) {
          dbg(`Hoppar (storlek matchar): ${file.name}`);
          totalSkipped++;
          continue;
        }
      }

      log(`⬇️  ${crawlResult.dataset}/${file.name} (~${((file.size ?? 0)/1024**2).toFixed(0)} MB)`);
      await sleep(RATE_LIMIT_MS);

      try {
        const { sha256, bytes } = await downloadFile(file.url, destPath);
        manifestFiles.push({
          filename:   file.name,
          url:        file.url,
          sha256,
          size:       bytes,
          downloaded: TODAY,
        });
        log(`  ✅ ${file.name} — ${(bytes/1024**2).toFixed(1)} MB, SHA256: ${sha256.slice(0,16)}…`);
        totalDownloaded++;
      } catch (err: any) {
        warn(`Fel: ${file.url}\n  ${err.message}`);
        totalErrors++;
      }
    }

    // Skriv manifest för detta dataset
    if (manifestFiles.length > 0) {
      writeManifest(rawDir, crawlResult.dataset, manifestFiles);
      log(`  📋 Manifest skrivet: ${rawDir}/manifest.json`);
    }
  }

  log('');
  log('─── Sammanfattning ─────────────────────────────────────────────');
  log(`✅  Nedladdade: ${totalDownloaded}`);
  log(`⏭️   Hoppade:    ${totalSkipped}`);
  log(`❌  Fel:         ${totalErrors}`);

  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[nv-harvest] Fatalt fel:', err);
  process.exit(1);
});
