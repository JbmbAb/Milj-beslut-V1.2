# QA-dokumentation

Denna katalog innehåller **testbevis, staging-gates och scope-lås** — inte arkitektur eller deploy.

## Aktiva checklists (före merge/release)

| Dokument | Syfte |
| -------- | ----- |
| [production-readiness-checklist.md](./production-readiness-checklist.md) | Prod-gates |
| [STAGING_SETUP_CHECKLIST.md](./STAGING_SETUP_CHECKLIST.md) | Staging-miljö |
| [critical-flows.md](./critical-flows.md) | Kritiska användarflöden |
| [legal-review-checklist.md](./legal-review-checklist.md) | Juridisk granskning (om filen finns) |

## Scope-lås

| Dokument | Syfte |
| -------- | ----- |
| [core-scope-lock.md](./core-scope-lock.md) | Kärnscope |
| [mvp-scope-lock.md](./mvp-scope-lock.md) | MVP-gräns |
| [production-scope-without-bankid.md](./production-scope-without-bankid.md) | Prod utan BankID |

## Staging-bevis (historik — behålls för spårbarhet)

| Dokument | Datum/kontext |
| -------- | ------------- |
| [FAS1_STAGING_EVIDENCE.md](./FAS1_STAGING_EVIDENCE.md) | Fas 1 |
| [FAS2_STAGING_EVIDENCE.md](./FAS2_STAGING_EVIDENCE.md) | Fas 2 |
| [FAS3_STAGING_EVIDENCE.md](./FAS3_STAGING_EVIDENCE.md) | Fas 3 |
| [FAS_1_4_COMPLETION.md](./FAS_1_4_COMPLETION.md) | Sammanfattning fas 1–4 |
| [P3_STAGING_EVIDENCE_2026-06-09.md](./P3_STAGING_EVIDENCE_2026-06-09.md) | P3-bevis |
| [P3_GO_NO_GO_2026-06-09.md](./P3_GO_NO_GO_2026-06-09.md) | Go/no-go |

## Genererade rapporter (ej i git)

Kör lokalt vid behov:

```bash
npm run analyze:vitest-failures    # → docs/qa/vitest-backlog.md
npm run report:coverage-gaps       # → docs/qa/coverage-baseline-generated.md
```

Se [coverage-baseline.md](./coverage-baseline.md) för tolkning.

## Arkitektur / data-gap

Använd **inte** denna mapp — se [docs/architecture/data-coverage-gaps.md](../architecture/data-coverage-gaps.md) och [docs/architecture/future-optimizations-backlog.md](../architecture/future-optimizations-backlog.md).

## AI-arbetsflöde

Canonical: [AGENTS.md](../../AGENTS.md) i repots rot.
