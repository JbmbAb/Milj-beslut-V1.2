import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SguBulkImportJob } from '../../server/datasources/sguBulkImportManifest';
import { testTmpDir } from '../helpers/testPaths';

const fixtureManifest = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sgu/discovered-manifest.min.json',
);

let getSguBulkImportJobs: () => SguBulkImportJob[];
let resolveSguSourcePath: (downloadDir: string, job: SguBulkImportJob) => string;

describe('sguBulkImportEngine', () => {
  beforeAll(async () => {
    process.env.SGU_DISCOVERED_MANIFEST_PATH = fixtureManifest;
    vi.resetModules();
    const manifest = await import('../../server/datasources/sguBulkImportManifest');
    const engine = await import('../../scripts/import/sguBulkImportEngine');
    getSguBulkImportJobs = manifest.getSguBulkImportJobs;
    resolveSguSourcePath = engine.resolveSguSourcePath;
  });

  it('resolveSguSourcePath builds vsizip GDAL path', () => {
    const job = getSguBulkImportJobs().find(
      (j) => j.zipFile === 'jordarter25k-100k.zip' && j.layer === 'grundlager',
    );
    expect(job).toBeDefined();
    const src = resolveSguSourcePath(testTmpDir('sgu-downloads'), job!);
    expect(src).toContain('/vsizip/');
    expect(src).toContain('jordarter25k-100k.zip');
    expect(src).toContain('jordarter25k_100k.gpkg');
    expect(job!.layer).toBe('grundlager');
  });

  it('ytlager 25k maps to sgu_ytlager_25k_100k', () => {
    const job = getSguBulkImportJobs().find(
      (j) => j.layer === 'ytlager' && j.zipFile === 'jordarter25k-100k.zip',
    );
    expect(job?.table).toBe('env.sgu_ytlager_25k_100k');
  });

  it('grundlager maps to sgu_soil_type_25k_100k', () => {
    const job = getSguBulkImportJobs().find(
      (j) => j.layer === 'grundlager' && j.zipFile === 'jordarter25k-100k.zip',
    );
    expect(job?.table).toBe('env.sgu_soil_type_25k_100k');
    expect(job?.priority).toBeGreaterThanOrEqual(99_000);
  });

  it('includes representative SGU products from manifest', () => {
    const jobs = getSguBulkImportJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.some((j) => j.zipFile === 'jordskred-raviner.zip')).toBe(true);
    expect(jobs.some((j) => j.zipFile === 'fastmark.zip')).toBe(true);
    expect(jobs.some((j) => j.zipFile === 'stranderosion-kust.zip')).toBe(true);
  });
});
