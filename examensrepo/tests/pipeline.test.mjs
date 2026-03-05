import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repoDir = path.resolve(process.cwd());
const toolsDir = path.join(repoDir, 'tools');
const fixtureDir = path.join(repoDir, 'tests', 'fixtures', 'sample-snapshot');

function runNode(scriptName, args, cwd) {
  const scriptPath = path.join(toolsDir, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return result;
}

function gateOutPath(ws) {
  return path.join(ws.working, 'current', 'quality_gate_report.json');
}

async function setupTempWorkspace() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'examensrepo-test-'));
  const source = path.join(tmp, 'source');
  const input = path.join(tmp, 'input');
  const working = path.join(tmp, 'working');
  const output = path.join(tmp, 'output');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(input, { recursive: true });
  await fs.mkdir(working, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.cp(fixtureDir, source, { recursive: true });
  return { tmp, source, input, working, output };
}

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(';');
  return lines.slice(1).map((line) => {
    const parts = line.split(';');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = parts[index] || '';
    });
    return row;
  });
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('importtest: snapshot lases utan datatapp', async () => {
  const ws = await setupTempWorkspace();

  const importRes = runNode('import-snapshot.mjs', [
    `--from=${ws.source}`,
    `--out=${path.join(ws.input, 'snapshots')}`,
    '--label=s1',
  ], repoDir);

  assert.equal(importRes.status, 0, importRes.stderr || importRes.stdout);
  const manifestPath = path.join(ws.input, 'snapshots', 's1', 'import_manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.rowCounts.cases, 2);
  assert.equal(manifest.rowCounts.requirements, 3);
  assert.equal(manifest.rowCounts.citations, 3);
});

test('regeltest: quality gate blockerar otillatna statusovergangar', async () => {
  const ws = await setupTempWorkspace();
  const reqPath = path.join(ws.source, 'requirements.csv');
  const content = await fs.readFile(reqPath, 'utf8');
  const modified = content.replace('REQ-003;CASE-002', 'REQ-003;CASE-002').replace(';VERIFIED;Ja;Verifierare B;', ';AUTO;Nej;;');
  await fs.writeFile(reqPath, modified, 'utf8');

  const normalizeRes = runNode('normalize-snapshot.mjs', [
    `--snapshot=${ws.source}`,
    `--out=${ws.working}`,
    '--label=current',
  ], repoDir);
  assert.equal(normalizeRes.status, 0, normalizeRes.stderr || normalizeRes.stdout);

  const gateRes = runNode(
    'quality-gate.mjs',
    [`--dataset=${path.join(ws.working, 'current')}`, `--out=${gateOutPath(ws)}`],
    repoDir
  );
  assert.notEqual(gateRes.status, 0, 'quality gate should fail when requirement is not VERIFIED');
});

test('konsistenstest: tabellsummor matchar reportsammanfattning', async () => {
  const ws = await setupTempWorkspace();

  const normalizeRes = runNode('normalize-snapshot.mjs', [
    `--snapshot=${ws.source}`,
    `--out=${ws.working}`,
    '--label=current',
  ], repoDir);
  assert.equal(normalizeRes.status, 0, normalizeRes.stderr || normalizeRes.stdout);

  const gateRes = runNode(
    'quality-gate.mjs',
    [`--dataset=${path.join(ws.working, 'current')}`, `--out=${gateOutPath(ws)}`],
    repoDir
  );
  assert.equal(gateRes.status, 0, gateRes.stderr || gateRes.stdout);

  const buildRes = runNode('build-report-artifacts.mjs', [
    `--dataset=${path.join(ws.working, 'current')}`,
    `--out=${path.join(ws.output, 'release')}`,
  ], repoDir);
  assert.equal(buildRes.status, 0, buildRes.stderr || buildRes.stdout);

  const summary = JSON.parse(await fs.readFile(path.join(ws.output, 'release', 'report_summary.json'), 'utf8'));
  const tableBRows = parseCsv(await fs.readFile(path.join(ws.output, 'release', 'table_b_kravfrekvens_per_kategori.csv'), 'utf8'));
  const totalFromTableB = tableBRows.reduce((sum, row) => sum + Number(row.AntalKrav || 0), 0);
  assert.equal(totalFromTableB, summary.requirementCount);
});

test('reproducerbarhetstest: samma snapshot ger identiska tabellfiler', async () => {
  const ws = await setupTempWorkspace();

  const normalizeRes = runNode('normalize-snapshot.mjs', [
    `--snapshot=${ws.source}`,
    `--out=${ws.working}`,
    '--label=current',
  ], repoDir);
  assert.equal(normalizeRes.status, 0, normalizeRes.stderr || normalizeRes.stdout);

  const gateRes = runNode(
    'quality-gate.mjs',
    [`--dataset=${path.join(ws.working, 'current')}`, `--out=${gateOutPath(ws)}`],
    repoDir
  );
  assert.equal(gateRes.status, 0, gateRes.stderr || gateRes.stdout);

  const build1 = runNode('build-report-artifacts.mjs', [
    `--dataset=${path.join(ws.working, 'current')}`,
    `--out=${path.join(ws.output, 'release-a')}`,
  ], repoDir);
  assert.equal(build1.status, 0, build1.stderr || build1.stdout);

  const build2 = runNode('build-report-artifacts.mjs', [
    `--dataset=${path.join(ws.working, 'current')}`,
    `--out=${path.join(ws.output, 'release-b')}`,
  ], repoDir);
  assert.equal(build2.status, 0, build2.stderr || build2.stdout);

  const files = [
    'table_a_arenden_per_myndighet.csv',
    'table_b_kravfrekvens_per_kategori.csv',
    'table_c_kommunskillnader_yt_lakvatten.csv',
    'table_d_krav_per_avfall_ewc.csv',
    'evidensindex.csv',
  ];

  for (const file of files) {
    const hashA = await sha256(path.join(ws.output, 'release-a', file));
    const hashB = await sha256(path.join(ws.output, 'release-b', file));
    assert.equal(hashA, hashB, `hash mismatch for ${file}`);
  }
});

test('sparbarhetstest: evidensindex innehaller kedjan kravrad -> citation -> dokument', async () => {
  const ws = await setupTempWorkspace();

  const normalizeRes = runNode('normalize-snapshot.mjs', [
    `--snapshot=${ws.source}`,
    `--out=${ws.working}`,
    '--label=current',
  ], repoDir);
  assert.equal(normalizeRes.status, 0, normalizeRes.stderr || normalizeRes.stdout);

  const gateRes = runNode(
    'quality-gate.mjs',
    [`--dataset=${path.join(ws.working, 'current')}`, `--out=${gateOutPath(ws)}`],
    repoDir
  );
  assert.equal(gateRes.status, 0, gateRes.stderr || gateRes.stdout);

  const buildRes = runNode('build-report-artifacts.mjs', [
    `--dataset=${path.join(ws.working, 'current')}`,
    `--out=${path.join(ws.output, 'release')}`,
  ], repoDir);
  assert.equal(buildRes.status, 0, buildRes.stderr || buildRes.stdout);

  const evidenceRows = parseCsv(await fs.readFile(path.join(ws.output, 'release', 'evidensindex.csv'), 'utf8'));
  assert.ok(evidenceRows.length > 0);

  for (const row of evidenceRows) {
    assert.notEqual(row.RequirementId, '');
    assert.notEqual(row.CitationId, '');
    assert.notEqual(row.DocumentId, '');
    assert.notEqual(row.KallfilRef, '');
  }
});

test('backfilltest: citationer utan page/comment far automatisk pdf-lankkommentar', async () => {
  const ws = await setupTempWorkspace();
  const citationPath = path.join(ws.source, 'citations.csv');
  const content = await fs.readFile(citationPath, 'utf8');
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(';');
  const commentIndex = headers.indexOf('Kommentar');
  const pageIndex = headers.indexOf('PageNumber');
  const parts = lines[1].split(';');
  parts[pageIndex] = '';
  parts[commentIndex] = '';
  lines[1] = parts.join(';');
  await fs.writeFile(citationPath, `${lines.join('\n')}\n`, 'utf8');

  const backfillRes = runNode(
    'backfill-citation-links.mjs',
    [`--dataset=${ws.source}`, `--report=${path.join(ws.source, 'backfill_report.json')}`],
    repoDir
  );
  assert.equal(backfillRes.status, 0, backfillRes.stderr || backfillRes.stdout);

  const updatedCitations = parseCsv(await fs.readFile(citationPath, 'utf8'));
  assert.match(updatedCitations[0].Kommentar, /\/api\/admin\/requirements\/documents\/DOC-001\/view/);
});
