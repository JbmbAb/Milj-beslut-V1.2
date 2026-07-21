import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { performance } from 'perf_hooks';

// Load test environment
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { prisma } from '../src/db.server';
import { PostgisGeoAdapter } from '../src/infrastructure/postgis-geo-adapter';

const testAreas = [
  { name: 'Gävle Brynäs', bbox: { minLng: 17.13, minLat: 60.66, maxLng: 17.15, maxLat: 60.68 } },
  { name: 'Stockholm Gamla Stan', bbox: { minLng: 18.06, minLat: 59.31, maxLng: 18.08, maxLat: 59.33 } },
  { name: 'Göteborg Centrum', bbox: { minLng: 11.95, minLat: 57.69, maxLng: 11.97, maxLat: 57.71 } },
  { name: 'Malmö Västra Hamnen', bbox: { minLng: 12.96, minLat: 55.60, maxLng: 12.98, maxLat: 55.62 } },
  { name: 'Uppsala', bbox: { minLng: 17.62, minLat: 59.84, maxLng: 17.64, maxLat: 59.86 } },
  { name: 'Kiruna', bbox: { minLng: 20.21, minLat: 67.84, maxLng: 20.23, maxLat: 67.86 } },
  { name: 'Visby', bbox: { minLng: 18.28, minLat: 57.62, maxLng: 18.30, maxLat: 57.64 } },
  { name: 'Umeå', bbox: { minLng: 20.24, minLat: 63.81, maxLng: 20.26, maxLat: 63.83 } },
  { name: 'Örebro', bbox: { minLng: 15.19, minLat: 59.26, maxLng: 15.21, maxLat: 59.28 } },
  { name: 'Jönköping', bbox: { minLng: 14.15, minLat: 57.77, maxLng: 14.17, maxLat: 57.79 } },
];

async function seedData() {
  console.log('🧹 Clearing legacy env.sgu_well data...');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE env.sgu_well CASCADE;');

  console.log('🌱 Seeding 15 random wells for each of the 10 Swedish test areas...');
  for (const area of testAreas) {
    const { bbox } = area;
    const centerLng = (bbox.minLng + bbox.maxLng) / 2;
    const centerLat = (bbox.minLat + bbox.maxLat) / 2;

    for (let i = 0; i < 15; i++) {
      // Small offset around center within bbox
      const lng = centerLng + (Math.random() - 0.5) * (bbox.maxLng - bbox.minLng) * 0.8;
      const lat = centerLat + (Math.random() - 0.5) * (bbox.maxLat - bbox.minLat) * 0.8;

      await prisma.$executeRaw`
        INSERT INTO env.sgu_well (geom)
        VALUES (ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006))
      `;
    }
  }
  console.log('✅ Seeding complete.');
}

