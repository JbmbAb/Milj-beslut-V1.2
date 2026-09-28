/**
 * JSON persistence for DEMO-01 (K-26 §5): no Prisma model, no migration.
 *
 *   <root>/cases/<id>.json            mutable draft, with <id>.json.sha256 sidecar
 *   <root>/frozen/<sha256>.json       immutable, content-addressed approved state
 *   <root>/MANIFEST.jsonl             append-only: one line per file written
 *
 * Root defaults to <cwd>/.data/demo-01 (gitignored), override with DEMO_C_ANMALAN_DATA_DIR.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DemoCase } from './types';

export function dataRoot(): string {
  return path.resolve(process.env.DEMO_C_ANMALAN_DATA_DIR || path.join(process.cwd(), '.data', 'demo-01'));
}

/** Deterministic JSON: object keys sorted recursively, so the hash is independent of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const CASE_ID = /^demo01-[a-z0-9-]{6,64}$/;
const SHA = /^[a-f0-9]{64}$/;

function appendManifest(file: string, digest: string): void {
  fs.appendFileSync(
    path.join(dataRoot(), 'MANIFEST.jsonl'),
    JSON.stringify({ file: path.relative(dataRoot(), file).replace(/\\/g, '/'), sha256: digest, at: new Date().toISOString() }) + '\n',
    'utf8',
  );
}

function writeWithManifest(file: string, body: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
  const digest = sha256(body);
  appendManifest(file, digest);
  return digest;
}

export function newCaseId(): string {
  return `demo01-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function saveCase(record: DemoCase): string {
  if (!CASE_ID.test(record.id)) throw new Error('invalid_case_id');
  const file = path.join(dataRoot(), 'cases', `${record.id}.json`);
  const digest = writeWithManifest(file, canonicalJson(record));
  fs.writeFileSync(`${file}.sha256`, `${digest}\n`, 'utf8');
  return digest;
}

export function loadCase(id: string): DemoCase | null {
  if (!CASE_ID.test(id)) return null;
  const file = path.join(dataRoot(), 'cases', `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, 'utf8');
  const sidecar = `${file}.sha256`;
  if (fs.existsSync(sidecar) && fs.readFileSync(sidecar, 'utf8').trim() !== sha256(body)) {
    throw new Error(`case_hash_mismatch:${id}`);
  }
  return JSON.parse(body) as DemoCase;
}

/** Writes the frozen document once; the file name is its own sha256. Returns hash and path. */
export function freeze(document: unknown): { sha256: string; path: string } {
  const body = canonicalJson(document);
  const digest = sha256(body);
  const file = path.join(dataRoot(), 'frozen', `${digest}.json`);
  if (!fs.existsSync(file)) writeWithManifest(file, body);
  return { sha256: digest, path: file };
}

/** Reads a frozen document and refuses it if the bytes no longer match the name. */
export function loadFrozen(digest: string): { body: string; document: unknown } {
  if (!SHA.test(digest)) throw new Error('invalid_frozen_hash');
  const file = path.join(dataRoot(), 'frozen', `${digest}.json`);
  const body = fs.readFileSync(file, 'utf8');
  if (sha256(body) !== digest) throw new Error(`frozen_hash_mismatch:${digest}`);
  return { body, document: JSON.parse(body) };
}

const BLOB_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Content-addressed attachment store (K-54): <root>/blobs/<sha256>.<ext>, written once. */
export function putBlob(buf: Buffer, mime: 'image/jpeg' | 'image/png'): string {
  const digest = sha256(buf);
  const file = path.join(dataRoot(), 'blobs', `${digest}.${BLOB_EXT[mime]}`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    appendManifest(file, digest);
  }
  return digest;
}

/** Reads an attachment and refuses it unless its bytes still hash to the frozen value. */
export function loadBlob(digest: string, mime: 'image/jpeg' | 'image/png'): Buffer {
  if (!SHA.test(digest)) throw new Error('invalid_attachment_hash');
  const file = path.join(dataRoot(), 'blobs', `${digest}.${BLOB_EXT[mime]}`);
  if (!fs.existsSync(file)) throw new Error(`attachment_missing:${digest}`);
  const buf = fs.readFileSync(file);
  if (sha256(buf) !== digest) throw new Error(`attachment_hash_mismatch:${digest}`);
  return buf;
}
