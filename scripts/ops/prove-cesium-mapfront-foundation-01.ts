/**
 * CESIUM-TV4 foundation proofs (deterministic, no national governed-data claims):
 * - OFFLINE-ASSETS / local workers+widgets presence
 * - VIEWPORT presentation service (fixture path)
 * - IMAGERY / TERRAIN / 3DTILES fixture presence
 * - HEIGHT contract undecided seam
 * - Layer registry seams
 *
 * Usage: npx tsx scripts/ops/prove-cesium-mapfront-foundation-01.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAP_PRESENTATION_MAX_FEATURES,
  parseViewportBbox,
  buildPropertyViewportPresentation,
} from '../../server/modules/map-presentation/mapPresentationService';
import { ACTIVE_CESIUM_HEIGHT_REFERENCE } from '../../components/cesium/heightReferenceContract';
import { MAPFRONT_LAYER_REGISTRY } from '../../components/cesium/layerRegistry';
import { deriveFeatureCollectionState } from '../../components/cesium/loadingState';

const root = process.cwd();
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}

console.log('=== CESIUM-OFFLINE-ASSETS ===');
for (const rel of [
  'public/cesium/Workers',
  'public/cesium/Widgets',
  'public/cesium/Assets',
  'public/cesium/fixtures/l0-l1-scene.wgs84.json',
  'public/cesium/fixtures/imagery/orthophoto/0/0/0.png',
  'public/cesium/fixtures/imagery/topographic/0/0/0.png',
  'public/cesium/fixtures/tilesets/buildings/tileset.json',
  'public/cesium-proof/index.html',
]) {
  const ok = existsSync(join(root, rel));
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${rel}`);
  assert(ok, `missing ${rel}`);
}

console.log('\n=== CESIUM-HEIGHT-CONTRACT ===');
console.log(`  mode=${ACTIVE_CESIUM_HEIGHT_REFERENCE.mode}`);
assert(
  ACTIVE_CESIUM_HEIGHT_REFERENCE.owner_decision === 'UNDECIDED',
  'height owner_decision must remain UNDECIDED',
);
assert(
  ACTIVE_CESIUM_HEIGHT_REFERENCE.mode === 'ELLIPSOID_WGS84_PRESENTATION_ONLY',
  'active height mode must be ellipsoid presentation-only',
);

async function main(): Promise<void> {
  console.log('\n=== CESIUM-VIEWPORT ===');
  assert(parseViewportBbox('1,2,3') === null, 'invalid bbox must reject');
  assert(parseViewportBbox('14.4,61.0,14.5,61.1') !== null, 'valid bbox must parse');
  assert(parseViewportBbox('10,50,20,60') === null, 'oversized bbox must reject');
  const fixtureViewport = await buildPropertyViewportPresentation({
    bbox: { minLng: 14.4, minLat: 61.0, maxLng: 14.5, maxLat: 61.1 },
    bboxRaw: '14.4,61.0,14.5,61.1',
    limit: MAP_PRESENTATION_MAX_FEATURES,
    source: 'fixture',
  });
  assert(fixtureViewport.features.length === 1, 'fixture viewport must return property feature');
  assert(fixtureViewport.meta.source === 'fixture', 'fixture must be explicit');
  assert(fixtureViewport.meta.fixture === true, 'fixture meta flag required');
  console.log(`  fixture features=${fixtureViewport.features.length}`);

  console.log('\n=== CESIUM-LAYER-REGISTRY / LOADING STATE ===');
  for (const id of ['property', 'buildings', 'terrain', 'orthophoto', 'land_cover', 'hydrography']) {
    assert(MAPFRONT_LAYER_REGISTRY.some((l) => l.layer_id === id), `missing layer ${id}`);
  }
  assert(deriveFeatureCollectionState({ loading: false, featureCount: 0 }) === 'EMPTY', 'EMPTY semantics');
  assert(
    deriveFeatureCollectionState({ loading: false, featureCount: 0 }) !==
      deriveFeatureCollectionState({ loading: false, unavailable: true, featureCount: null }),
    'EMPTY ≠ UNAVAILABLE',
  );
  console.log(`  layers=${MAPFRONT_LAYER_REGISTRY.length}`);

  console.log('\n=== CESIUM-3DTILES FIXTURE ===');
  const tileset = JSON.parse(
    readFileSync(join(root, 'public/cesium/fixtures/tilesets/buildings/tileset.json'), 'utf8'),
  );
  assert(tileset?.asset?.version === '1.0', 'tileset asset.version');
  assert(tileset?.root?.boundingVolume?.region, 'tileset root region');

  if (failures.length) {
    console.error('\nPROOF FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nALL FOUNDATION PROOFS PASS');
}

void main();
