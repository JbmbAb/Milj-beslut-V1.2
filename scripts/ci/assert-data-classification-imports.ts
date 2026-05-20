import fs from 'node:fs';
import path from 'node:path';

/**
 * CI Architecture Guard (Phase 0 / Phase 2)
 * Enforces the Data Classification Matrix.
 * 
 * Rules:
 * 1. ONLY services/dossier/ is allowed to import from services/geodata/
 * 2. components/ and routes/ are FORBIDDEN from importing services/geodata/ directly.
 * 3. services/orchestrator/ (Vertex) is FORBIDDEN from importing services/geodata/ directly.
 */

const FORBIDDEN_DIRS = [
  path.resolve(process.cwd(), 'components'),
  path.resolve(process.cwd(), 'app', 'routes'), // Remix routes
  path.resolve(process.cwd(), 'server', 'routes'),
  path.resolve(process.cwd(), 'services', 'orchestrator')
];

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const violations: Array<{ file: string; line: string; reason: string }> = [];

for (const dir of FORBIDDEN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  
  const files = walk(dir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.includes('services/geodata') || line.includes('geodata/sguService') || line.includes('geodata/lantmaterietTopoService')) {
        violations.push({ 
            file, 
            line: line.trim(),
            reason: 'Rule: K1 Geodata schemas are strictly owned by Geodata services. Access must go via DossierBuilder.'
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n❌ CI ARCHITECTURE GUARD FAILED: Data Classification Matrix Violation!');
  for (const v of violations) {
    console.error(`- ${path.relative(process.cwd(), v.file)}`);
    console.error(`  Line: ${v.line}`);
    console.error(`  ${v.reason}\n`);
  }
  process.exit(2);
}

console.log('✅ OK: Data Classification Matrix enforced (no illegal geodata imports).');
