import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1 — server presentation boundary regression.
 *
 * Companion to packages/mps-lu/tests/P4ALU03NoAlternateSpatialPath.test.ts, which guards the same
 * invariant inside the mps-lu package. This one guards the SERVER, which is where the bypass
 * actually lived: GET /api/spatial/evidence ran raw PostGIS, minted objects shaped like
 * SpatialEvidenceArtifact with fabricated ids and hashes, stamped them VERIFIED_OBSERVATION, and
 * served the result with no requireAuth.
 *
 * These are source-level assertions on purpose. They need no database, so they run in CI on every
 * change, and they fail the moment someone reintroduces a second presentation authority — which a
 * behavioural test against a route that no longer exists could not do.
 *
 * Every scan runs over COMMENT-STRIPPED source. Learned the hard way: the first version of this
 * file failed against its own tombstone comment, because prose that *describes* a forbidden
 * pattern is not the same as code that *performs* it. An architecture test that cannot tell those
 * apart would force future authors to avoid naming the thing they removed.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const SERVER_ROOT = join(REPO_ROOT, 'server');

/**
 * The superseded ungoverned presentation cluster. These modules still exist because a fixture test
 * imports them, but nothing on a production request path may reach them — which is exactly what
 * `no production server module imports the superseded cluster` below proves. They are excluded
 * from the forbidden-pattern scans because they are the very thing that was superseded; guarding
 * them would just restate that they are what they are.
 */
const SUPERSEDED_PRESENTATION_CLUSTER = [
  'server/services/geoPresentationContract.ts',
  'server/services/geoPresentationAdapter.ts',
  'server/services/cesiumL0L1Fixtures.ts',
];

/**
 * Resolve-only: reads an already-persisted SPATIAL_EVIDENCE artifact out of CAS and re-verifies its
 * content hash. It names the artifact_type in order to FETCH one, never to construct one.
 */
const RESOLVE_ONLY_FILES = ['server/modules/localization/resolveGovernedLocalizationPresentation.ts'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function toRepoPath(file: string): string {
  return relative(REPO_ROOT, file).split('\\').join('/');
}

function collectServerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
      found.push(full);
    }
  };
  walk(SERVER_ROOT);
  return found;
}

const SERVER_FILES = collectServerFiles();

function scanServer(
  predicate: (code: string) => boolean,
  options: { readonly exclude?: readonly string[] } = {},
): string[] {
  const exclude = new Set(options.exclude ?? []);
  return SERVER_FILES.map((file) => ({ path: toRepoPath(file), file }))
    .filter(({ path }) => !exclude.has(path))
    .filter(({ file }) => predicate(stripComments(readFileSync(file, 'utf8'))))
    .map(({ path }) => path);
}

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

describe('CESIUM-CANONICAL-PRESENTATION: the ungoverned spatial evidence route is gone', () => {
  it('registers no GET /api/spatial/evidence route anywhere in the server', () => {
    const offenders = scanServer((code) =>
      /router\.(get|post|put|all)\(\s*['"`]\/api\/spatial\/evidence/.test(code),
    );
    expect(offenders).toEqual([]);
  });

  it('leaves a tombstone in gis.routes.ts so the route is not silently recreated', () => {
    const source = readRepoFile('server/routes/gis.routes.ts');
    expect(source).toContain('REMOVED by CESIUM-CANONICAL-SPATIAL-PRESENTATION-3D-V1');
    expect(source).toContain('/api/localization/:projectId/viewer/evidence');
  });

  it('no longer simulates the canonical provider from the GIS route layer', () => {
    const code = stripComments(readRepoFile('server/routes/gis.routes.ts'));
    // The removed handler iterated the layer registry itself and hand-rolled DWithin queries.
    expect(code).not.toContain('SPATIAL_LAYER_REGISTRY');
    expect(code).not.toContain('GeoPresentationAdapter');
    expect(code).not.toMatch(/ST_DWithin/);
  });
});

describe('CESIUM-CANONICAL-PRESENTATION: no server module forges spatial evidence authority', () => {
  it('mints no SpatialEvidenceArtifact on any live server path', () => {
    const minting =
      /artifact_type:\s*['"`]SPATIAL_EVIDENCE['"`][\s\S]{0,400}\b(?:content_hash|payload)\b|\b(?:content_hash|payload)\b[\s\S]{0,400}artifact_type:\s*['"`]SPATIAL_EVIDENCE['"`]/;

    const offenders = scanServer((code) => minting.test(code), {
      exclude: [...SUPERSEDED_PRESENTATION_CLUSTER, ...RESOLVE_ONLY_FILES],
    });

    expect(offenders).toEqual([]);
  });

  it('stamps VERIFIED_OBSERVATION on no live server path — only ViewerKernel may assert it', () => {
    const offenders = scanServer((code) => code.includes('VERIFIED_OBSERVATION'), {
      exclude: SUPERSEDED_PRESENTATION_CLUSTER,
    });
    expect(offenders).toEqual([]);
  });

  it('has no production server importer of the superseded ungoverned presentation cluster', () => {
    // The cluster may import itself; what must not happen is anything else reaching into it.
    const offenders = scanServer(
      (code) => /from\s+['"][^'"]*geoPresentation(Adapter|Contract)['"]/.test(code),
      { exclude: SUPERSEDED_PRESENTATION_CLUSTER },
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the resolve-only exception genuinely resolve-only', () => {
    const code = stripComments(readRepoFile(RESOLVE_ONLY_FILES[0]!));
    // It may RESOLVE spatial evidence out of CAS...
    expect(code).toMatch(/resolve<SpatialEvidenceArtifact>/);
    // ...but it must never write one, nor mint a content hash for one.
    expect(code).not.toMatch(/\.put\(/);
    expect(code).not.toMatch(/artifact_id:\s*[`'"]evidence-/);
  });
});

describe('CESIUM-CANONICAL-PRESENTATION: exactly one governed presentation path remains', () => {
  it('serves the canonical governed viewer route behind authentication', () => {
    const code = stripComments(readRepoFile('server/routes/localization.routes.ts'));
    expect(code).toContain('/api/localization/:projectId/viewer/evidence');
    expect(code).toContain('requireAuth');
    expect(code).toContain('resolveLuViewerPresentation');
  });

  it('keeps the governed presentation path free of any live PostGIS dependency', () => {
    // This is what makes presentation replay-safe: it can only render already-captured artifacts,
    // so it is structurally incapable of passing today's database rows off as historical evidence.
    const code = stripComments(readRepoFile(RESOLVE_ONLY_FILES[0]!));
    expect(code).not.toMatch(/from\s+['"][^'"]*spatial-provider-postgis/);
    expect(code).not.toContain('$queryRaw');
    expect(code).not.toMatch(/\bST_(?:DWithin|Intersects|Transform|AsGeoJSON)\b/);
  });

  it('projects through ViewerKernel, which is bound to the canonical presentation contract', () => {
    const kernel = stripComments(readRepoFile('packages/mps-lu/src/viewer/ViewerKernel.ts'));
    expect(kernel).toContain('CanonicalSpatialPresentationCollection');
    expect(kernel).toContain('CANONICAL_SPATIAL_PRESENTATION_CONTRACT_VERSION');
    // presentation_mode must be DERIVED from the geometry, never asserted as a constant — the old
    // literal mislabelled every feature as non-geometric regardless of what it carried.
    expect(kernel).toContain('presentationModeForGeometry(transportGeometry)');
    expect(kernel).not.toMatch(/presentation_mode:\s*['"]/);
  });
});
