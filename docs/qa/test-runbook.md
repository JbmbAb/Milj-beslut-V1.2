# QA Test Runbook

## Prerequisites

- Node.js 22
- PostgreSQL running and reachable by `DATABASE_URL`
- `.env.test` present (copy from `.env.test.example`)

## First-time setup

1. Install dependencies:
   - `npm ci`
2. Prepare test env:
   - `copy .env.test.example .env.test` (Windows)
3. Prepare database:
   - `npm run db:test:migrate`
   - `npm run db:test:seed`

## Core commands

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- E2E tests: `npm run test:e2e`
- Full QA: `npm run qa:full`

## Windows one-command runner

- `powershell -ExecutionPolicy Bypass -File scripts/test/run-all.ps1`
- Full (includes E2E/build):
  - `powershell -ExecutionPolicy Bypass -File scripts/test/run-all.ps1 -Full`

## Manual smoke (human-in-loop)

After automated checks, run:

- `powershell -ExecutionPolicy Bypass -File scripts/smoke-project-plan.ps1 -BaseUrl http://localhost:8787 -ProjectId <project-id> -Username admin -Password <admin-password>`

Then complete and sign:

- `docs/qa/legal-review-checklist.md`

## Troubleshooting

- Migration fails: verify `DATABASE_URL` and DB accessibility.
- 401/403 in tests: verify JWT/Admin env values.
- E2E failures: inspect `playwright-report` and `test-results` artifacts.
