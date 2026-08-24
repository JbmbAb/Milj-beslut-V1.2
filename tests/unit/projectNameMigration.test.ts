import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20260824110000_add_project_name/migration.sql'),
  'utf8',
);

describe('canonical Project name migration', () => {
  it('matches the nullable Project name schema contract', () => {
    expect(schema).toMatch(/model Project \{[\s\S]*?name\s+String\?/);
    expect(migration).toMatch(/ALTER TABLE "Project"\s+ADD COLUMN "name" TEXT/);
  });

  it('does not invent a default or alter historical project meaning', () => {
    expect(migration).not.toMatch(/DEFAULT|NOT NULL|UPDATE "Project"/);
  });
});
