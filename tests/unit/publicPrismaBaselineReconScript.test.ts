import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const catalogSql = readFileSync(resolve(root, 'scripts/db/public-prisma-baseline-catalog.sql'), 'utf8');
const captureScript = readFileSync(
  resolve(root, 'scripts/db/capture-public-prisma-baseline-recon.ps1'),
  'utf8',
);

function withoutSqlComments(text: string): string {
  return text.replace(/--.*$/gm, '');
}

describe('PUBLIC-PRISMA-BASELINE-RECONCILIATION-01 capture tooling', () => {
  it('keeps the catalog probe SELECT-only', () => {
    const executableSql = withoutSqlComments(catalogSql);

    expect(executableSql).not.toMatch(
      /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COMMENT)\b/i,
    );
    expect(executableSql).toContain("n.nspname = 'public'");
    expect(executableSql).toContain('pg_get_constraintdef');
    expect(executableSql).toContain('pg_get_indexdef');
    expect(executableSql).toContain('pg_get_functiondef');
    expect(executableSql).toContain('FROM pg_policies');
    expect(executableSql).toContain('FROM pg_sequences');
    expect(executableSql).toContain('extension_members AS');
    expect(executableSql).toContain("d.deptype = 'e'");
    expect(executableSql).toContain("p.prokind IN ('f', 'p')");
  });

  it('forces PostgreSQL sessions into read-only mode', () => {
    expect(captureScript).toContain("$env:PGOPTIONS = '-c default_transaction_read_only=on'");
    expect(captureScript).toContain('$env:PGOPTIONS = $previousPgOptions');
    expect(captureScript).toContain('$env:PGDATABASE = $DatabaseUrl');
    expect(captureScript).toContain('$env:PGDATABASE = $previousPgDatabase');
    expect(captureScript).not.toContain('"--dbname=$DatabaseUrl"');
  });

  it('positively binds both database identity and repository HEAD', () => {
    expect(captureScript).toContain('[string]$ExpectedDatabaseName');
    expect(captureScript).toContain('[string]$ExpectedHeadSha');
    expect(captureScript).toContain('SELECT current_database();');
    expect(captureScript).toContain('Database target mismatch.');
    expect(captureScript).toContain('HEAD mismatch.');
    expect(captureScript).toContain(
      'Working tree is not clean. Run this capture from a clean checkout/worktree.',
    );
  });

  it('captures schema and history without applying migrations', () => {
    expect(captureScript).toContain("'--schema-only'");
    expect(captureScript).toContain("'--schema=public'");
    expect(captureScript).toContain('prisma-migrations-ledger.json');
    expect(captureScript).toContain('migration-files.json');
    expect(captureScript).toContain('checksums.sha256');

    expect(captureScript).not.toMatch(/\bprisma\s+migrate\b/i);
    expect(captureScript).not.toMatch(/\bprisma\s+db\s+(push|execute)\b/i);
  });

  it('never persists the supplied database URL into the capture metadata', () => {
    expect(captureScript).toContain('database_url_persisted = $false');
    expect(captureScript).not.toContain('database_url = $DatabaseUrl');
  });
});
