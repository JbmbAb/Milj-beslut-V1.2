import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { findPrimaryFile, processManifest } from '../../scripts/import/import-librarian-manifest';
import { masterArchiveFixtureRoot } from '../helpers/integrationAuth';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const prisma = new PrismaClient();

const LM_MANIFEST = path.join(
  masterArchiveFixtureRoot(),
  'Data/Lantmateriet/Fastighetsindelning/Registerenhetsomradesytor/manifest.json',
);
const LM_DATA_DIR = path.dirname(LM_MANIFEST);
const UNKNOWN_MANIFEST = path.join(masterArchiveFixtureRoot(), 'Data/Okand/Pony/manifest.json');

describeIfDatabaseIntegration('import-librarian-manifest integration (offline)', () => {
  beforeEach(async () => {
    try {
      await prisma.postgisImportBatch.deleteMany({
        where: { content_bundle_sha256: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456' },
      });
    } catch {
      // Table may be absent in partial local setups; migrate deploy should create it in CI.
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('findPrimaryFile resolves geojson from real fixture directory', async () => {
    const manifest = JSON.parse(fs.readFileSync(LM_MANIFEST, 'utf8'));
    const primary = await findPrimaryFile(manifest, LM_DATA_DIR);
    expect(primary).toContain('parcel.geojson');
  });

  it('processManifest plan mode reads registry without mocks', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
      origLog(...args);
    };

    try {
      await processManifest(LM_MANIFEST);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes('Registry Target: env.registerenhetsomradesytor'))).toBe(true);
    expect(logs.some((l) => l.includes('[DRY-RUN]') || l.includes('Would look for primary file'))).toBe(
      true,
    );
  });

  it('skips import when content_bundle_sha256 already SUCCESS in database', async () => {
    await prisma.postgisImportBatch.create({
      data: {
        target_schema: 'env',
        target_table: 'registerenhetsomradesytor',
        status: 'SUCCESS',
        manifest_path: LM_MANIFEST,
        content_bundle_sha256: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        import_mode: 'plan',
      },
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
      origLog(...args);
    };

    try {
      await processManifest(LM_MANIFEST);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes('SKIPPED'))).toBe(true);
  });

  it('rejects unknown provider via registry (offline)', async () => {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
      origError(...args);
    };

    try {
      await processManifest(UNKNOWN_MANIFEST);
    } finally {
      console.error = origError;
    }

    expect(errors.some((e) => e.includes('not registered'))).toBe(true);
  });
});
