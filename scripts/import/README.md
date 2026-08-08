# Import och Harvesting: Mimers Brunn

Nya import- och nedladdningsscripts ska följa [Mimers Brunn v2.0.1](../../docs/architecture/mimers-brunn-v2.0.1.md) (ACTIVE). Operational path detail: [v1.0 legacy](../../docs/architecture/mimers-brunn-offline-first.md).

## Obligatorisk checklista för nya harvesting-scripts

- Skriv nya filer till `GEO_Master_Archive`, inte till `D:\GEodata`, `D:\Geo inlärning` eller `C:\GEO PDF`.
- Lagra varje hämtning i versions- eller tidsstämplad katalog. Skriv aldrig över historiska filer.
- Skapa manifest med provider, dataset, sourceUrl, archivePath, runtimePath, downloadedAt, sizeBytes och sha256.
- Använd polite scraping: begränsad concurrency, delay/jitter, bounded retries, backoff och checkpointing.
- Spara `ETag`, `Last-Modified`, content-type och eventuella käll-checksums när de finns.
- Importera bara klassade och verifierade data till PostGIS. Importera inte från `_review`.
- Be om godkännande innan långa eller trafikintensiva körningar.

Legacy-scripts i denna mapp kan fortfarande innehålla gamla sökvägar. De är migrationsskuld och ska inte kopieras som mall för ny kod.
