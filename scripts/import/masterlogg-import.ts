import fs from 'node:fs/promises';
import path from 'node:path';

const VALID_STATUS = new Set([
  'EJ_KONTAKTAD',
  'FORFRAGAN_SKICKAD',
  'PAMINNELSE_SKICKAD',
  'DELVIS_SVAR',
  'FULLT_SVAR',
  'KRAVER_AVGIFT',
  'KRAVER_LOSENORD',
  'HANVISAT_TILL_ETJANST',
  'AVSLAG_ELLER_INGET',
  'BEHOVER_FOLJDFRAGA',
  'MIGRERAD_TILL_DB',
  'KVALITETSGRANSKAD',
]);

const REQUIRED_COLUMNS = [
  'kommunnamn',
  'status',
  'senaste_kontakt',
] as const;

type MasterloggRow = Record<string, string>;

type ImportResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  statusCounts: Record<string, number>;
  errors: Array<{ row: number; message: string }>;
};

function getArg(name: string): string | undefined {
  const arg = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg.slice(name.length + 3).trim();
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ';' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function toBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'ja'].includes(normalized);
}

function normalizeStatus(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized.replace(/\s+/g, '_');
}

function validateRow(row: MasterloggRow, rowIndex: number): string[] {
  const errors: string[] = [];

  for (const key of REQUIRED_COLUMNS) {
    if (!String(row[key] || '').trim()) {
      errors.push(`Missing required field: ${key}`);
    }
  }

  const status = normalizeStatus(row.status || '');
  if (!VALID_STATUS.has(status)) {
    errors.push(`Invalid status: ${row.status || '(empty)'}`);
  }

  const hasBilagor = toBoolean(row.har_bilagor || 'false');
  const antalBilagor = Number(row.antal_bilagor || '0');
  if (hasBilagor && (!Number.isFinite(antalBilagor) || antalBilagor <= 0)) {
    errors.push('har_bilagor=true but antal_bilagor <= 0');
  }

  const parsedDate = Date.parse(row.senaste_kontakt || '');
  if (Number.isNaN(parsedDate)) {
    errors.push('Invalid senaste_kontakt date');
  }

  if (errors.length > 0) {
    return errors.map((message) => `Row ${rowIndex}: ${message}`);
  }
  return [];
}

function normalizeRow(row: MasterloggRow): MasterloggRow {
  return {
    ...row,
    status: normalizeStatus(row.status || ''),
    kommunnamn: String(row.kommunnamn || '').trim(),
    kontakt_epost: String(row.kontakt_epost || '').trim().toLowerCase(),
    senaste_kontakt: new Date(row.senaste_kontakt).toISOString(),
    avgift_omnand: String(toBoolean(row.avgift_omnand || 'false')),
    losenord_omnand: String(toBoolean(row.losenord_omnand || 'false')),
    har_bilagor: String(toBoolean(row.har_bilagor || 'false')),
    migrerad_flagg: String(toBoolean(row.migrerad_flagg || 'false')),
    kvalitetsgranskad: String(toBoolean(row.kvalitetsgranskad || 'false')),
  };
}

function toJsonlLine(row: MasterloggRow): string {
  return JSON.stringify(row);
}

async function readCsvRows(filePath: string): Promise<MasterloggRow[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 1) {
    throw new Error('CSV must include header.');
  }
  if (lines.length === 1) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: MasterloggRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: MasterloggRow = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

async function main() {
  const input = getArg('input') || path.join('docs', 'ops', 'masterlogg-schema.csv');
  const output = getArg('out') || path.join('Sammanstallning', 'masterlogg.normalized.jsonl');
  const dryRun = hasFlag('dry-run');

  const rows = await readCsvRows(input);
  const errors: Array<{ row: number; message: string }> = [];
  const normalizedRows: MasterloggRow[] = [];
  const statusCounts: Record<string, number> = {};

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const rowErrors = validateRow(row, i + 2);
    if (rowErrors.length > 0) {
      for (const message of rowErrors) {
        errors.push({ row: i + 2, message });
      }
      continue;
    }

    const normalized = normalizeRow(row);
    normalizedRows.push(normalized);
    statusCounts[normalized.status] = (statusCounts[normalized.status] || 0) + 1;
  }

  const result: ImportResult = {
    totalRows: rows.length,
    validRows: normalizedRows.length,
    invalidRows: rows.length - normalizedRows.length,
    statusCounts,
    errors,
  };

  console.log('Masterlogg import summary');
  console.log(JSON.stringify(result, null, 2));

  if (!dryRun) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const jsonl = normalizedRows.map(toJsonlLine).join('\n');
    await fs.writeFile(output, `${jsonl}\n`, 'utf8');
    console.log(`Wrote normalized rows to: ${output}`);
  } else {
    console.log('Dry-run enabled, no files written.');
  }

  if (errors.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('Import failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
