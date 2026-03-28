#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { timestampSlug } from './lib.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    from: '../docs/qa/requirements-model',
    workspace: '.',
    label: `run-${timestampSlug()}`,
    qualitySoft: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--from=')) parsed.from = arg.slice('--from='.length);
    else if (arg.startsWith('--workspace=')) parsed.workspace = arg.slice('--workspace='.length);
    else if (arg.startsWith('--label=')) parsed.label = arg.slice('--label='.length);
    else if (arg === '--quality-soft') parsed.qualitySoft = true;
  }

  return parsed;
}

function runNode(scriptPath, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${scriptPath}) with exit code ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const workspace = path.resolve(process.cwd(), options.workspace);
  const snapshotLabel = `${options.label}-snapshot`;
  const workingLabel = `${options.label}-working`;
  const outputLabel = `${options.label}-output`;

  const toolsDir = path.resolve(workspace, 'tools');
  const importScript = path.join(toolsDir, 'import-snapshot.mjs');
  const normalizeScript = path.join(toolsDir, 'normalize-snapshot.mjs');
  const gateScript = path.join(toolsDir, 'quality-gate.mjs');
  const buildScript = path.join(toolsDir, 'build-report-artifacts.mjs');

  const snapshotsDir = path.join(workspace, 'input', 'snapshots');
  const workingDirRoot = path.join(workspace, 'working');
  const outputDirRoot = path.join(workspace, 'output');

  await runNode(importScript, [`--from=${options.from}`, `--out=${snapshotsDir}`, `--label=${snapshotLabel}`]);
  await runNode(normalizeScript, [
    `--snapshot=${path.join(snapshotsDir, snapshotLabel)}`,
    `--out=${workingDirRoot}`,
    `--label=${workingLabel}`,
  ]);

  const gateArgs = [`--dataset=${path.join(workingDirRoot, workingLabel)}`, `--out=${path.join(workingDirRoot, workingLabel, 'quality_gate_report.json')}`];
  if (options.qualitySoft) gateArgs.push('--soft');
  await runNode(gateScript, gateArgs);

  const gateReportPath = path.join(workingDirRoot, workingLabel, 'quality_gate_report.json');
  const gateReport = JSON.parse(String(await fs.readFile(gateReportPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (!gateReport.passed) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        reason: 'QUALITY_GATE_FAILED',
        gateReportPath,
        snapshotDir: path.join(snapshotsDir, snapshotLabel),
        workingDir: path.join(workingDirRoot, workingLabel),
      })}\n`
    );
    return;
  }

  await runNode(buildScript, [
    `--dataset=${path.join(workingDirRoot, workingLabel)}`,
    `--out=${path.join(outputDirRoot, outputLabel)}`,
  ]);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    gateReportPath,
    snapshotDir: path.join(snapshotsDir, snapshotLabel),
    workingDir: path.join(workingDirRoot, workingLabel),
    outputDir: path.join(outputDirRoot, outputLabel),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
