import { loadEnvFile } from '../../server/loadEnv';
loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

async function main() {
  const { prisma: p } = await import('../../server/db/prisma');
  // Kolla om raster_registration_log finns och vad den innehåller
  try {
    const rows = await p.$queryRawUnsafe<any[]>(
      `SELECT
         provider,
         dataset,
         COUNT(*)::int                                           AS filer,
         COUNT(sha256)::int                                      AS med_sha256,
         (COUNT(*) FILTER (WHERE sha256 IS NULL))::int           AS saknar_sha256,
         ROUND(SUM(size_bytes) / 1073741824.0, 2)               AS gb,
         MAX(registered_at)::text                               AS senast
       FROM public.raster_registration_log
       GROUP BY provider, dataset
       ORDER BY provider, dataset`,
    );

    if (rows.length === 0) {
      console.log('STATUS: raster_registration_log är tom — inga raster registrerade ännu.');
    } else {
      console.log('\n=== Raster Out-of-DB Registration Status ===\n');
      console.log(
        'Provider'.padEnd(20) +
          'Dataset'.padEnd(40) +
          'Filer'.padEnd(8) +
          'SHA256 OK'.padEnd(12) +
          'Saknas'.padEnd(10) +
          'GB'.padEnd(10) +
          'Senast',
      );
      console.log('─'.repeat(104));
      let totalMissing = 0;
      for (const r of rows) {
        totalMissing += r.saknar_sha256;
        const ok = r.saknar_sha256 === 0 ? '✅' : '❌';
        console.log(
          String(r.provider).padEnd(20) +
            String(r.dataset).slice(0, 38).padEnd(40) +
            String(r.filer).padEnd(8) +
            `${ok} ${r.med_sha256}`.padEnd(12) +
            String(r.saknar_sha256).padEnd(10) +
            String(r.gb ?? '?').padEnd(10) +
            (r.senast ?? '').slice(0, 10),
        );
      }
      console.log('─'.repeat(104));
      console.log(
        `\nDefinition of Done: checksum_missing = ${totalMissing === 0 ? '✅ 0' : `❌ ${totalMissing} (ej klar!)`}`,
      );
    }
  } catch (e: any) {
    if (e.message?.includes('does not exist')) {
      console.log('STATUS: Tabellen raster_registration_log finns INTE i databasen.');
      console.log('→ Kör migrationen först:');
      console.log('  psql $DATABASE_URL -f prisma/migrations/20260628_raster_outdb_infrastructure.sql');
    } else {
      console.log('DB-fel:', e.message?.slice(0, 200));
    }
  } finally {
    await p.$disconnect();
  }
}

main();
