import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20260824100000_add_user_identity_environment/migration.sql'),
  'utf8',
);

describe('canonical User identity environment migration', () => {
  it('matches the non-null LEGACY schema contract for User', () => {
    expect(schema).toMatch(
      /model User \{[\s\S]*?identityEnvironment\s+String\s+@default\("LEGACY"\)\s+@map\("identity_environment"\)/,
    );
    expect(migration).toMatch(/ALTER TABLE "User"\s+ADD COLUMN "identity_environment" TEXT NOT NULL DEFAULT 'LEGACY'/);
  });

  it('keeps the migration scoped to the proven User schema drift', () => {
    expect(migration).not.toMatch(/BankIdSession/);
  });
});
