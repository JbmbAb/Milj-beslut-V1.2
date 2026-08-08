import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MASTER_DOCS = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Documents\\Sources';
const OUTPUT_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-inventory-manifest.json');

const CONCURRENCY_LIMIT = 15;

interface PDFMetadata {
  document_id: string;
  source_path: string;
  content_hash: string;
  file_size: number;
  modified_at: string;
  page_count: number;
  text_extractable: boolean;
  ocr_required: boolean;
  document_type: string;
  authority: string;
  document_date: string | null;
  case_number: string | null;
  title: string;
  language: string;
}

function parsePDFStats(filePath: string): { pageCount: number; textExtractable: boolean; ocrRequired: boolean } {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return { pageCount: 0, textExtractable: false, ocrRequired: true };
  }

  const stat = fs.fstatSync(fd);
  const size = stat.size;
  const buf = Buffer.alloc(Math.min(size, 1024 * 1024 * 5)); // Read up to first 5MB
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  const content = buf.toString('binary');

  let pageCount = 0;
  const countRegex = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g;
  let match;
  while ((match = countRegex.exec(content)) !== null) {
    pageCount = Math.max(pageCount, parseInt(match[1], 10));
  }

  if (pageCount === 0) {
    const pageInstances = content.match(/\/Type\s*\/Page\b/g);
    pageCount = pageInstances ? pageInstances.length : 1;
  }

  const hasFonts = content.includes('/Font ') || content.includes('/Font\n') || content.includes('/ToUnicode');
  const hasTextStream = content.includes('BT') && content.includes('ET');

  const textExtractable = hasFonts || hasTextStream;
  const ocrRequired = !textExtractable;

  return { pageCount, textExtractable, ocrRequired };
}

function inferClassification(fileName: string, contentSnippet: string): {
  document_type: string;
  authority: string;
  case_number: string | null;
  document_date: string | null;
} {
  const nameLower = fileName.toLowerCase();
  let document_type = 'unknown';
  let authority = 'Unknown';
  let case_number: string | null = null;
  let document_date: string | null = null;

  if (nameLower.includes('bbr')) {
    document_type = 'legal_document';
    authority = 'Boverket';
  } else if (nameLower.includes('beslut') || nameLower.includes('dom')) {
    document_type = 'court_decision';
    authority = nameLower.includes('möd') ? 'Mark- och miljööverdomstolen' : 'Mark- och miljödomstolen';
  } else if (nameLower.includes('mkb') || nameLower.includes('miljokonsekvens')) {
    document_type = 'MKB';
  } else if (nameLower.includes('kontrollprogram')) {
    document_type = 'administrative_document';
  } else if (nameLower.includes('teknisk') || nameLower.includes('geoteknik') || nameLower.includes('utredning')) {
    document_type = 'technical_report';
  } else if (nameLower.includes('karta') || nameLower.includes('ritning') || nameLower.includes('situationsplan')) {
    document_type = 'map';
  }

  const snippetLower = contentSnippet.toLowerCase();
  if (document_type === 'unknown') {
    if (snippetLower.includes('domslut') || snippetLower.includes('beslutar')) {
      document_type = 'court_decision';
    } else if (snippetLower.includes('miljökonsekvensbeskrivning')) {
      document_type = 'MKB';
    } else if (snippetLower.includes('teknisk beskrivning')) {
      document_type = 'technical_report';
    }
  }

  const caseRegex = /(?:bmn|mmd|möd|dom)-\d{4}-\d+|[a-z]{3}-\d{4}-\d+/gi;
  const caseMatch = fileName.match(caseRegex) || contentSnippet.match(caseRegex);
  if (caseMatch) {
    case_number = caseMatch[0].toUpperCase();
  }

  const dateRegex = /\b(19|20)\d{2}-\d{2}-\d{2}\b/g;
  const dateMatch = fileName.match(dateRegex) || contentSnippet.match(dateRegex);
  if (dateMatch) {
    document_date = dateMatch[0];
  }

  return { document_type, authority, case_number, document_date };
}

