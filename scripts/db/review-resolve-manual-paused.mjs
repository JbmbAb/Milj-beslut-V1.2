/**
 * Resolve the 55 paused manual_review rows (approved=false) in CSV.
 *
 * Run: node scripts/db/review-resolve-manual-paused.mjs [--dry-run]
 * Then: node scripts/db/review-promote-from-csv.mjs --csv=storage/manifests/review-manual-review-batch3.csv
 *       node scripts/db/review-promote-from-csv.mjs --csv=storage/manifests/review-manual-review-batch3.csv --execute
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, 'storage/manifests/review-manual-review-proposal.csv');
const BATCH3_CSV = path.join(ROOT, 'storage/manifests/review-manual-review-batch3.csv');
const REPORT = path.join(ROOT, 'storage/manifests/review-manual-resolved-report.json');
const DRY_RUN = process.argv.includes('--dry-run');

/** @type {Record<string, { provider: string, dataset: string, action: 'promote'|'promote_kommun'|'quarantine', confidence: 'high'|'med'|'low', rationale: string }>} */
const RESOLUTIONS = {
  Värdetrakter: {
    provider: 'Naturvardsverket',
    dataset: 'Vardetrakter',
    action: 'promote',
    confidence: 'high',
    rationale: 'NV värdeområden/trakter — namn och filvolym matchar känt NV-dataset.',
  },
  STRÖMSUND: kommun('STRÖMSUND'),
  kramfors: kommun('kramfors'),
  RAGUNDA: kommun('RAGUNDA'),
  'goteborg-skredriskkartering-2005': {
    provider: 'Lantmateriet',
    dataset: 'KommunHistorik/goteborg-skredriskkartering-2005',
    action: 'promote_kommun',
    confidence: 'med',
    rationale: 'Kommunal skredriskkartering (Göteborg 2005) — historisk kommundata.',
  },
  ÖSTERSUND: kommun('ÖSTERSUND'),
  Enkoping: kommun('Enkoping'),
  bollnas: kommun('bollnas'),
  Alvkarleby: kommun('Alvkarleby'),
  Bastad: kommun('Bastad'),
  harjedalen: kommun('harjedalen'),
  Osthammar: kommun('Osthammar'),
  kiruna: kommun('kiruna'),
  Bromolla: kommun('Bromolla'),
  Burlov: kommun('Burlov'),
  jonkoping: kommun('jonkoping'),
  alvsbyn: kommun('alvsbyn'),
  Are: kommun('Are'),
  arvidsjaur: kommun('arvidsjaur'),
  gallivare: kommun('gallivare'),
  ornskoldsvik: kommun('ornskoldsvik'),
  Angelholm: kommun('Angelholm'),
  'lilla-edet-2000': kommun('lilla-edet-2000'),
  'upplands-bro-1997': kommun('upplands-bro-1997'),
  'eda-mfl-1987': kommun('eda-mfl-1987'),
  'forshaga-mfl-1987': kommun('forshaga-mfl-1987'),
  'hagfors-mfl-1987': kommun('hagfors-mfl-1987'),
  'karlstad-mfl-1987': kommun('karlstad-mfl-1987'),
  'munkfors-mfl-1987': kommun('munkfors-mfl-1987'),
  'upplands-vasby-1995': kommun('upplands-vasby-1995'),
  'dals-ed-2000': kommun('dals-ed-2000'),
  Bracke: kommun('Bracke'),
  ortnamn_se: {
    provider: 'Lantmateriet',
    dataset: 'Ortnamn',
    action: 'promote',
    confidence: 'high',
    rationale: 'Svenska ortnamn — LM-katalog.',
  },
  'Alla-län-översättningstabell-OID-LöpandeLängd-csv-2026': {
    provider: 'Lantmateriet',
    dataset: 'Metadata/Oversattningstabell',
    action: 'promote',
    confidence: 'high',
    rationale: 'LM metadata/översättningstabell för län-OID.',
  },
  sitacsymboler: {
    provider: 'Lantmateriet',
    dataset: 'SITAC_symboler',
    action: 'promote',
    confidence: 'med',
    rationale: 'SITAC-symboler — adress/grid-relaterat LM-material.',
  },
  HH_NOISE_ROAD_LDEN_gpkg: noise('Trafikbuller_vag_LDEN'),
  HH_NOISE_ROAD_LNIGHT_gpkg: noise('Trafikbuller_vag_LNIGHT'),
  HH_NOISE_RAIL_LDEN_gpkg: noise('Trafikbuller_jarnvag_LDEN'),
  HH_NOISE_RAIL_LNIGHT_gpkg: noise('Trafikbuller_jarnvag_LNIGHT'),
  HH_NOISE_AIR_LDEN_gpkg: noise('Trafikbuller_flyg_LDEN'),
  HH_NOISE_AIR_LNIGHT_gpkg: noise('Trafikbuller_flyg_LNIGHT'),
  Barriärkartor_större_däggdjur_2024: nv('Barriarkartor_daggdjur_2024', 'NV barriärkartor större däggdjur.'),
  Potentiellt_atervatningsbara_objekt_kommunal_mark: nv(
    'Potentiellt_atervatningsbara_objekt',
    'NV återvinningsbara objekt på kommunal mark.',
  ),
  Uppdat_Palsmyr_170307: nv('Vatmark_Palsmyr', 'NV våtmarksuppdatering.'),
  nitratkansligtomrade: nv('Nitratkansligt_omrade', 'NV nitratkänsliga områden.'),
  riksintresse_mcf: nv('Riksintresse_MCF', 'NV/planering riksintresse MCF.'),
  Viltolyckskartor_järnväg_201923: nv('Viltolyckskartor_jarnvag', 'Viltolyckskartor — miljö/trafikdata.'),
  Skyddsrum: msb('Skyddsrum', 'MSB skyddsrum.'),
  HotRiskbhf: msb('HotRisk', 'MSB olycksrisk HotRisk.'),
  HotRisk100: msb('HotRisk', 'MSB olycksrisk HotRisk.'),
  HotRisk50: msb('HotRisk', 'MSB olycksrisk HotRisk.'),
  StabKart: msb('StabKart', 'MSB stabilitetskartor.'),
  Visualisering_LBR: msb('Visualisering_LBR', 'MSB/LBR visualisering — klassas under MSB tills annat bevisas.'),
  aktuell: {
    provider: '_quarantine',
    dataset: 'unclassified_single_file',
    action: 'quarantine',
    confidence: 'low',
    rationale: 'Otydligt mappnamn (1 fil) — karantän tills innehåll verifieras.',
  },
  'Avloppsvattendirektivet  91271EEG': {
    provider: '_quarantine',
    dataset: 'admin_non_geodata',
    action: 'quarantine',
    confidence: 'high',
    rationale: 'EU-direktivreferens — hör hemma under Documents/, inte Data/.',
  },
};

