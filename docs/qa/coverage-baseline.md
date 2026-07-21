# Coverage baseline

## Generating HTML + lcov

```bash
npm run test:unit:coverage
```

Artifacts (gitignored locally):

- HTML report: `coverage/index.html`
- lcov: `coverage/lcov.info`

## Listing the weakest-covered areas (server + src)

After a successful coverage run:

```bash
node scripts/report-coverage-gaps.mjs
```

Optional: `node scripts/report-coverage-gaps.mjs --top=40`

This prints the lowest line-coverage files under `server/` and `src/` from `coverage/lcov.info`, and refreshes `docs/qa/coverage-baseline-generated.md` when the script can write to `docs/qa/`.

## CI

The unit-test job runs `npm run test:unit:coverage` so Vitest `coverage.thresholds` apply on clean branches.

## Supply chain (related)

- Dependabot: `.github/dependabot.yml`
- CodeQL: `.github/workflows/codeql.yml`
- PR dependency review + audit: `.github/workflows/supply-chain.yml`
- **Secret scanning** and **push protection** for credentials: enable under GitHub repository **Settings → Code security and analysis** (org-nivå rekommenderas).

## Interpretation

- lcov “lines” here follow `DA:` records in lcov (executable lines Vitest/v8 emitted).
- Prioritize **branch** gaps and **security-sensitive** paths (auth, uploads, admin APIs) even when overall line % is high.
