import { describe, expect, it } from 'vitest';

import {
  BootstrapDatabaseTargetError,
  resolveBootstrapDatabaseTarget,
} from '../../scripts/db/resolveBootstrapDatabaseTarget';

describe('bootstrap-production-db target admission', () => {
  it('requires DATABASE_URL', () => {
    expect(() => resolveBootstrapDatabaseTarget({ DB_BOOTSTRAP_CONFIRM: 'yes' })).toThrow(
      BootstrapDatabaseTargetError,
    );
  });

  it('requires explicit operator confirmation', () => {
    expect(() =>
      resolveBootstrapDatabaseTarget({
        DATABASE_URL: 'postgresql://miljobeslut:pw@db:5432/miljobeslut_staging',
      }),
    ).toThrow(/DB_BOOTSTRAP_CONFIRM=yes/);
  });

  it('admits a confirmed staging target', () => {
    expect(
      resolveBootstrapDatabaseTarget({
        DATABASE_URL: 'postgresql://miljobeslut:pw@db:5432/miljobeslut_staging',
        DB_BOOTSTRAP_CONFIRM: 'yes',
      }),
    ).toMatchObject({
      databaseName: 'miljobeslut_staging',
    });
  });
});

describe('bootstrap-production-db orchestration order', () => {
  it('runs admission before any database connection is created', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'scripts/db/bootstrap-production-db.ts'), 'utf8');

    expect(source.indexOf('resolveBootstrapDatabaseTarget')).toBeGreaterThan(-1);
    expect(source.indexOf('new Pool')).toBeGreaterThan(source.indexOf('resolveBootstrapDatabaseTarget'));
    expect(source.indexOf('npx --no-install prisma migrate deploy')).toBeGreaterThan(
      source.indexOf('ensureProductionDatabaseExtensions'),
    );
    expect(source.indexOf('npx --no-install tsx scripts/db/spatial-bootstrap.ts')).toBeGreaterThan(
      source.indexOf('npx --no-install prisma migrate deploy'),
    );
    expect(source.indexOf('const readiness = await verifyProductionDatabaseReadiness')).toBeGreaterThan(
      source.indexOf('spatial-bootstrap.ts'),
    );
  });

  it('fails closed instead of letting npx download an unpinned Prisma CLI', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'scripts/db/bootstrap-production-db.ts'), 'utf8');

    expect(source).toContain('npx --no-install prisma migrate deploy');
    expect(source).not.toContain('npx prisma migrate deploy');
  });
});
