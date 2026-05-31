import fs from 'node:fs';
import path from 'node:path';

/**
 * Pre-Wave-2 guard: server/routes must be thin HTTP adapters.
 * - No direct imports from server/services, server/repositories, or db entrypoints.
 * - Call-sites go through server/modules (public facades + adapters).
 */

const ROOT = path.resolve(process.cwd(), 'server', 'routes');

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = fs.existsSync(ROOT) ? walk(ROOT) : [];
const violations: Array<{ file: string; line: string }> = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const hitsServices = line.includes("from '../services/") || line.includes('from "../services/');
    const hitsRepos = line.includes("from '../repositories/") || line.includes('from "../repositories/');
    if (hitsServices || hitsRepos) {
      violations.push({ file, line: line.trim() });
    }
  }
}

if (violations.length > 0) {
   
  console.error(
    'CI ARCHITECTURE GUARD FAILED: server/routes must not import services, repositories, or db clients directly (use server/modules).',
  );
  for (const v of violations) {
     
    console.error('- ' + path.relative(process.cwd(), v.file) + ' :: ' + v.line);
  }
  process.exit(2);
}

 
console.log('OK: routes are thin (no direct services/repositories/db imports)');
