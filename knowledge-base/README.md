# Knowledge base — index för Gemini Enterprise

Denna mapp är avsedd att indexeras av **Gemini Enterprise**, **Vertex AI Search** och specialiserade agenter (Mimer Bibliotekarie).

## Primära dokument

| Fil | Syfte |
|-----|--------|
| [MIMER_LIBRARIAN.md](./MIMER_LIBRARIAN.md) | Mandat, Mimers Brunn, harvesting-kontrakt |
| [DATA_COVERAGE_GAPS.md](./DATA_COVERAGE_GAPS.md) | **Kort gap-status** — synkas med `docs/architecture/data-coverage-gaps.md` |
| [NATIONAL_HARVESTING_PHASES.md](./NATIONAL_HARVESTING_PHASES.md) | Länsstyrelsen 2068 dataset |
| [SEWAGE_HARVESTING_STRATEGY.md](./SEWAGE_HARVESTING_STRATEGY.md) | Enskilt avlopp-data |
| [DALARNA_HARVESTING_STRATEGY.md](./DALARNA_HARVESTING_STRATEGY.md) | Regional strategi |

## Utökad dokumentation (Git / docs/)

| Ämne | Sökväg |
|------|--------|
| Geodata-gap (full) | `docs/architecture/data-coverage-gaps.md` |
| AI/prod-backlog | `docs/architecture/future-optimizations-backlog.md` |
| Gemini åtkomst-setup | `docs/ops/gemini-enterprise-access.md` |
| Projektinstruktioner | `GEMINI.md` (repo root) |
| Agent-regler | `AGENTS.md` (repo root) |

## PostGIS (schema, inte live-data)

Indexera från Git — **inte** Docker-volymen:

- `prisma/spatial/*.sql`
- `prisma/schema.prisma`
- `docs/architecture/data-dictionary.md`
- `docs/architecture/governance/data_matrix.md`

## Geodata (canonical)

Master Archive på Drive: `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\`

Se `docs/ops/gemini-enterprise-access.md` för koppling mellan Git, Drive och PostGIS.
