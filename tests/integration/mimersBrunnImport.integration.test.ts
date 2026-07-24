import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveImportArchiveRoot,
  resolveImportSourceRoot,
  isSubPath,
} from '../../server/services/importPathService';
import { masterArchiveFixtureRoot } from '../helpers/integrationAuth';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('Mimers Brunn import paths integration', () => {
  it('resolves archive roots from fixture env without mocks', () => {
    const fixtureRoot = masterArchiveFixtureRoot();
    process.env.IMPORT_ARCHIVE_ROOT = fixtureRoot;
    process.env.IMPORT_SOURCE_ROOT = path.join(fixtureRoot, 'Data');

    expect(resolveImportArchiveRoot()).toBe(fixtureRoot);
    expect(resolveImportSourceRoot()).toContain('master-archive');
    expect(isSubPath(fixtureRoot, path.join(fixtureRoot, 'Data/Lantmateriet'))).toBe(true);
    expect(isSubPath(fixtureRoot, path.resolve('/outside'))).toBe(false);

    delete process.env.IMPORT_ARCHIVE_ROOT;
    delete process.env.IMPORT_SOURCE_ROOT;
  });

  it('fixture manifest exists on disk for LM registerenhetsomradesytor', () => {
    const manifestPath = path.join(
      masterArchiveFixtureRoot(),
      'Data/Lantmateriet/Fastighetsindelning/Registerenhetsomradesytor/manifest.json',
    );
    expect(fs.existsSync(manifestPath)).toBe(true);
  });
});
