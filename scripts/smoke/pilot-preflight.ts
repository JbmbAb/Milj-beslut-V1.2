import { buildMigrationReadinessReport } from '../../server/services/migrationReadinessService';

/**
 * pilot-preflight.ts
 *
 * Minimal “vertikal kedja” preflight inför pilotmigrering:
 * - readiness gate måste vara OK
 * - (utan att kräva live integrationer)
 */

function main() {
  const report = buildMigrationReadinessReport();
  if (!report.ok) {
     
    console.error('PRECHECK FAILED: migration readiness is false');
     
    console.error(JSON.stringify(report.summary, null, 2));
     
    console.error(
      report.items
        .filter((i) => i.status !== 'DONE')
        .map((i) => `${i.id}: ${i.status}`)
        .join('\n') || '(no failing items?)',
    );
    process.exit(2);
  }
   
  console.log('PRECHECK OK');
   
  console.log(JSON.stringify({ checkedAt: report.checkedAt, summary: report.summary }, null, 2));
}

main();
