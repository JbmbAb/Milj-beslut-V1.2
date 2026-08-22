/**
 * PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01 -- real, live proof run against the real dev DB/CAS
 * and the real ORSA STACKMORA 3:12 project (`cmt2m7bdj0000h0f7uj4jykis`), the same project this
 * session's prior live proofs used as evidence -- left in place afterward as evidence for this
 * unit too.
 *
 * Proves the user-facing save/read path end to end through the REAL saveUserLocalizationGeometry
 * / getCurrentLocalizationGeometryForProject functions (no fakes, no in-memory repository): real
 * Postgres project membership check, real ProjectContextBinding chain, real PostGIS
 * ST_Transform for the WGS84 <-> SWEREF99 TM round trip.
 *
 * Usage: MIMERS_ROOT="C:\Users\jimmy\.mimers" npx tsx scripts/ops/prove-lu-cesium-localization-drawing-01.ts --execute
 */
import '../../server/loadEnvFirst';
import { prisma } from '../../server/db/prisma';
import {
  saveUserLocalizationGeometry,
  getCurrentLocalizationGeometryForProject,
} from '../../server/modules/localization/localizationGeometryService';
import type { AuthUser } from '../../server/security/types';

const PROJECT_ID = 'cmt2m7bdj0000h0f7uj4jykis';
const OWNER_USER_ID = 'cmsjwmjel0001n4f7l8yuybwm'; // admin:admin, real OWNER of the golden-path project
const OWNER_ORG_ID = 'cmsjwmjds0000n4f7il7hf00a';

const POINT_A = { lng: 14.5, lat: 61.15 };
const POINT_B = { lng: 14.55, lat: 61.2 };

