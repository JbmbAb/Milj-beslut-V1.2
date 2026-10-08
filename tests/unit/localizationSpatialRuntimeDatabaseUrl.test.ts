import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W-U402 (U40-2, point 2) -- the localization spatial runtime fails closed without DATABASE_URL.
 *
 * `createLocalizationSpatialRuntime` used `process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mimer"`
 * (spec U40-U50B §0 point 4, U40-A-DOCKER-VERIFICATION F2): with the DATABASE_URL gone, every LU spatial query went to a
 * hard-coded credential URL on localhost -- in a container the container itself, on a host the host's 5432, which is
 * the shared PostGIS. Now: no DATABASE_URL (absent or blank) is a typed refusal (DATABASE_URL_REQUIRED) BEFORE anything
 * is opened -- no CAS, no pool; with a DATABASE_URL the provider gets exactly that URL, unchanged.
 *
 * Hermetic: the PostGIS provider is replaced by a recorder (its constructor is where the pool would be created), so no
 * connection can be made in any case.
 */

const constructed = vi.hoisted(() => [] as string[]);

vi.mock('@miljobeslut/spatial-provider-postgis', () => ({
  SpatialProviderPostGIS: class {
    constructor(connectionString: string) {
      constructed.push(connectionString);
    }
    async close(): Promise<void> {}
    async wgs84ToSweref99(): Promise<readonly [number, number]> {
      return [0, 0];
    }
    async sweref99ToWgs84(): Promise<readonly [number, number]> {
      return [0, 0];
    }
  },
}));

import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { createLocalizationSpatialRuntime } from '../../server/modules/localization/createLocalizationSpatialRuntime';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SENTINEL_DATABASE_URL = 'postgresql://u402-spatial:x@127.0.0.1:1/u402_spatial_sentinel';

let saved: string | undefined;
let hadValue: boolean;

beforeEach(() => {
  hadValue = Object.prototype.hasOwnProperty.call(process.env, 'DATABASE_URL');
  saved = process.env.DATABASE_URL;
  constructed.length = 0;
});

afterEach(() => {
  if (hadValue) process.env.DATABASE_URL = saved;
  else delete process.env.DATABASE_URL;
  vi.restoreAllMocks();
});

describe('createLocalizationSpatialRuntime without DATABASE_URL: typed refusal, nothing opened', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('DATABASE_URL %s -> DATABASE_URL_REQUIRED, no provider (no pool), no CAS opened', async (_label, value) => {
    if (value === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = value;
    const openCas = vi.spyOn(MimersIntegration, 'create');

    await expect(createLocalizationSpatialRuntime()).rejects.toMatchObject({ code: 'DATABASE_URL_REQUIRED' });
    await expect(createLocalizationSpatialRuntime()).rejects.toThrow(/^DATABASE_URL_REQUIRED: .*localization spatial runtime/);
    expect(constructed, 'no PostGIS provider -- and so no pool -- may be created').toEqual([]);
    expect(openCas, 'the refusal comes before the CAS is opened').not.toHaveBeenCalled();
  });
});

describe('createLocalizationSpatialRuntime with DATABASE_URL: unchanged', () => {
  it('the provider gets exactly the configured URL', async () => {
    process.env.DATABASE_URL = SENTINEL_DATABASE_URL;
    const runtime = await createLocalizationSpatialRuntime();
    expect(constructed).toEqual([SENTINEL_DATABASE_URL]);
    expect(runtime.artifactRepository).toBeDefined();
    await runtime.close();
  });
});

describe('source pin', () => {
  it('the composition root names no default database (no localhost, no built-in credentials)', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'server/modules/localization/createLocalizationSpatialRuntime.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/localhost|127\.0\.0\.1|postgres:postgres|:5432/);
  });
});