function kommun(name) {
  return {
    provider: 'Lantmateriet',
    dataset: `KommunHistorik/${name}`,
    action: 'promote_kommun',
    confidence: 'high',
    rationale: 'Kommun-/historikmapp — promote till KommunHistorik.',
  };
}

function nv(dataset, rationale) {
  return {
    provider: 'Naturvardsverket',
    dataset,
    action: 'promote',
    confidence: 'high',
    rationale,
  };
}

function msb(dataset, rationale) {
  return {
    provider: 'MSB',
    dataset,
    action: 'promote',
    confidence: 'high',
    rationale,
  };
}

function noise(dataset) {
  return nv(dataset, 'Trafikbuller gpkg — NV/EU bullerklassificering.');
}

function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = parseCsvRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const resolved = [];
  const unresolved = [];
  const batch3Rows = [];

  const outLines = [headers.map(csvEscape).join(',')];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvRow(lines[i]);
    const folder = vals[idx.folder];
    const wasPaused = vals[idx.approved] === 'false';

    if (wasPaused) {
      const decision = RESOLUTIONS[folder];
      if (!decision) {
        unresolved.push(folder);
      } else {
        vals[idx.suggested_provider] = decision.provider;
        vals[idx.suggested_dataset] = decision.dataset;
        vals[idx.suggested_action] = decision.action;
        vals[idx.confidence] = decision.confidence;
        vals[idx.approved] = 'true';
        resolved.push({ folder, ...decision });
        batch3Rows.push(vals);
      }
    }

    outLines.push(vals.map(csvEscape).join(','));
  }

  if (unresolved.length > 0) {
    throw new Error(`Missing resolution for: ${unresolved.join(', ')}`);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    resolvedCount: resolved.length,
    promoteKommun: resolved.filter((r) => r.action === 'promote_kommun').length,
    promote: resolved.filter((r) => r.action === 'promote').length,
    quarantine: resolved.filter((r) => r.action === 'quarantine').length,
    totalGB: Number(
      batch3Rows.reduce((s, vals) => s + Number(vals[idx.size_gb] || 0), 0).toFixed(2),
    ),
    rows: resolved,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  fs.writeFileSync(CSV_PATH, `${outLines.join('\n')}\n`, 'utf8');
  const batch3Lines = [headers.map(csvEscape).join(','), ...batch3Rows.map((r) => r.map(csvEscape).join(','))];
  fs.writeFileSync(BATCH3_CSV, `${batch3Lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(REPORT, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Updated CSV: ${CSV_PATH}`);
  console.log(`Batch 3 CSV (${batch3Rows.length} rows): ${BATCH3_CSV}`);
  console.log(`Report: ${REPORT}`);
}

main();
