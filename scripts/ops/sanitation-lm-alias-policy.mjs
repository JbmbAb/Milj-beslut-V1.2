/**
 * SAN-2026-011 — Document LM ↔ Lantmäteriet alias split (governance, no moves).
 * Optionally inventory Nationell manifests + legacy Fastighetsindelning candidates.
 *
 *   node scripts/ops/sanitation-lm-alias-policy.mjs
 *   node scripts/ops/sanitation-lm-alias-policy.mjs --inventory
 */
import fs from 'fs';
import path from 'path';

const DO_INV = process.argv.includes('--inventory');
const MASTER =
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const DATA = path.join(MASTER, 'Data');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeDual(name, obj) {
  writeJson(path.join(OPS_DIR, name), obj);
  writeJson(path.join(REPO_OPS, name), obj);
}

function walkManifests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkManifests(fp, out);
    else if (e.name === 'manifest.json') out.push(fp);
  }
  return out;
}

function countFiles(dir, maxDepth = 4, depth = 0) {
  if (!fs.existsSync(dir) || depth > maxDepth) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files: 0, bytes: 0 };
  }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = countFiles(fp, maxDepth, depth + 1);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      try {
        bytes += fs.statSync(fp).size;
      } catch {
        // ignore
      }
    }
  }
  return { files, bytes };
}

const NATIONELL = [
  'Fastighetsindelning_Nationell',
  'Byggnader_Nationell',
  'Marktacke_Nationell',
  'Ortnamn_Nationell',
  'AdministrativIndelning_Nationell',
  'Belagenhetsadress_Nationell',
];

const LEGACY_CANDIDATES = ['Fastighetsindelning', 'Fastighet'];

function main() {
  const lmRoot = path.join(DATA, 'LM');
  const lantRoot = path.join(DATA, 'Lantmateriet');

  const policy = {
    schema_version: '1.0',
    operation_id: 'SAN-2026-011',
    action: 'CLASSIFY',
    reason: 'governance',
    source: 'Data/LM + Data/Lantmateriet',
    provider: 'Lantmateriet',
    approved_by: 'JbmbAb',
    created_at: new Date().toISOString(),
    status: 'completed',
    notes:
      'Close the LM↔Lantmäteriet alias question: not a duplicate tree. Registry maps provider lm→Lantmateriet. Keep intentional pipeline split.',
    evidence: {
      registry_rule: "normalizeProvider('lm') === 'Lantmateriet'",
      intentional_split: {
        'Data/LM/STAC_Archive': {
          role: 'ingestion_raw',
          description:
            'Municipal STAC ZIP inputs (väg B). Merged by merge-stac-national.ts into Nationell GPKG.',
        },
        'Data/LM/Historiska': {
          role: 'ingestion_raw_historical',
          description: 'Historical raster/map source packs under LM namespace.',
        },
        'Data/Lantmateriet/*_Nationell': {
          role: 'canonical_import',
          description:
            'Canonical national GeoPackages after STAC merge — Librarian import target.',
        },
        'Data/Lantmateriet/Fastighetsindelning (legacy)': {
          role: 'legacy_pre_nationell',
          description:
            'Pre-Nationell / alias path. Do NOT quarantine until Nationell hash-audit passes.',
          aliases_in_registry: ['Fastighetsindelning/Registerenhetsomradesytor → …_Nationell/…'],
        },
      },
      do_not_merge: true,
      quarantine_gate:
        'Legacy Fastighetsindelning/Fastighet may move to _quarantine only after Nationell files_detail hash verification.',
      suspected_provider_mismatch_under_Lantmateriet:
        'County *-Mätdata/*-Beläggning/*-Avvattning packs look like Trafikverket/NV-style products — classify in follow-up (not auto-moved here).',
    },
  };

  writeDual('SAN-2026-011.json', policy);
  writeDual('LM-LANTMATERIET-ALIAS-POLICY-2026-011.json', {
    generated_at: new Date().toISOString(),
    title: 'LM ↔ Lantmäteriet alias policy',
    verdict: 'intentional_pipeline_split',
    provider_alias: { lm: 'Lantmateriet' },
    trees: policy.evidence.intentional_split,
    nationell_canonical: NATIONELL,
    legacy_hold_until_hash_ok: LEGACY_CANDIDATES,
  });

  let inventory = null;
  if (DO_INV) {
    const stac = path.join(lmRoot, 'STAC_Archive');
    const historiska = path.join(lmRoot, 'Historiska');
    const stacZips = fs.existsSync(stac)
      ? fs.readdirSync(stac).filter((n) => n.toLowerCase().endsWith('.zip')).length
      : 0;

    const nationell = {};
    for (const name of NATIONELL) {
      const abs = path.join(lantRoot, name);
      const manifests = walkManifests(abs);
      const stats = countFiles(abs, 6);
      nationell[name] = {
        exists: fs.existsSync(abs),
        manifests: manifests.length,
        files: stats.files,
        bytes: stats.bytes,
        gb: Number((stats.bytes / 1e9).toFixed(3)),
        manifest_samples: manifests.slice(0, 5).map((m) => path.relative(lantRoot, m)),
      };
    }

    const legacy = {};
    for (const name of LEGACY_CANDIDATES) {
      const abs = path.join(lantRoot, name);
      const manifests = walkManifests(abs);
      const stats = countFiles(abs, 5);
      legacy[name] = {
        exists: fs.existsSync(abs),
        manifests: manifests.length,
        files: stats.files,
        bytes: stats.bytes,
        gb: Number((stats.bytes / 1e9).toFixed(3)),
      };
    }

    const allKids = fs.existsSync(lantRoot)
      ? fs.readdirSync(lantRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [];
    const suspectedTv = allKids.filter((n) =>
      /mätdata|matdata|beläggning|belaggning|avvattning/i.test(n),
    );

    inventory = {
      generated_at: new Date().toISOString(),
      lm: {
        stac_archive_zips: stacZips,
        historiska_top: fs.existsSync(historiska) ? fs.readdirSync(historiska) : [],
      },
      nationell,
      legacy,
      lantmateriet_top_count: allKids.length,
      suspected_trafikverket_style_folders: suspectedTv.length,
      suspected_trafikverket_style_sample: suspectedTv.slice(0, 15),
      next_ops: [
        'SAN-2026-012: rclone hashsum Data/Lantmateriet/*_Nationell + compare files_detail',
        'After Nationell OK: quarantine legacy Fastighetsindelning/Fastighet if superseded',
        'Classify/move suspected Trafikverket-style county packs out of Lantmateriet',
      ],
    };
    writeDual('LM-NATIONELL-INVENTORY-2026-011.json', inventory);
  }

  console.log(
    JSON.stringify(
      {
        policy: 'SAN-2026-011',
        verdict: 'intentional_pipeline_split',
        inventory: inventory
          ? {
              stac_zips: inventory.lm.stac_archive_zips,
              nationell: Object.fromEntries(
                Object.entries(inventory.nationell).map(([k, v]) => [
                  k,
                  { manifests: v.manifests, gb: v.gb },
                ]),
              ),
              legacy: inventory.legacy,
              suspected_tv_folders: inventory.suspected_trafikverket_style_folders,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main();
