# QA-dokumentation

Testbevis, scope-lås och release-gates. **Arkitektur/data-gap:** [docs/architecture/README.md](../architecture/README.md).

## Innan merge / release

| Dokument                                                                 | Syfte                                |
| ------------------------------------------------------------------------ | ------------------------------------ |
| [production-readiness-checklist.md](./production-readiness-checklist.md) | Go-live (staging → prod)             |
| [product-readiness-checklist.md](./product-readiness-checklist.md)       | Affärskrav per tjänst                |
| [critical-flows.md](./critical-flows.md)                                 | Kritiska flöden                      |
| [legal-review-checklist.md](./legal-review-checklist.md)                 | Juridisk PR-granskning               |
| [branch-protection.md](./branch-protection.md)                           | GitHub branch protection (canonical) |

## Scope

| Dokument                                                                   | Syfte                             |
| -------------------------------------------------------------------------- | --------------------------------- |
| [core-scope-lock.md](./core-scope-lock.md)                                 | **Canonical** Core/MVP-gräns (P0) |
| [production-scope-without-bankid.md](./production-scope-without-bankid.md) | P3 utan BankID                    |

> `mvp-scope-lock.md` slogs ihop med `core-scope-lock.md` (2026-07-26) — samma innehåll, ett dokument.

## Staging & E2E (operativt)

| Dokument                                                       | Syfte                        |
| -------------------------------------------------------------- | ---------------------------- |
| [STAGING_SETUP_CHECKLIST.md](./STAGING_SETUP_CHECKLIST.md)     | Infra, env, deploy staging   |
| [README-staging-e2e.md](./README-staging-e2e.md)               | Playwright PDF-ready moduler |
| [test-runbook.md](./test-runbook.md)                           | Testkörning lokalt/CI        |
| [operations-readiness-pack.md](./operations-readiness-pack.md) | Ops/runbook                  |

## Implementation (produkt)

| Dokument                                                           | Syfte                               |
| ------------------------------------------------------------------ | ----------------------------------- |
| [MODULE_IMPLEMENTATION_PLAN.md](./MODULE_IMPLEMENTATION_PLAN.md)   | Tre fokusmoduler (canonical UI/API) |
| [requirements-model-workflow.md](./requirements-model-workflow.md) | Kravmodell                          |
| [commercial-packaging.md](./commercial-packaging.md)               | Kommersiell paketering              |

## Coverage

| Dokument                                       | Syfte                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [coverage-baseline.md](./coverage-baseline.md) | Tolkning av coverage                                              |
| Genererade filer (ej i git)                    | `npm run analyze:vitest-failures`, `npm run report:coverage-gaps` |

## Staging-bevis (historik / audit)

→ [staging-evidence/README.md](./staging-evidence/README.md)

## Data-gap (ej QA)

Geodata-luckor: [docs/architecture/data-coverage-gaps.md](../architecture/data-coverage-gaps.md)  
AI-index (kort): [knowledge-base/DATA_COVERAGE_GAPS.md](../../knowledge-base/DATA_COVERAGE_GAPS.md)

## AI-arbetsflöde

[AGENTS.md](../../AGENTS.md)
