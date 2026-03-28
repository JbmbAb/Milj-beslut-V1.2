import fs from 'node:fs/promises';
import path from 'node:path';

export const CSV_SEPARATOR = ';';

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function normalizeKey(value) {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[^\w]/g, '')
    .toLowerCase();
}

export function parseCsv(content, separator = CSV_SEPARATOR) {
  const rows = [];
  const source = String(content || '').replace(/^\uFEFF/, '');
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === separator) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  const isSingleEmptyRow = row.length === 1 && normalizeText(row[0]) === '' && rows.length === 0;
  if (!isSingleEmptyRow) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header) => normalizeText(header));
  const records = rows.slice(1).filter((line) => line.some((value) => normalizeText(value) !== '')).map((line) => {
    const record = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = normalizeText(line[index] ?? '');
    }
    return record;
  });

  return { headers, records };
}

export function toCsv(headers, records, separator = CSV_SEPARATOR) {
  const escaped = (value) => {
    const raw = String(value ?? '');
    if (raw.includes('"') || raw.includes('\n') || raw.includes('\r') || raw.includes(separator)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  const lines = [headers.join(separator)];
  for (const record of records) {
    lines.push(headers.map((header) => escaped(record[header] ?? '')).join(separator));
  }
  return `${lines.join('\n')}\n`;
}

export async function readCsvFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseCsv(content, CSV_SEPARATOR);
}

export async function writeCsvFile(filePath, headers, records) {
  await ensureDir(path.dirname(filePath));
  const csv = toCsv(headers, records, CSV_SEPARATOR);
  await fs.writeFile(filePath, csv, 'utf8');
}

export async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(String(content).replace(/^\uFEFF/, ''));
}

export async function writeJsonFile(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function copyFileSafe(source, target) {
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
}

export function timestampSlug(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}Z`;
}

export function pickFirst(record, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      const value = normalizeText(record[name]);
      if (value !== '') return value;
    }
  }
  return '';
}

export function toUpper(value) {
  return normalizeText(value).toUpperCase();
}

export function toLower(value) {
  return normalizeText(value).toLowerCase();
}

export function yesNoToBool(value) {
  const lowered = toLower(value);
  return lowered === 'ja' || lowered === 'yes' || lowered === 'true' || lowered === '1';
}
