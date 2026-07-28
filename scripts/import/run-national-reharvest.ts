/**
 * National re-harvest — dammsuga alla kända datakällor till GEO_Master_Archive (Mimers Brunn).
 *
 * Skapar alltid nya versionsmappar (inga --skip-download). Checkpoints rensas med --force.
 *
 * Usage:
 *   npx tsx scripts/import/run-national-reharvest.ts
 *   npx tsx scripts/import/run-national-reharvest.ts --from=sgu
 *   npx tsx scripts/import/run-national-reharvest.ts --only=sgu,documents
 *   npx tsx scripts/import/run-national-reharvest.ts --continue-on-error
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MASTER_ARCHIVE_ROOT, PATHS } from './config/mimersBrunn';
import { SGU_HARVEST_SOURCES } from './config/sguHarvestSources';

const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const LOG_DIR = path.join(process.cwd(), 'storage', 'manifests');
const LOG_FILE = path.join(LOG_DIR, `national-reharvest-${Date.now()}.log`);

type Phase = {
  id: string;
  label: string;
  run: () => void;
};

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

function runTsx(label: string, script: string, extra: string[] = []): void {
  log(`START ${label}`);
  const result = spawnSync(process.execPath, [TSX_CLI, script, ...extra], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
  log(`DONE ${label}`);
}

function runPy(label: string, script: string, arg: string): void {
  log(`START ${label}`);
  const result = spawnSync('python', ['-u', script, arg], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
  log(`DONE ${label}`);
}

function clearPoliteCheckpoint(): void {
  const checkpoint = path.join(PATHS.DOCUMENTS, 'harvest_checkpoint.json');
  if (fs.existsSync(checkpoint)) {
    fs.unlinkSync(checkpoint);
    log(`Removed document harvest checkpoint: ${checkpoint}`);
  }
}

/** SGU tier-1 first (produktkritiska), största Jordarter sist. */
const SGU_ORDER = [
  'Grundvatten',
  'Brunnar',
  'Jordskred',
  'Fastmark',
  'AktsamhetEfterarbetad',
  'Genomslapplighet',
  'Jorddjupsmodell',
  'StranderosionKust',
  'Jordarter750kBlockighet',
  'Jordarter750kLandform',
  'MiljogifterAnalysresultat',
  'MiljogifterProvplatser',
  'HypeOmraden',
  'HypeKlimatindikatorerHistorisk',
  'HypeKlimatindikatorerRcp',
  'Jordarter25k100k',
  'Kallor',
  'Borrhal',
  'Grundvattenforekomster',
  'MaringeologiYtsubstrat',
];

function runSguReharvest(): void {
  const ordered = SGU_ORDER.map((id) => SGU_HARVEST_SOURCES.find((s) => s.id === id)).filter(Boolean);
  const rest = SGU_HARVEST_SOURCES.filter((s) => !SGU_ORDER.includes(s.id));
  for (const source of [...ordered, ...rest]) {
    if (!source) continue;
    const strategy = source.zip ? 'zip' : 'api';
    runTsx(`SGU ${source.id}`, 'scripts/import/harvest-sgu-to-master.ts', [
      `--only=${source.id}`,
      `--strategy=${strategy}`,
    ]);
  }
}

const LM_STAC_CORE = ['fastighetsytor', 'fastighetslinjer', 'byggnader', 'marktacke'] as const;
const LM_STAC_WAVE23 = ['ortnamn', 'kommuner', 'lan', 'rike', 'belagenhetsadresser'] as const;

const LM_LIBRARIAN_DATASETS = [
  'Fastighetsindelning_Nationell/Registerenhetsomradesytor',
  'Fastighetsindelning_Nationell/Registerenhetsomradeslinjer',
  'Byggnader_Nationell/Byggnad',
  'Marktacke_Nationell/Mark',
  'Ortnamn_Nationell/Ortnamn',
  'AdministrativIndelning_Nationell/Kommun',
  'AdministrativIndelning_Nationell/Lan',
  'AdministrativIndelning_Nationell/Rike',
  'Belagenhetsadress_Nationell/Belagenhetsadress',
] as const;

