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
    process.env[key] = stripQuotes(rawValue);
  }
}
