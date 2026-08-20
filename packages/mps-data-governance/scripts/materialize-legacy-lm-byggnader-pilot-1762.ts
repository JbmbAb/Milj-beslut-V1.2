import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';
import { FileCASRepository, LocalPemVerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import { resolveLegacyMasterAdmission } from '../src/LegacyMasterAdmission';
import {
  assertLmByggnaderGpkgInspection,
  assertLmByggnaderPilotAdmission,
  createBuildingFeatureIdentityV1,
  geometryContentHash,
} from '../src/LegacyMasterByggnaderMaterialization';

/**
 * TOPO10-BUILDING-MATERIALIZATION-PILOT-1762
 *
 * A one-municipality materializer, intentionally fixed to the already owner-admitted 1762
 * object. It has no network client, accepts no URL, and does not know how to produce a manifest
 * or a quarantine record. A separate future unit must be opened before any other municipality
 * can use this code path.
 */

const ADMISSION_REFERENCE = {
  artifact_id: 'legacy-master-admission-e586931d66c4b36298d07d7e9e69d5894372b057e845796d4ad6664119c13baa',
  artifact_content_ref: 'sha256:0040daada4e89b6b8a4f6c308058950f3136975cc1f87ca7c1ecbb7b94ffaa33',
  current_byte_observation_ref: 'sha256:31a0f22c0f935598f2aaba6ac0948c0f231b2881511e5fd987d168930cf7e4b1',
} as const;

const OGRINFO = 'C:\\Program Files\\QGIS 4.0.2\\bin\\ogrinfo.exe';
const OGR2OGR = 'C:\\Program Files\\QGIS 4.0.2\\bin\\ogr2ogr.exe';
const TARGET_TABLE = 'topo10.byggnad';

function fail(message: string): never {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function pgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return [
    `host='${quote(url.hostname)}'`,
    `port='${quote(url.port || '5432')}'`,
    `dbname='${quote(decodeURIComponent(url.pathname.slice(1)))}'`,
    `user='${quote(decodeURIComponent(url.username))}'`,
    `password='${quote(decodeURIComponent(url.password))}'`,
  ].join(' ');
}

function ogrZipPath(zipPath: string): string {
  return `/vsizip/${zipPath.replace(/\\/g, '/')}/byggnad_kn1762.gpkg`;
}

function inspectGpkg(zipPath: string): void {
  const output = execFileSync(OGRINFO, ['-ro', '-so', ogrZipPath(zipPath), 'byggnad'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assertLmByggnaderGpkgInspection(output);
}

function importGpkg(zipPath: string, databaseUrl: string): void {
  execFileSync(
    OGR2OGR,
    [
      '-f',
      'PostgreSQL',
      `PG:${pgConnectionString(databaseUrl)}`,
      ogrZipPath(zipPath),
      'byggnad',
      '-nln',
      TARGET_TABLE,
      '-overwrite',
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-lco',
      'GEOMETRY_NAME=geom',
      '-lco',
      'FID=fid',
      '-lco',
      'SPATIAL_INDEX=NONE',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function ensurePilotProvenance(
  client: pg.Client,
  provenance: ReturnType<typeof assertLmByggnaderPilotAdmission>,
): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS topo10');
  await client.query(`ALTER TABLE ${TARGET_TABLE}
    ADD COLUMN IF NOT EXISTS governance_admission_artifact_id text,
    ADD COLUMN IF NOT EXISTS source_registry_artifact_id text,
    ADD COLUMN IF NOT EXISTS admitted_byte_sha256 text,
    ADD COLUMN IF NOT EXISTS admission_mode text,
    ADD COLUMN IF NOT EXISTS historical_acquisition_status text,
    ADD COLUMN IF NOT EXISTS source_object_id text,
    ADD COLUMN IF NOT EXISTS source_part_key text,
    ADD COLUMN IF NOT EXISTS identity_scope text,
    ADD COLUMN IF NOT EXISTS identity_version text,
    ADD COLUMN IF NOT EXISTS feature_ref text,
    ADD COLUMN IF NOT EXISTS geometry_content_hash text`);
  await client.query(
    `UPDATE ${TARGET_TABLE}
     SET governance_admission_artifact_id = $1,
         source_registry_artifact_id = $2,
         admitted_byte_sha256 = $3,
         admission_mode = $4,
         historical_acquisition_status = $5`,
    [
      provenance.governance_admission_artifact_id,
      provenance.source_registry_artifact_id,
      provenance.admitted_byte_sha256,
      provenance.admission_mode,
      provenance.historical_acquisition_status,
    ],
  );
  const identities = await client.query<{
    fid: number;
    objektidentitet: string | null;
    normalized_geometry: Buffer;
  }>(
    `SELECT fid, objektidentitet, ST_AsEWKB(ST_Normalize(geom)) AS normalized_geometry FROM ${TARGET_TABLE}`,
  );
  if (identities.rows.length !== 5313) {
    fail(`REJECT_FEATURE_IDENTITY: expected 5313 imported rows, got ${identities.rows.length}.`);
  }
  await client.query('BEGIN');
  try {
    for (const row of identities.rows) {
      if (row.fid === null || row.fid === undefined || !row.objektidentitet) {
        fail('REJECT_FEATURE_IDENTITY: source fid and objektidentitet are both required.');
      }
      const identity = createBuildingFeatureIdentityV1({
        source_object_id: row.objektidentitet,
        source_part_key: row.fid,
        admitted_byte_sha256: provenance.admitted_byte_sha256,
      });
      await client.query(
        `UPDATE ${TARGET_TABLE}
         SET source_object_id = $1,
             source_part_key = $2,
             identity_scope = $3,
             identity_version = $4,
             feature_ref = $5,
             geometry_content_hash = $6
         WHERE fid = $7`,
        [
          identity.source_object_id,
          identity.source_part_key,
          identity.identity_scope,
          identity.identity_version,
          identity.feature_ref,
          geometryContentHash(row.normalized_geometry),
          row.fid,
        ],
      );
    }
    await client.query(`ALTER TABLE ${TARGET_TABLE}
    ALTER COLUMN governance_admission_artifact_id SET NOT NULL,
    ALTER COLUMN source_registry_artifact_id SET NOT NULL,
    ALTER COLUMN admitted_byte_sha256 SET NOT NULL,
    ALTER COLUMN admission_mode SET NOT NULL,
    ALTER COLUMN historical_acquisition_status SET NOT NULL,
    ALTER COLUMN source_object_id SET NOT NULL,
    ALTER COLUMN source_part_key SET NOT NULL,
    ALTER COLUMN identity_scope SET NOT NULL,
    ALTER COLUMN identity_version SET NOT NULL,
    ALTER COLUMN feature_ref SET NOT NULL,
    ALTER COLUMN geometry_content_hash SET NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS topo10_byggnad_feature_ref_unique
      ON ${TARGET_TABLE} (feature_ref)`);
    await client.query(`CREATE INDEX IF NOT EXISTS topo10_byggnad_objektidentitet_index
      ON ${TARGET_TABLE} (objektidentitet)`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  await client.query(`CREATE INDEX IF NOT EXISTS topo10_byggnad_geom_gist
    ON ${TARGET_TABLE} USING GIST (geom)`);
}

async function assertMaterialization(
  client: pg.Client,
): Promise<{ readonly count: number; readonly identityFingerprint: string }> {
  const result = await client.query<{
    count: number;
    distinct_feature_ref_count: number;
    distinct_fid_count: number;
    duplicate_geometry_content_hash_count: number;
    invalid_count: number;
    srid_mismatch_count: number;
    identity_fingerprint: string;
  }>(`SELECT
      count(*)::int AS count,
      count(DISTINCT feature_ref)::int AS distinct_feature_ref_count,
      count(DISTINCT fid)::int AS distinct_fid_count,
      (count(*) - count(DISTINCT geometry_content_hash))::int AS duplicate_geometry_content_hash_count,
      count(*) FILTER (WHERE objektidentitet IS NULL OR btrim(objektidentitet) = '' OR fid IS NULL)::int AS invalid_count,
      count(*) FILTER (WHERE ST_SRID(geom) <> 3006 OR NOT ST_IsValid(geom))::int AS srid_mismatch_count,
      md5(coalesce(string_agg(feature_ref || ':' || geometry_content_hash, ',' ORDER BY feature_ref), '')) AS identity_fingerprint
    FROM ${TARGET_TABLE}`);
  const row = result.rows[0];
  if (
    row.count !== 5313 ||
    row.distinct_feature_ref_count !== 5313 ||
    row.distinct_fid_count !== 5313 ||
    row.duplicate_geometry_content_hash_count !== 0 ||
    row.invalid_count !== 0 ||
    row.srid_mismatch_count !== 0 ||
    !row.identity_fingerprint
  ) {
    fail(
      `Materialization contract failed: count=${row.count}, feature_refs=${row.distinct_feature_ref_count}, ` +
        `fids=${row.distinct_fid_count}, duplicate_geometry_hashes=${row.duplicate_geometry_content_hash_count}, ` +
        `invalid=${row.invalid_count}, srid_or_geometry_mismatch=${row.srid_mismatch_count}.`,
    );
  }
  return { count: row.count, identityFingerprint: row.identity_fingerprint };
}

async function main(): Promise<void> {
  if (!process.argv.includes('--execute')) {
    fail('This owner-approved write requires --execute.');
  }
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env', override: false });
  const databaseUrl = requireEnv('DATABASE_URL');
  const mimersRoot = requireEnv('MIMERS_ROOT');
  const keyId = requireEnv('SOURCE_REGISTRY_SIGNING_KEY_ID');
  const publicKey = requireEnv('SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM');
  if (process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM) {
    fail('SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM must be absent: materialization verifies only.');
  }

  const verification = new LocalPemVerificationKeyProvider(keyId, publicKey);
  const cas = new FileCASRepository(join(mimersRoot, 'cas'), { durabilityMode: 'best-effort' });
  await cas.initialize();
  const resolved = await resolveLegacyMasterAdmission({
    reference: ADMISSION_REFERENCE,
    verification,
    cas,
  });
  const provenance = assertLmByggnaderPilotAdmission(resolved.artifact);

  const client = new pg.Client({ connectionString: databaseUrl });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mimer-lm-1762-'));
  const zipPath = join(temporaryDirectory, '1762.zip');
  try {
    await client.connect();
    const existing = await client.query<{ exists: boolean }>(`SELECT
      exists(SELECT 1 FROM information_schema.tables WHERE table_schema = 'topo10' AND table_name = 'byggnad') AS exists`);
    if (existing.rows[0].exists && !process.argv.includes('--replace-partial-1762')) {
      fail(
        'topo10.byggnad already exists; --replace-partial-1762 is required and only accepts this exact partial pilot.',
      );
    }
    if (existing.rows[0].exists) {
      const partial = await client.query<{ count: number; matching_provenance_rows: number }>(
        `SELECT count(*)::int AS count,
          count(*) FILTER (WHERE governance_admission_artifact_id = $1
            AND source_registry_artifact_id = $2
            AND admitted_byte_sha256 = $3
            AND admission_mode = $4
            AND historical_acquisition_status = $5)::int AS matching_provenance_rows
         FROM ${TARGET_TABLE}`,
        [
          provenance.governance_admission_artifact_id,
          provenance.source_registry_artifact_id,
          provenance.admitted_byte_sha256,
          provenance.admission_mode,
          provenance.historical_acquisition_status,
        ],
      );
      if (partial.rows[0].count !== 5313 || partial.rows[0].matching_provenance_rows !== 5313) {
        fail('topo10.byggnad is not the exact known 1762 partial pilot; refusing replacement.');
      }
    }

    await writeFile(zipPath, resolved.bytes, { flag: 'wx' });
    inspectGpkg(zipPath);
    await client.query('CREATE SCHEMA IF NOT EXISTS topo10');
    importGpkg(zipPath, databaseUrl);
    await ensurePilotProvenance(client, provenance);
    const first = await assertMaterialization(client);

    // A full replace from the same admitted bytes is the replay proof: no logical identity may drift.
    importGpkg(zipPath, databaseUrl);
    await ensurePilotProvenance(client, provenance);
    const replay = await assertMaterialization(client);
    if (replay.identityFingerprint !== first.identityFingerprint || replay.count !== first.count) {
      fail('REJECT_REIMPORT_IDENTITY: reimport changed the logical building identity set.');
    }

    console.log('MATERIALIZATION=PASS');
    console.log(`ROWS=${replay.count}`);
    console.log(`IDENTITY_FINGERPRINT=${replay.identityFingerprint}`);
    console.log(`ADMISSION_ARTIFACT=${provenance.governance_admission_artifact_id}`);
    console.log(`SOURCE_REGISTRY_ARTIFACT=${provenance.source_registry_artifact_id}`);
    console.log(`ADMITTED_BYTE_SHA256=${provenance.admitted_byte_sha256}`);
    console.log(`HISTORICAL_ACQUISITION_STATUS=${provenance.historical_acquisition_status}`);
  } finally {
    await client.end().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
