/**
 * Consumer of the ingestion lane's D2 delivery (K-24). DEMO-01 reads it, never writes it and never
 * copies it into the repo. Default dir: C:\wt-outlook-mimer-ingestion\out\demo-01
 * (override DEMO_C_ANMALAN_CORPUS_DIR).
 *
 * Rows that break the K-24 contract are dropped and counted, never repaired: no SHA or page →
 * no row; person_masked !== true → no row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './caseStore';
import type { RequirementsSourceStatus } from './types';

export const DEMO_CODES = ['90.30', '90.40', '90.131'] as const;
export const KRAV_TYPER = ['försiktighetsmått', 'kontrollpunkt', 'kompletteringskrav', 'villkor'] as const;
export const DOKUMENTTYPER = ['anmälan', 'beslut', 'föreläggande', 'komplettering'] as const;

export interface RequirementRow {
  row_id: string;
  document_sha256: string;
  page: number;
  chunk_id: string;
  kommun: string;
  diarienummer: string;
  dokumenttyp: (typeof DOKUMENTTYPER)[number];
  beslutsdatum: string | null;
  mpf_kod: string;
  krav_typ: (typeof KRAV_TYPER)[number];
  citat: string;
  metod: string | null;
  frekvens: string | null;
  ansvarig: string | null;
  dokumentationskrav: string | null;
  extraction_rule_id: string;
  verified: boolean;
  person_masked: true;
}

export interface CoverageRow {
  kommun: string;
  mpf_kod: string;
  n_dokument: number;
}

export function corpusDir(): string {
  return process.env.DEMO_C_ANMALAN_CORPUS_DIR || 'C:\\wt-outlook-mimer-ingestion\\out\\demo-01';
}

const SHA = /^[a-f0-9]{64}$/;
/** Double-encoded UTF-8 ("Ã¥", "Ã¤", "Ã¶", …): such a quote is not a faithful verbatim span. */
export const MOJIBAKE = /Ã[\u0080-¿–—‘-„†‡…]/;
// NFC so composed/decomposed å/ä/ö compare equal. Mojibake (double-encoded UTF-8) is NOT repaired.
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.normalize('NFC').trim() : null);

/** Pure: validates one parsed JSONL object against the K-24 contract. */
export function parseRequirementRow(raw: unknown): RequirementRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const page = Number(r.page);
  const row = {
    row_id: str(r.row_id),
    document_sha256: str(r.document_sha256)?.toLowerCase() ?? null,
    page,
    chunk_id: str(r.chunk_id) ?? '',
    kommun: str(r.kommun),
    diarienummer: str(r.diarienummer) ?? '',
    dokumenttyp: str(r.dokumenttyp),
    beslutsdatum: str(r.beslutsdatum),
    mpf_kod: str(r.mpf_kod),
    krav_typ: str(r.krav_typ),
    citat: str(r.citat),
    metod: str(r.metod),
    frekvens: str(r.frekvens),
    ansvarig: str(r.ansvarig),
    dokumentationskrav: str(r.dokumentationskrav),
    extraction_rule_id: str(r.extraction_rule_id),
    verified: r.verified === true,
    person_masked: r.person_masked,
  };
  if (!row.row_id || !row.document_sha256 || !SHA.test(row.document_sha256)) return null;
  if (!Number.isInteger(page) || page < 1) return null;
  if (!row.kommun || !row.mpf_kod || !row.citat || !row.extraction_rule_id) return null;
  if (!KRAV_TYPER.includes(row.krav_typ as never)) return null;
  if (!DOKUMENTTYPER.includes(row.dokumenttyp as never)) return null;
  if (row.person_masked !== true) return null;
  if ([row.citat, row.krav_typ, row.kommun, row.dokumenttyp].some((v) => v && MOJIBAKE.test(v))) return null;
  return row as RequirementRow;
}

/** README.md lists "<sha256>  <file>" (or "<file> <sha256>") lines; returns file → sha. */
export function parseReadmeHashes(readme: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readme.split(/\r?\n/)) {
    const sha = line.match(/\b[a-f0-9]{64}\b/i)?.[0];
    const file = line.match(/[\w.-]+\.(?:jsonl|csv|md)\b/)?.[0];
    if (sha && file && file !== 'README.md') out.set(file, sha.toLowerCase());
  }
  return out;
}

export interface LoadedRequirements {
  status: RequirementsSourceStatus;
  rows: RequirementRow[];
  coverage: CoverageRow[];
}

export function loadRequirements(dir = corpusDir()): LoadedRequirements {
  const file = path.join(dir, 'requirements.jsonl');
  if (!fs.existsSync(file)) {
    return {
      status: { state: 'missing', dir, message: 'Kommunkorpusens kravtabell (D2, K-24) är inte levererad ännu.' },
      rows: [],
      coverage: [],
    };
  }
  const body = fs.readFileSync(file);
  const fileSha256 = sha256(body);
  const readmePath = path.join(dir, 'README.md');
  const expected = fs.existsSync(readmePath) ? parseReadmeHashes(fs.readFileSync(readmePath, 'utf8')).get('requirements.jsonl') : undefined;
  if (expected && expected !== fileSha256) {
    return {
      status: { state: 'invalid', dir, file, fileSha256, message: `requirements.jsonl matchar inte README.md (väntat ${expected.slice(0, 12)}…).` },
      rows: [],
      coverage: [],
    };
  }
  const rows: RequirementRow[] = [];
  let invalid = 0;
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalid += 1;
      continue;
    }
    const row = parseRequirementRow(parsed);
    if (row) rows.push(row);
    else invalid += 1;
  }
  return {
    status: {
      state: 'loaded',
      dir,
      file,
      fileSha256,
      rowCount: rows.length,
      invalidRows: invalid,
      message: `${rows.length} krav inlästa${invalid ? `, ${invalid} rader avvisade (bryter K-24)` : ''}${expected ? '' : '; README.md saknar hash för filen'}.`,
    },
    rows,
    coverage: loadCoverage(dir),
  };
}

function loadCoverage(dir: string): CoverageRow[] {
  const file = path.join(dir, 'coverage.csv');
  if (!fs.existsSync(file)) return [];
  const [header, ...lines] = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const cols = header.split(/[;,]/).map((c) => c.trim().toLowerCase());
  const iK = cols.indexOf('kommun');
  const iC = cols.findIndex((c) => c === 'mpf_kod' || c === 'kod');
  const iN = cols.findIndex((c) => ['n_dokument', 'antal_dokument', 'n', 'antal'].includes(c));
  if (iK < 0 || iC < 0 || iN < 0) return [];
  return lines
    .map((l) => l.split(/[;,]/))
    .map((c) => ({ kommun: c[iK]?.trim(), mpf_kod: c[iC]?.trim(), n_dokument: Number(c[iN]) }))
    .filter((r) => r.kommun && r.mpf_kod && Number.isFinite(r.n_dokument)) as CoverageRow[];
}
