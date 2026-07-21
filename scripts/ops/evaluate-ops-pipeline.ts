/**
 * Skannar Miljobeslut_Ops_Pipeline/storage (geodatafiler), sorterar och utvärderar
 * relevans för miljö-/kultur-/juridikunderlag, och skriver en migreringsrapport.
 *
 * PostGIS-migration av själva geometrin görs med GDAL ogr2ogr (se utdata för exempelkommando).
 *
 * Användning:
 *   npm run ops:evaluate
 *   OPS_PIPELINE_ROOT=C:\\path\\Miljobeslut_Ops_Pipeline npm run ops:evaluate -- --out reports/ops-eval.json
 *
 * Efter utvärdering: kör `npm run db:spatial` så 003_staging_ops_pipeline.sql appliceras om den inte redan finns.
 */

import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

const SPATIAL_EXT = new Set([
  'gpkg',
  'geojson',
  'json',
  'shp',
  'kml',
  'gml',
  'zip',
  'tif',
  'tiff',
  'geotiff',
]);

const POSITIVE_KEYWORDS: Array<{ re: RegExp; weight: number; hint: string }> = [
  { re: /arkeolog|forn|kultur|lamning|raa|ksamsok/i, weight: 18, hint: 'culture' },
  { re: /milj[oö]|h[aä]nsyn|natur|nvr|skydd|reservat|natura/i, weight: 16, hint: 'env' },
  { re: /vatten|avrinn|hydro|grundvatten|hav|smhi|msb|oversvamn|översvämn/i, weight: 14, hint: 'env' },
  { re: /sgu|jordart|landskred|ravin|berggrund/i, weight: 14, hint: 'env' },
  { re: /lantmater|fastigh|detaljplan|biotop|markt[aä]cke/i, weight: 12, hint: 'env' },
  { re: /domstol|r[aä]tt|praxis|forordn|miljobalk/i, weight: 10, hint: 'legal' },
  { re: /kommun|l[aä]nsstyrel|diarie/i, weight: 8, hint: 'legal' },
];

const NEGATIVE_HINT = /faktura|leverant[oö]r|reskontra|ink[oö]p|ekonomi|personal|l[oö]nek/i;

export type EvaluationTier = 'migrate' | 'review' | 'skip';

export type OpsFileEvaluation = {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  score: number;
  tier: EvaluationTier;
  matchedKeywords: string[];
  suggestedTargetSchema: 'culture' | 'env' | 'legal' | 'staging';
  providerHint?: string;
  notes: string[];
  ogr2ogrHint?: string;
};

function scorePath(
  filePath: string,
  baseName: string,
): {
  score: number;
  matched: string[];
  suggested: 'culture' | 'env' | 'legal' | 'staging';
  providerHint?: string;
} {
  const hay = `${filePath}/${baseName}`;
  let score = 0;
  const matched: string[] = [];
  const schemaWeights: Record<string, number> = { culture: 0, env: 0, legal: 0 };

  const ext = path.extname(baseName).replace(/^\./, '').toLowerCase();
  if (SPATIAL_EXT.has(ext)) {
    score += ext === 'gpkg' ? 28 : ext === 'geojson' || ext === 'json' ? 22 : 12;
  }

  if (NEGATIVE_HINT.test(hay)) {
    score -= 25;
    matched.push('negative_admin_finance_signal');
  }

  for (const { re, weight, hint } of POSITIVE_KEYWORDS) {
    if (re.test(hay)) {
      score += weight;
      matched.push(re.source);
      if (hint === 'culture') schemaWeights.culture += weight;
      if (hint === 'env') schemaWeights.env += weight;
      if (hint === 'legal') schemaWeights.legal += weight;
    }
  }

  if (/(dataportal|portfolio|ingest|legal)/i.test(hay)) score += 6;

  let suggested: 'culture' | 'env' | 'legal' | 'staging' = 'staging';
  const top = Object.entries(schemaWeights).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) {
    suggested = top[0] as 'culture' | 'env' | 'legal';
  }

  const providerHint = top && top[1] > 0 ? top[0] : undefined;
  return { score, matched, suggested, providerHint };
}

function toTier(score: number): EvaluationTier {
  if (score >= 42) return 'migrate';
  if (score >= 22) return 'review';
  return 'skip';
}

