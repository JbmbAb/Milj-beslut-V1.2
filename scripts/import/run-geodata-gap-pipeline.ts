/**
 * Geodata gap pipeline — runs phases in order with logging.
 *
 *   npx tsx scripts/import/run-geodata-gap-pipeline.ts
 *   npx tsx scripts/import/run-geodata-gap-pipeline.ts --from=water-hydro
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { MASTER_ARCHIVE_ROOT as MASTER } from './config/mimersBrunn';

const TSX_CLI = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const LOG_DIR = path.join(process.cwd(), 'storage', 'manifests');
const LOG_FILE = path.join(
  LOG_DIR,
  `geodata-gap-pipeline-internal-${Date.now()}.log`,
);

type Phase = {
  id: string;
  label: string;
  run: () => void;
};

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
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

function librarianPromote(label: string, manifestDir: string): void {
  runTsx(`${label} staging`, 'scripts/import/import-librarian-manifest.ts', [
    '--manifest-dir',
    manifestDir,
    '--data-dir',
    manifestDir,
    '--mode',
    'import-staging',
    '--execute',
  ]);
  runTsx(`${label} promote`, 'scripts/import/import-librarian-manifest.ts', [
    '--manifest-dir',
    manifestDir,
    '--data-dir',
    manifestDir,
    '--mode',
    'promote',
    '--execute',
    '--write-back-manifest',
  ]);
}

function lmStacLibrarian(dataset: string): void {
  runTsx(`LM STAC ${dataset}`, 'scripts/import/run-lm-stac-librarian-pipeline.ts', [
    `--dataset=${dataset}`,
  ]);
}



const phases: Phase[] = [
  {
    id: 'mcf',
    label: 'MCF stabilitet (normalize + librarian)',
    run: () => runTsx('MCF pipeline', 'scripts/import/run-mcf-stability-librarian-pipeline.ts'),
  },
  {
    id: 'water-viss',
    label: 'VISS/SMED/LST vatten harvest',
    run: () => runTsx('VISS harvest', 'scripts/import/harvest-viss-zip-to-master.ts'),
  },
  {
    id: 'water-smhi',
    label: 'SMHI SVAR harvest',
    run: () => runTsx('SMHI harvest', 'scripts/import/harvest-smhi-svar-to-master.ts'),
  },
  {
    id: 'ebh',
    label: 'EBH download + normalize + librarian',
    run: () => {
      runTsx('EBH harvest', 'scripts/import/harvest-ebh-to-master.ts');
      runTsx('EBH normalize', 'scripts/import/prepare-ebh-gpkg.ts');
      const ebhDir = path.join(MASTER, 'Data', 'LST', 'EBH_Potentiellt_fororenade_omraden');
      const version = fs
        .readdirSync(ebhDir)
        .filter((d) =>
          fs.existsSync(path.join(ebhDir, d, 'raw', 'ebh_potentiellt_fororenade_omraden.gpkg')),
        )
        .sort()
        .at(-1);
      if (!version) throw new Error('EBH manifest version not found');
      librarianPromote('EBH', path.join(ebhDir, version));
    },
  },
  {
    id: 'lm23',
    label: 'LM våg 2–3 STAC download + merge + librarian',
    run: () => {
      for (const ds of ['ortnamn', 'kommuner', 'lan', 'rike', 'belagenhetsadresser']) {
        runPy(`LM STAC download ${ds}`, 'scripts/data-pipeline/import_lm_stac_resume.py', ds);
      }
      lmStacLibrarian('Ortnamn_Nationell/Ortnamn');
      lmStacLibrarian('AdministrativIndelning_Nationell/Kommun');
      lmStacLibrarian('AdministrativIndelning_Nationell/Lan');
      lmStacLibrarian('AdministrativIndelning_Nationell/Rike');
      lmStacLibrarian('Belagenhetsadress_Nationell/Belagenhetsadress');
    },
  },
  {
    id: 'msb-oversvamning',
    label: 'MSB översvämningskartering (WFS harvest + librarian)',
    run: () => {
      runTsx('MSB oversvamning harvest', 'scripts/import/harvest-msb-oversvamning-to-master.ts');
      runTsx('MSB oversvamning normalize', 'scripts/import/prepare-msb-oversvamning-gpkg.ts');
      const msbDir = path.join(MASTER, 'Data', 'MSB', 'oversvamning_nationell');
      const version = fs
        .readdirSync(msbDir)
        .filter((d) => fs.existsSync(path.join(msbDir, d, 'manifest.json')))
        .sort()
        .at(-1);
      if (!version) throw new Error('MSB oversvamning manifest version not found');
      librarianPromote('MSB oversvamning', path.join(msbDir, version));
    },
  },
  {
    id: 'mcf-oversvamning-pdfs',
    label: 'MCF översvämnings-PDF:er (dokumentarkiv)',
    run: () =>
      runTsx('MCF oversvamning PDFs', 'scripts/import/harvest-mcf-oversvamning-pdfs-to-master.ts'),
  },
  {
    id: 'water-hydro',
    label: 'LM Hydrografi (BLOCKERAD — nedladdning ej godkänd, endast Direkt visning)',
    run: () => {
      log(
        'SKIP LM Hydrografi: Nedladdning vektor ej godkänd för LM-appen (items=403/900910). ' +
          'Endast Hydrografi Direkt (visnings-WMS/WFS) finns → temporärt live-kartlager, ' +
          'materialiseras ej (Mimers Brunn-undantag). Kör manuellt om nedladdning beviljas.',
      );
    },
  },
];

function main(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const from = readArg('from');
  const startIdx = from ? phases.findIndex((p) => p.id === from) : 0;
  if (startIdx < 0) {
    throw new Error(`Unknown --from phase: ${from}`);
  }

  log(`Geodata gap pipeline starting at phase ${phases[startIdx].id}`);
  for (let i = startIdx; i < phases.length; i++) {
    const phase = phases[i];
    log(`=== PHASE ${phase.id}: ${phase.label} ===`);
    phase.run();
  }
  log('Geodata gap pipeline complete.');
}

main();
