/**
 * Write Mimers Brunn manifest v2 for flyg-gamma översiktlig harvest folder.
 *
 *   npx tsx scripts/import/write-gamma-manifest.ts --raw-dir=<path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildArchiveManifestV2 } from './types/manifestSchema';
import { calculateBundleHash, calculateFileHash } from './utils/harvesting';

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const rawDir =
    readArg('raw-dir') ??
    'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Data\\SGU\\FlygGammaOversiktlig\\2026-07-28_122533\\raw';

  if (!fs.existsSync(rawDir)) {
    throw new Error(`raw-dir missing: ${rawDir}`);
  }

  const candidates = [
    'geofysik-flyg-gammastralning-oversiktlig.zip',
    'extracted/geofysik_flyg_gammastralning_oversiktlig.xyz',
    'extracted/geofysik_flyg_gammastralning_oversiktlig.csv',
    'extracted/geofysiska-flygmatningar-gammastralning-oversiktlig-beskrivning.pdf',
  ];

  const files = candidates
    .map((rel) => ({ rel: rel.replace(/\\/g, '/'), abs: path.join(rawDir, rel) }))
    .filter((f) => fs.existsSync(f.abs));

  if (files.length === 0) {
    throw new Error('No harvest files found');
  }

  const absPaths = files.map((f) => f.abs);
  const content_bundle_sha256 = await calculateBundleHash(absPaths);
  const total_bytes = absPaths.reduce((acc, p) => acc + fs.statSync(p).size, 0);

  const files_detail = [];
  for (const f of files) {
    files_detail.push({
      name: path.basename(f.abs),
      sha256: await calculateFileHash(f.abs),
      size_bytes: fs.statSync(f.abs).size,
      rel_path: f.rel,
    });
  }

  const manifest = buildArchiveManifestV2({
    provider: 'SGU',
    dataset: 'FlygGammaOversiktlig',
    version: '2026-07-28',
    total_bytes,
    files: files.map((f) => f.rel),
    content_bundle_sha256,
    provenance: 'sgu_official_zip',
    source_url:
      'https://resource.sgu.se/data/oppnadata/geofysik-flyg-gammastralning-oversiktlig/geofysik-flyg-gammastralning-oversiktlig.zip',
    license: 'CC0 1.0',
    qa_status: 'pending',
    expected_columns: ['e_swr99tm', 'n_swr99tm', 'k', 'u', 'th'],
    files_detail,
  });

  fs.writeFileSync(path.join(rawDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(rawDir, 'checksums.txt'),
    `${files_detail.map((d) => `${d.sha256}  ${d.rel_path}`).join('\n')}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        files: files.length,
        total_mb: Math.round(total_bytes / 1e6),
        sha16: content_bundle_sha256.slice(0, 16),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