async function runLegacyQuery(bbox: typeof testAreas[0]['bbox'], limit: number = 1500) {
  const schemaSql = '"env"';
  const tableSql = '"sgu_well"';
  const maxRows = Math.max(1, Math.min(limit, 3000));

  return await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT
        ST_GeometryType(t.geom)::text AS geometry_type,
        (to_jsonb(t) - 'geom') AS raw_properties,
        ST_AsGeoJSON(
          ST_Transform(
            CASE
              WHEN ST_Dimension(t.geom) > 0 THEN ST_SimplifyPreserveTopology(t.geom, 25)
              ELSE t.geom
            END,
            4326
          )
        ) AS geojson
      FROM ${schemaSql}.${tableSql} t
      WHERE t.geom IS NOT NULL
        AND t.geom && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
        AND ST_Intersects(t.geom, ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006))
      LIMIT $5
    `,
    bbox.minLng,
    bbox.minLat,
    bbox.maxLng,
    bbox.maxLat,
    maxRows,
  );
}

async function runBenchmark() {
  await seedData();

  const adapter = new PostgisGeoAdapter();
  const results: any[] = [];
  const RUNS_PER_AREA = 5;

  console.log(`⏱️ Starting benchmark (running each test ${RUNS_PER_AREA} times for warm-up & averaging)...`);

  for (const area of testAreas) {
    const legacyTimings: number[] = [];
    const migratedTimings: number[] = [];
    let featuresCount = 0;

    // Warm-up database cache
    await runLegacyQuery(area.bbox);
    await adapter.getDatasetMapLayer('sgu_wells', area.bbox);

    // Legacy Runs
    for (let r = 0; r < RUNS_PER_AREA; r++) {
      const start = performance.now();
      const rows = await runLegacyQuery(area.bbox);
      const end = performance.now();
      legacyTimings.push(end - start);
      featuresCount = rows.length;
    }

    // Migrated Runs
    for (let r = 0; r < RUNS_PER_AREA; r++) {
      const start = performance.now();
      const fc = await adapter.getDatasetMapLayer('sgu_wells', area.bbox);
      const end = performance.now();
      migratedTimings.push(end - start);
    }

    const legacyAvg = legacyTimings.reduce((a, b) => a + b, 0) / RUNS_PER_AREA;
    const migratedAvg = migratedTimings.reduce((a, b) => a + b, 0) / RUNS_PER_AREA;
    const deviation = ((migratedAvg - legacyAvg) / legacyAvg) * 100;

    console.log(`📍 Area: ${area.name.padEnd(23)} | Legacy Avg: ${legacyAvg.toFixed(3)}ms | Migrated Avg: ${migratedAvg.toFixed(3)}ms | Dev: ${deviation > 0 ? '+' : ''}${deviation.toFixed(2)}% | Features: ${featuresCount}`);

    results.push({
      name: area.name,
      legacyMs: legacyTimings.map(t => Number(t.toFixed(3))),
      legacyAvgMs: Number(legacyAvg.toFixed(3)),
      migratedMs: migratedTimings.map(t => Number(t.toFixed(3))),
      migratedAvgMs: Number(migratedAvg.toFixed(3)),
      deviationPercent: Number(deviation.toFixed(2)),
      featuresCount,
    });
  }

  const overallLegacyAvg = results.reduce((sum, r) => sum + r.legacyAvgMs, 0) / results.length;
  const overallMigratedAvg = results.reduce((sum, r) => sum + r.migratedAvgMs, 0) / results.length;
  const overallDeviation = ((overallMigratedAvg - overallLegacyAvg) / overallLegacyAvg) * 100;

  console.log('\n========================================================================');
  console.log('📊 BENCHMARK OVERALL SUMMARY:');
  console.log(`Legacy Average  : ${overallLegacyAvg.toFixed(3)}ms`);
  console.log(`Migrated Average: ${overallMigratedAvg.toFixed(3)}ms`);
  console.log(`Total Deviation : ${overallDeviation > 0 ? '+' : ''}${overallDeviation.toFixed(2)}%`);
  console.log('========================================================================\n');

  const passed = overallDeviation <= 5;
  const status = passed ? 'PASSED' : 'FAILED';

  const benchmarkLog = {
    timestamp: new Date().toISOString(),
    summary: {
      totalAreasTested: testAreas.length,
      legacyAverageMs: Number(overallLegacyAvg.toFixed(3)),
      migratedAverageMs: Number(overallMigratedAvg.toFixed(3)),
      deviationPercent: Number(overallDeviation.toFixed(2)),
      status,
    },
    results,
  };

  // Ensure logs directory exists
  fs.mkdirSync(path.resolve(process.cwd(), 'logs'), { recursive: true });
  fs.writeFileSync(
    path.resolve(process.cwd(), 'logs/gis-performance-benchmark.json'),
    JSON.stringify(benchmarkLog, null, 2),
    'utf-8',
  );
  console.log(`💾 Results saved to logs/gis-performance-benchmark.json`);

  if (!passed) {
    console.error(`❌ Benchmark FAILED: Performance deviation (+${overallDeviation.toFixed(2)}%) exceeds the maximum allowed limit of +5%.`);
    process.exit(1);
  } else {
    console.log(`✅ Benchmark PASSED: Deviation is within the ±5% SLA.`);
    process.exit(0);
  }
}

runBenchmark().catch(err => {
  console.error('❌ Error executing GIS performance benchmark:', err);
  process.exit(1);
});