const phases: Phase[] = [
  {
    id: 'documents',
    label: 'Nationella styrdokument (HaV/NV PDF)',
    run: () => runTsx('Polite document harvest', 'scripts/import/harvest-polite-pipeline.ts'),
  },
  {
    id: 'sgu',
    label: 'SGU — alla ZIP/API-källor',
    run: runSguReharvest,
  },
  {
    id: 'nv-geodata',
    label: 'Naturvårdsverket geodata (nedladdningsportal)',
    run: () => runTsx('NV geodata harvest', 'scripts/import/harvest-naturvardsverket-geodata.ts'),
  },
  {
    id: 'msb-wfs',
    label: 'MSB WFS (översvämning + APSFR)',
    run: () => runTsx('MSB WFS harvest', 'scripts/import/harvest-msb-to-master.ts'),
  },
  {
    id: 'water-viss',
    label: 'VISS/SMED vatten ZIP',
    run: () => runTsx('VISS harvest', 'scripts/import/harvest-viss-zip-to-master.ts'),
  },
  {
    id: 'water-smhi',
    label: 'SMHI SVAR',
    run: () => runTsx('SMHI harvest', 'scripts/import/harvest-smhi-svar-to-master.ts'),
  },
  {
    id: 'ebh',
    label: 'EBH potentiellt förorenade områden',
    run: () => runTsx('EBH harvest', 'scripts/import/harvest-ebh-to-master.ts'),
  },
  {
    id: 'msb-oversvamning',
    label: 'MSB översvämningskartering (WFS)',
    run: () => runTsx('MSB oversvamning harvest', 'scripts/import/harvest-msb-oversvamning-to-master.ts'),
  },
  {
    id: 'mcf-pdfs',
    label: 'MCF översvämnings-PDF:er',
    run: () => runTsx('MCF PDF harvest', 'scripts/import/harvest-mcf-oversvamning-pdfs-to-master.ts'),
  },
  {
    id: 'mcf-stability',
    label: 'MCF stabilitet (normalize + librarian)',
    run: () => runTsx('MCF stability', 'scripts/import/run-mcf-stability-librarian-pipeline.ts'),
  },
  {
    id: 'lm-stac-core',
    label: 'LM STAC kärna (fastighet, byggnad, marktäcke)',
    run: () => {
      for (const ds of LM_STAC_CORE) {
        runPy(`LM STAC download ${ds}`, 'scripts/data-pipeline/import_lm_stac_resume.py', ds);
      }
    },
  },
  {
    id: 'lm-stac-wave23',
    label: 'LM STAC våg 2–3 (ortnamn, admin, adress)',
    run: () => {
      for (const ds of LM_STAC_WAVE23) {
        runPy(`LM STAC download ${ds}`, 'scripts/data-pipeline/import_lm_stac_resume.py', ds);
      }
    },
  },
  {
    id: 'lm-librarian',
    label: 'LM STAC merge + Librarian promote',
    run: () => {
      for (const dataset of LM_LIBRARIAN_DATASETS) {
        runTsx(`LM librarian ${dataset}`, 'scripts/import/run-lm-stac-librarian-pipeline.ts', [
          `--dataset=${dataset}`,
        ]);
      }
    },
  },
  {
    id: 'sks',
    label: 'SKS geodata + markfuktighet',
    run: () => {
      runTsx('SKS geodata', 'scripts/import/harvest-sks-geodata.ts');
      runTsx('SKS markfuktighet', 'scripts/import/harvest-sks-markfuktighet.ts');
    },
  },
  {
    id: 'audit',
    label: 'Arkiv-audit (snabb, utan SHA-256)',
    run: () => {
      const result = spawnSync(
        'pwsh',
        ['-NoProfile', '-File', 'scripts/ops/archive-audit.ps1'],
        { stdio: 'inherit', cwd: process.cwd(), env: process.env },
      );
      if (result.status !== 0) {
        log(`WARN archive audit exit ${result.status} — fortsätt manuellt efter klart jobb`);
      }
    },
  },
];

function main(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const from = readArg('from');
  const onlyRaw = readArg('only');
  const onlySet = onlyRaw ? new Set(onlyRaw.split(',').map((s) => s.trim())) : null;
  const continueOnError = hasFlag('continue-on-error');
  const force = hasFlag('force') || !hasFlag('no-force');

  log(`National re-harvest starting`);
  log(`Archive root: ${MASTER_ARCHIVE_ROOT}`);
  log(`Log file: ${LOG_FILE}`);
  if (force) clearPoliteCheckpoint();

  let startIdx = 0;
  if (from) {
    startIdx = phases.findIndex((p) => p.id === from);
    if (startIdx < 0) {
      throw new Error(`Unknown --from phase: ${from}. Valid: ${phases.map((p) => p.id).join(', ')}`);
    }
  }

  const failures: string[] = [];
  for (let i = startIdx; i < phases.length; i++) {
    const phase = phases[i];
    if (onlySet && !onlySet.has(phase.id)) continue;

    log(`=== PHASE ${phase.id}: ${phase.label} ===`);
    try {
      phase.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`FAIL ${phase.id}: ${msg}`);
      failures.push(phase.id);
      if (!continueOnError) {
        log(`Stopped. Resume with: npx tsx scripts/import/run-national-reharvest.ts --from=${phase.id} --continue-on-error`);
        process.exit(1);
      }
    }
  }

  if (failures.length) {
    log(`Completed with failures: ${failures.join(', ')}`);
    process.exit(1);
  }
  log('National re-harvest complete.');
}

main();