async function ownerUser(): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: OWNER_USER_ID } });
  if (!user) throw new Error(`Owner user ${OWNER_USER_ID} not found`);
  return { id: user.id, organisationId: OWNER_ORG_ID, bankidId: user.bankidId ?? 'live-proof', role: 'CONSULTANT' };
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('refusing to write without --execute');
  if (!process.env.MIMERS_ROOT?.trim()) throw new Error('MIMERS_ROOT is required.');

  const owner = await ownerUser();

  console.log('=== PROOF: unauthorized user -> DENY ===');
  const stranger: AuthUser = { id: 'not-a-member-of-orsa-live-proof', organisationId: 'some-other-org', bankidId: 'stranger', role: 'CONSULTANT' };
  const denyResult = await saveUserLocalizationGeometry({
    authUser: stranger,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [POINT_A.lng, POINT_A.lat], srid: 4326 },
  });
  console.log(`  result: ok=${denyResult.ok} ${!denyResult.ok ? `status=${denyResult.status} error=${denyResult.error}` : ''}`);
  if (denyResult.ok) throw new Error('PROOF FAILED: unauthorized user was allowed to save a localization point');
  if (denyResult.status !== 403) throw new Error(`PROOF FAILED: expected 403, got ${denyResult.status}`);
  console.log('  PROOF PASS: unauthorized user denied.');

  console.log('\n=== PROOF: unsupported geometry type -> DENY for V1 ===');
  const polygonResult = await saveUserLocalizationGeometry({
    authUser: owner,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POLYGON', coordinates: [[[14, 61], [14.1, 61], [14, 61.1]]], srid: 4326 },
  });
  console.log(`  result: ok=${polygonResult.ok} ${!polygonResult.ok ? `status=${polygonResult.status} error=${polygonResult.error}` : ''}`);
  if (polygonResult.ok) throw new Error('PROOF FAILED: POLYGON was accepted in V1');
  console.log('  PROOF PASS: unsupported geometry type denied.');

  console.log('\n=== PROOF: invalid coordinate -> DENY ===');
  const badCoordResult = await saveUserLocalizationGeometry({
    authUser: owner,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [999, 61.15], srid: 4326 },
  });
  console.log(`  result: ok=${badCoordResult.ok} ${!badCoordResult.ok ? `status=${badCoordResult.status} error=${badCoordResult.error}` : ''}`);
  if (badCoordResult.ok) throw new Error('PROOF FAILED: an out-of-range longitude was accepted');
  console.log('  PROOF PASS: invalid coordinate denied.');

  console.log('\n=== POINT A: real save via the real Cesium-click boundary ===');
  const savedA = await saveUserLocalizationGeometry({
    authUser: owner,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [POINT_A.lng, POINT_A.lat], srid: 4326 },
  });
  if (!savedA.ok) throw new Error(`PROOF FAILED: point A save failed: ${savedA.error}`);
  console.log(`  saved: ${savedA.data.artifact_id} provenance=${savedA.data.provenance} wgs84=${JSON.stringify(savedA.data.wgs84LngLat)}`);
  if (savedA.data.provenance !== 'user_defined') throw new Error('PROOF FAILED: saved point is not provenance=user_defined');
  if (savedA.data.wgs84LngLat[0] !== POINT_A.lng || savedA.data.wgs84LngLat[1] !== POINT_A.lat) {
    throw new Error('PROOF FAILED: read-back WGS84 does not match the exact clicked coordinates');
  }
  console.log('  PROOF PASS: point A persisted with exact WGS84 read-back.');

  console.log('\n=== PROOF: real PostGIS coordinate round trip (Cesium click WGS84 -> SWEREF99 -> read back -> same location) ===');
  const casRow = await (await import('@miljobeslut/mps-runtime')).MimersIntegration.create();
  const geometryArtifact = await casRow.artifactRepository.resolve<{ payload: { coordinates: readonly [number, number]; srid: number; geometry: { coordinates: readonly [number, number] } } }>({
    artifact_id: savedA.data.artifact_id,
    artifact_type: 'localization_geometry',
  });
  console.log(`  persisted SWEREF99 TM [northing, easting] = ${JSON.stringify(geometryArtifact.payload.coordinates)}, srid=${geometryArtifact.payload.srid}`);
  if (geometryArtifact.payload.srid !== 3006) throw new Error('PROOF FAILED: persisted SRID is not 3006');
  const { createLocalizationSpatialRuntime } = await import('../../server/modules/localization/createLocalizationSpatialRuntime');
  const spatialRuntime = await createLocalizationSpatialRuntime();
  const [readBackLat, readBackLng] = await spatialRuntime.sweref99ToWgs84(
    geometryArtifact.payload.coordinates[0],
    geometryArtifact.payload.coordinates[1],
  );
  await spatialRuntime.close();
  console.log(`  round-tripped back to WGS84: lat=${readBackLat} lng=${readBackLng} (original: lat=${POINT_A.lat} lng=${POINT_A.lng})`);
  const latDelta = Math.abs(readBackLat - POINT_A.lat);
  const lngDelta = Math.abs(readBackLng - POINT_A.lng);
  if (latDelta > 0.0001 || lngDelta > 0.0001) {
    throw new Error(`PROOF FAILED: round-tripped coordinate diverges from the original click (latDelta=${latDelta} lngDelta=${lngDelta})`);
  }
  console.log('  PROOF PASS: real PostGIS ST_Transform round trip returns the same real-world location.');

  console.log('\n=== MOVE TO POINT B: real save ===');
  const savedB = await saveUserLocalizationGeometry({
    authUser: owner,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [POINT_B.lng, POINT_B.lat], srid: 4326 },
  });
  if (!savedB.ok) throw new Error(`PROOF FAILED: point B save failed: ${savedB.error}`);
  console.log(`  saved: ${savedB.data.artifact_id}`);
  if (savedB.data.artifact_id === savedA.data.artifact_id) throw new Error('PROOF FAILED: point B has the same artifact_id as point A');
  console.log('  PROOF PASS: distinct artifact for point B.');

  console.log('\n=== REFRESH: real GET must resolve to B, not A ===');
  const reloaded = await getCurrentLocalizationGeometryForProject({ authUser: owner, projectId: PROJECT_ID });
  if (!reloaded.ok) throw new Error(`PROOF FAILED: GET after move failed: ${reloaded.error}`);
  console.log(`  current: ${reloaded.data.artifact_id} provenance=${reloaded.data.provenance}`);
  if (reloaded.data.artifact_id !== savedB.data.artifact_id) throw new Error('PROOF FAILED: current geometry after refresh is not B');
  if (reloaded.data.artifact_id === savedA.data.artifact_id) throw new Error('PROOF FAILED: current geometry after refresh is A');
  console.log('  PROOF PASS: refresh reloads B from persistent server state.');

  console.log('\n=== SAME EXACT POINT SAVED AGAIN -> idempotent identity ===');
  const savedBAgain = await saveUserLocalizationGeometry({
    authUser: owner,
    projectId: PROJECT_ID,
    input: { geometry_type: 'POINT', coordinates: [POINT_B.lng, POINT_B.lat], srid: 4326 },
  });
  if (!savedBAgain.ok) throw new Error(`PROOF FAILED: re-save of B failed: ${savedBAgain.error}`);
  if (savedBAgain.data.artifact_id !== savedB.data.artifact_id) throw new Error('PROOF FAILED: re-saving the exact same point produced a different artifact_id');
  console.log('  PROOF PASS: re-saving the identical point is idempotent.');

  console.log('\nALL PRODUCT-LU-CESIUM-LOCALIZATION-DRAWING-01 LIVE PROOFS PASS');
  console.log(JSON.stringify({ project_id: PROJECT_ID, point_a: savedA.data, point_b: savedB.data, current: reloaded.data }, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
  });