async function walkFiles(root: string, sub: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = path.join(sub, e.name);
    const abs = path.join(root, rel);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out.push(...(await walkFiles(root, rel)));
    } else {
      out.push(abs);
    }
  }
  return out;
}

function buildOgrHint(rel: string, tier: EvaluationTier, _suggested: string): string | undefined {
  if (tier === 'skip') return undefined;
  const safe = rel.replace(/[^a-zA-Z0-9_/.-]+/g, '_').slice(0, 120);
  const table = `staging.ops_${safe.replace(/\//g, '_').replace(/\./g, '_')}`.slice(0, 63);
  return (
    `ogr2ogr -f PostgreSQL "PG:host=... dbname=... user=... password=..." ` +
    `"<OPS_ROOT>/${rel}" -nln ${table} -overwrite -t_srs EPSG:3006 -lco GEOMETRY_NAME=geom`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let outPath = '';
  let prefix = '';
  const storageOnly = args.includes('--storage-only');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outPath = args[++i];
    if (args[i] === '--prefix' && args[i + 1]) prefix = args[++i].replace(/\\/g, '/');
  }

  const cwd = process.cwd();
  const defaultRoot = path.resolve(cwd, '..', 'Miljobeslut_Ops_Pipeline');
  const opsRoot = process.env.OPS_PIPELINE_ROOT ? path.resolve(process.env.OPS_PIPELINE_ROOT) : defaultRoot;

  let scanRoot = opsRoot;
  if (storageOnly) {
    scanRoot = path.join(opsRoot, 'storage');
  }
  if (prefix) {
    scanRoot = path.join(scanRoot, prefix);
  }

  let allFiles: string[] = [];
  try {
    await fs.access(scanRoot);
    allFiles = await walkFiles(scanRoot, '');
  } catch {
    console.error(`Kunde inte läsa: ${scanRoot}`);
    process.exit(1);
  }

  const candidates: OpsFileEvaluation[] = [];

  for (const abs of allFiles) {
    const ext = path.extname(abs).replace(/^\./, '').toLowerCase();
    if (!SPATIAL_EXT.has(ext)) continue;

    const rel = path.relative(opsRoot, abs).replace(/\\/g, '/');
    const st = await fs.stat(abs);
    const { score, matched, suggested, providerHint } = scorePath(rel, path.basename(abs));
    const tier = toTier(score);
    const notes: string[] = [];
    if (tier === 'migrate')
      notes.push('Maskinellt stark kandidat för PostGIS-import efter manuell spot-check.');
    if (tier === 'review')
      notes.push('Granska licens, uppdatering och faktisk geometrikvalitet före import.');
    if (tier === 'skip') notes.push('Låg signal — arkivera eller ignorera om inte manuellt motiverad.');

    candidates.push({
      absolutePath: abs,
      relativePath: rel,
      extension: ext,
      sizeBytes: st.size,
      score,
      tier,
      matchedKeywords: matched,
      suggestedTargetSchema: suggested,
      providerHint,
      notes,
      ogr2ogrHint: buildOgrHint(rel, tier, suggested),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const summary = {
    generatedAt: new Date().toISOString(),
    opsRoot,
    scanRoot,
    totalFilesScanned: allFiles.length,
    spatialCandidates: candidates.length,
    byTier: {
      migrate: candidates.filter((c) => c.tier === 'migrate').length,
      review: candidates.filter((c) => c.tier === 'review').length,
      skip: candidates.filter((c) => c.tier === 'skip').length,
    },
    nextSteps: [
      '1) Granska tier=migrate och review manuellt (licens, personuppgifter, aktualitet).',
      '2) Säkerställ att prisma/spatial/003_staging_ops_pipeline.sql körts (npm run db:spatial).',
      '3) Importera vald fil med ogr2ogr till staging.ops_* eller generera INSERT via GDAL.',
      '4) Efter QA: flytta till env/culture/legal enligt domänmodell (se legalSourceIngestService inferPostgisTarget).',
    ],
    candidates,
  };

  const json = JSON.stringify(summary, null, 2);
  if (outPath) {
    const resolved = path.isAbsolute(outPath) ? outPath : path.join(cwd, outPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, json, 'utf8');
    console.log(`Skrev rapport: ${resolved}`);
  } else {
    console.log(json);
  }

  console.error(
    `\nSammanfattning: migrate=${summary.byTier.migrate} review=${summary.byTier.review} skip=${summary.byTier.skip} (geodatafiler under ${scanRoot})\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
