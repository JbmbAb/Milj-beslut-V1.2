# Geo-Regulatory Engine

Additivt lager som separerar plattformskärnan från framtida domänpack (avlopp, strandskydd, bygglov, dagvatten).

## Kod (canonical)

| Fil | Syfte |
| --- | --- |
| [server/geo-regulatory/types.ts](../../server/geo-regulatory/types.ts) | Domän-, regelpack- och evidensvokabulär |
| [server/geo-regulatory/catalog.ts](../../server/geo-regulatory/catalog.ts) | Katalog över tillgängliga pack |
| [server/geo-regulatory/registry.ts](../../server/geo-regulatory/registry.ts) | Registrering och uppslag |
| [server/geo-regulatory/index.ts](../../server/geo-regulatory/index.ts) | Publikt API |

Modulerna ändrar inga befintliga runtime-flöden idag; de ger ett stabilt mål för framtida domänintegration.

## Relaterat

- [ombyggnadsstrategi_bygga_nytt_bygga_ratt.md](./ombyggnadsstrategi_bygga_nytt_bygga_ratt.md) — migreringsstrategi
- [modulregister_ombyggnad.md](./modulregister_ombyggnad.md) — modulstatus

## Arkiverat

Ursprunglig förberedelsedokumentation med brutna desktop-sökvägar finns i [docs/archive/architecture-snapshots/geo-regulatory-engine.md](../archive/architecture-snapshots/geo-regulatory-engine.md).