function collectPDFPaths(dir: string, list: string[] = []): string[] {
  if (!fs.existsSync(dir)) return list;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      collectPDFPaths(fullPath, list);
    } else if (f.toLowerCase().endsWith('.pdf')) {
      list.push(fullPath);
    }
  }
  return list;
}

async function hashFileAsync(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

async function processFile(filePath: string): Promise<PDFMetadata> {
  const stat = fs.statSync(filePath);
  const sha = await hashFileAsync(filePath);
  const id = `doc-${sha.slice(0, 16)}`;

  const { pageCount, textExtractable, ocrRequired } = parsePDFStats(filePath);

  // Read small snippet asynchronously
  const fd = fs.openSync(filePath, 'r');
  const snippetBuf = Buffer.alloc(2000);
  fs.readSync(fd, snippetBuf, 0, 2000, 0);
  fs.closeSync(fd);
  const snippet = snippetBuf.toString('binary');

  const fileName = path.basename(filePath);
  const { document_type, authority, case_number, document_date } = inferClassification(fileName, snippet);

  return {
    document_id: id,
    source_path: path.relative(MASTER_DOCS, filePath),
    content_hash: sha,
    file_size: stat.size,
    modified_at: stat.mtime.toISOString(),
    page_count: pageCount,
    text_extractable: textExtractable,
    ocr_required: ocrRequired,
    document_type,
    authority,
    document_date,
    case_number,
    title: path.basename(fileName, '.pdf'),
    language: 'sv'
  };
}

async function main() {
  console.log('Collecting PDF paths from GEO_Master_Archive...');
  const paths = collectPDFPaths(MASTER_DOCS);
  const total = paths.length;
  console.log(`Found ${total} PDF documents. Starting parallel ingestion pool (limit: ${CONCURRENCY_LIMIT})...`);

  const startTime = Date.now();
  const results: PDFMetadata[] = [];
  let processed = 0;

  // Simple concurrency pool
  const queue = [...paths];
  const workers = Array.from({ length: CONCURRENCY_LIMIT }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        const meta = await processFile(item);
        results.push(meta);
      } catch (err) {
        console.error(`[ERROR] Failed to process ${item}:`, err);
      } finally {
        processed++;
        if (processed % 20 === 0 || processed === total) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = processed / elapsed;
          const remaining = (total - processed) / speed;
          console.log(`[PROGRESS] Processed ${processed}/${total} (${((processed/total)*100).toFixed(1)}%) | Elapsed: ${elapsed.toFixed(0)}s | ETA: ${remaining.toFixed(0)}s`);
        }
      }
    }
  });

  await Promise.all(workers);
  const duration = (Date.now() - startTime) / 1000;

  // Aggregate stats
  const stats = {
    total_files: results.length,
    total_size_bytes: results.reduce((acc, f) => acc + f.file_size, 0),
    by_type: {} as Record<string, number>,
    text_extractable_count: results.filter(f => f.text_extractable).length,
    ocr_required_count: results.filter(f => f.ocr_required).length,
  };

  for (const doc of results) {
    stats.by_type[doc.document_type] = (stats.by_type[doc.document_type] || 0) + 1;
  }

  const payload = {
    manifest_id: 'document-inventory-manifest-v1',
    generated_at: new Date().toISOString(),
    duration_seconds: duration,
    stats,
    documents: results
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

  console.log('\n=== MANIFEST COMPLETED ===');
  console.log(`Scan Duration  : ${duration.toFixed(2)} seconds`);
  console.log(`Total Files    : ${payload.stats.total_files}`);
  console.log(`Total Size     : ${(payload.stats.total_size_bytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Text Extractable: ${payload.stats.text_extractable_count}`);
  console.log(`OCR Required    : ${payload.stats.ocr_required_count}`);
  console.log('Types Summary  :', payload.stats.by_type);
}

main().catch((err) => {
  console.error('[FATAL] Script failed:', err);
  process.exit(1);
});
