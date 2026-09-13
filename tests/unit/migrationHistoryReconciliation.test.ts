import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(
    root,
    'prisma/migrations/20260913080000_reconcile_canonical_schema_history/migration.sql',
  ),
  'utf8',
);

describe('MIGRATION-HISTORY-RECONCILIATION-01', () => {
  it('reconciles BankIdSession.identity_environment to the canonical LEGACY contract', () => {
    expect(schema).toMatch(
      /model BankIdSession \{[\s\S]*?identityEnvironment\s+String\s+@default\("LEGACY"\)\s+@map\("identity_environment"\)/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "public"\."BankIdSession"[\s\S]*?ADD COLUMN "identity_environment" TEXT NOT NULL DEFAULT 'LEGACY'/,
    );
    expect(migration).toContain('MIGRATION_HISTORY_RECONCILIATION_M2_INCOMPATIBLE');
  });

  it('reconciles User.organisationId nullability without removing its relation', () => {
    expect(schema).toMatch(
      /model User \{[\s\S]*?organisationId\s+String\?[\s\S]*?organisation\s+Organisation\?\s+@relation\(fields: \[organisationId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "public"\."User"[\s\S]*?ALTER COLUMN "organisationId" DROP NOT NULL/,
    );
    expect(migration).toContain('MIGRATION_HISTORY_RECONCILIATION_M3_INCOMPATIBLE');
  });

  it('creates the project_context_bindings runtime projection with the canonical contract', () => {
    expect(schema).toMatch(
      /model ProjectContextBinding \{[\s\S]*?@@unique\(\[projectId, projectContextArtifactId, projectContextArtifactType\]\)[\s\S]*?@@index\(\[projectId, projectContextArtifactId, projectContextArtifactType\]\)[\s\S]*?@@map\("project_context_bindings"\)/,
    );

    for (const column of [
      'id',
      'project_id',
      'binding_artifact_id',
      'project_context_artifact_id',
      'project_context_artifact_type',
      'binding_version',
      'authority_artifact_id',
      'authority_artifact_type',
      'created_at',
    ]) {
      expect(migration).toContain(`"${column}"`);
    }

    expect(migration).toMatch(
      /FOREIGN KEY \("project_id"\) REFERENCES "public"\."Project"\("id"\)[\s\S]*?ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toContain('project_context_bindings_binding_artifact_id_key');
    expect(migration).toContain('project_context_bindings_project_id_project_context_artifac_key');
    expect(migration).toContain('project_context_bindings_project_id_project_context_artifac_idx');
    expect(migration).toContain('MIGRATION_HISTORY_RECONCILIATION_M4_INCOMPATIBLE');
  });

  it('does not reintroduce the already-canonical Project.name migration', () => {
    expect(migration).not.toMatch(/ALTER TABLE "public"\."Project"[\s\S]*?ADD COLUMN "name"/);
    expect(migration).not.toMatch(/ALTER TABLE "Project"[\s\S]*?ADD COLUMN "name"/);
  });
});
