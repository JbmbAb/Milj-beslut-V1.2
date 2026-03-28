#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { INPUT_FILENAMES } from './contracts.mjs';
import { copyFileSafe, ensureDir, timestampSlug, writeJsonFile } from './lib.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dataset: './working/current',
    outRoot: './verified',
    label: `dataset-${timestampSlug()}`,
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) parsed.dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--out-root=')) parsed.outRoot = arg.slice('--out-root='.length);
    else if (arg.startsWith('--label=')) parsed.label = arg.slice('--label='.length);
  }

  return parsed;
}

async function sha256(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  const options = parseArgs(process.argv);
  const datasetDir = path.resolve(process.cwd(), options.dataset);
  const outDir = path.resolve(process.cwd(), options.outRoot, options.label);
  await ensureDir(outDir);

  const files = [INPUT_FILENAMES.cases, INPUT_FILENAMES.requirements, INPUT_FILENAMES.citations, INPUT_FILENAMES.summary];
  const hashes = {};
  for (const file of files) {
    const source = path.join(datasetDir, file);
    const target = path.join(outDir, file);
    await copyFileSafe(source, target);
    hashes[file] = await sha256(target);
  }

  const manifest = {
    frozenAt: new Date().toISOString(),
    sourceDataset: datasetDir,
    targetDataset: outDir,
    hashes,
  };

  await writeJsonFile(path.join(outDir, 'dataset_freeze_manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify({ ok: true, outDir, manifest: path.join(outDir, 'dataset_freeze_manifest.json') })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
