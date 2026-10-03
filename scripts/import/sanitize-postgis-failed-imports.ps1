# U30F7 (ägarbeslut 2026-10-03): PENSIONERAD -- RETIRED.
# Engångsstädningen efter en avbruten GIS-import (DROP SCHEMA transport/stage CASCADE och DROP TABLE ... CASCADE på
# env/lm-tabeller som pg_stat säger är tomma) är avvecklad som en fail-closed ingång: skriptet rör ingenting och
# avslutar med fel (exit 2).
# The one-off cleanup after an aborted GIS import (schema and table drops with CASCADE) is retired as a fail-closed
# entry point: it touches nothing and exits 2.
# Skäl och ersättning / reason and replacement: RETIRED_DESTRUCTIVE_SCRIPTS (packages/spatial-provider-postgis/src/ProtectedRelationGate.ts).
# Den tidigare koden finns i git-historiken / the former code is in the git history. Ingen override / no override.
[Console]::Error.WriteLine('REJECT_RETIRED_DESTRUCTIVE_SCRIPT: scripts/import/sanitize-postgis-failed-imports.ps1 -- pensionerad (U30F7, ägarbeslut 2026-10-03): skriptet körs inte och rör ingenting / retired (U30F7, owner decision 2026-10-03): this script does not run and touches nothing. Se / see RETIRED_DESTRUCTIVE_SCRIPTS i packages/spatial-provider-postgis/src/ProtectedRelationGate.ts.')
exit 2
