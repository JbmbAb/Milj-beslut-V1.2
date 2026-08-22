import fs from 'node:fs';
import path from 'node:path';

type LoadEnvOptions = {
  includePrefixes?: string[];
  overrideExisting?: boolean;
};

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// This loader is line-based (splits the file on real newlines), so a multi-line value -- e.g. a
// PEM-encoded key -- cannot be represented directly. The established convention for such values
// is to flatten real newlines to the literal two-character sequence \n on a single .env line; this
// unescapes that back to a real newline after quote-stripping. A value with no literal \n is
// returned unchanged.
function unescapeNewlines(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export function loadEnvFile(fileName: string = '.env', options: LoadEnvOptions = {}): void {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const includePrefixes = options.includePrefixes?.filter(Boolean) || [];
  const overrideExisting = options.overrideExisting === true;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    if (includePrefixes.length > 0 && !includePrefixes.some((prefix) => key.startsWith(prefix))) continue;
    if (!overrideExisting && process.env[key]) continue;

    const rawValue = trimmed.slice(eq + 1).trim();
    process.env[key] = unescapeNewlines(stripQuotes(rawValue));
  }
}
