# GitHub Branch Protection Setup

Denna guide konfigurerar GitHub branch protection för `main`-branchen för att enforcea arbetflödet.

## Steg-för-steg

### 1. Gå till Repository Settings

```
https://github.com/JbmbAb/Milj-beslut-V1.2/settings/branches
```

### 2. Lägg till ny regel för `main`

Klicka **"Add rule"**

**Branch name pattern:** `main`

### 3. Konfigurering

#### ✅ Require a pull request before merging

- [x] Require at least **1** approvals
- [x] Require conversation resolution before merging
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - [x] Require Code Review from Code Owners (om du använder CODEOWNERS)

#### ✅ Restrict who can push to matching branches

- [x] Enforce all the above restrictions for administrators
- [x] Allow force pushes → **NO ONE** (eller "Admins only" för emergency)
- [x] Allow deletions → **NO ONE**

#### ✅ Status Checks

Addera följande status checks (om konfigurerade i CI):

- `tsc --noEmit` (TypeScript check)
- `npm run lint` (ESLint)
- `npm run test:unit` (Vitest)
- `build` (Vite build)

Om inte alla är aktiva än, lägg till när du sätter upp CI/CD.

### 4. Dismissal Settings

- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require approval of the most recent reviewable push

### 5. Spara

Klicka **"Create"** eller **"Save changes"**.

---

## Resultat

Efter denna konfigurering kan **ingen** merga något till `main` utan:

1. ✅ En PR
2. ✅ Minst 1 approved review
3. ✅ All status checks passar
4. ✅ Alla conversations resolved
5. ✅ Branch är synkad med main

---

## GitHub Actions (CI/CD) – Setup

För att status checks ska fungera, du behöver `.github/workflows/` files.

### Befintlig konfiguration

Kolla: `.github/workflows/`

Om de inte finns, skapa en grundläggande CI:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [ main, feat/*, fix/* ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run build
```

---

## Verify Configuration

1. Prova att öppna en PR utan rebase → se om status checks körs ✅
2. Prova att merga utan approved review → ska blockeras ✅
3. Prova att force-push till main → ska blockeras ✅

---

## Notes

- **Admins kan override** (inte rekommenderat, endast emergencies)
- **Stash entries** från tidigare arbete kan kastas när klar
- **Squash merge är default** (konfigureras under repo settings → "Merge button")

---

**Se även:** `docs/GIT_WORKFLOW.md`
