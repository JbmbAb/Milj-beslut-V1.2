# Branch protection & merge gates

Canonical guide for `main` on [JbmbAb/Milj-beslut-V1.2](https://github.com/JbmbAb/Milj-beslut-V1.2). Se även [docs/GIT_WORKFLOW.md](../GIT_WORKFLOW.md).

## GitHub UI — steg för steg

1. Öppna: `https://github.com/JbmbAb/Milj-beslut-V1.2/settings/branches`
2. **Add rule** → pattern: `main`
3. Aktivera:
   - Require a pull request (minst **1** approval)
   - Require conversation resolution
   - Require status checks to pass + branch up to date
   - Dismiss stale approvals on new commits
   - Block force push och branch deletion
   - Enforce for administrators

## Required status checks

Jobbnamn från `.github/workflows/ci.yml`:

| Check               | Jobb               |
| ------------------- | ------------------ |
| `Typecheck`         | TypeScript         |
| `Lint`              | ESLint             |
| `Format check`      | Prettier           |
| `Unit tests`        | Vitest unit        |
| `Integration tests` | Vitest integration |
| `Build`             | Vite build         |
| `E2E tests`         | Playwright         |

Rekommenderat att även kräva **Vertex Prompt Optimizer** och **Python security scan** när de körs på PR (se [docs/qa/README.md](./README.md)).

## Human-in-the-loop (PR)

- Juridisk checklista: [legal-review-checklist.md](./legal-review-checklist.md)
- Kritiska flöden: [critical-flows.md](./critical-flows.md)

## Merge policy

- Squash merge till `main` (standard enligt GIT_WORKFLOW)
- Inga direkta pushes till `main`
- Staging deploy: `deploy-staging.yml` väntar på grön CI (`workflow_run`)

Secrets för deploy: [docs/ops/secrets.md](../ops/secrets.md).

## Verifiera

1. Öppna PR → status checks ska köras
2. Merge utan review → blockeras
3. Force push till `main` → blockeras
