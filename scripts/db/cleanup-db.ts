// U30F7 (ägarbeslut 2026-10-03): PENSIONERAD -- RETIRED.
// Skriptet släppte 9 index och, med DROP TABLE ... CASCADE, 8 tabeller som Prisma äger, ogrindat och utan torrkörning.
// Det är avvecklat som en fail-closed ingång: det vägrar innan det ansluter till något och avslutar med fel (exit != 0).
// The script dropped 9 indexes and, with DROP TABLE ... CASCADE, 8 tables Prisma owns, ungated and with no dry run.
// It is retired as a fail-closed entry point: it refuses before it connects to anything and exits non-zero.
// Skäl och ersättning / reason and replacement: RETIRED_DESTRUCTIVE_SCRIPTS (packages/spatial-provider-postgis/src/ProtectedRelationGate.ts).
// Den tidigare koden finns i git-historiken / the former code is in the git history. Ingen override / no override.
import { refuseRetiredDestructiveScript } from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';
refuseRetiredDestructiveScript('scripts/db/cleanup-db.ts');
