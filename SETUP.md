# Developer Setup Guide

Snabb guide för att sätta upp utvecklingsmiljö med optimal git-konfiguration.

## Förutsättningar

- Git 2.30+ (kolla: `git --version`)
- Node.js 20+ (kolla: `node --version`)
- npm 10+ (kolla: `npm --version`)

## Installation

### 1. Clone repository

```bash
git clone https://github.com/JbmbAb/Milj-beslut-V1.2.git
cd Milj-beslut-V1.2   # lokalt mappnamn kan vara t.ex. miljöbeslut — repot är redan initierat, kör inte git init
```

> **Canonical repo:** endast `JbmbAb/Milj-beslut-V1.2`. Det finns inget separat `JbmbAb/milj-beslut`-repo.

### 2. Setup git configuration (automated)

```bash
# Windows (PowerShell)
.\scripts\setup-git-config.ps1

# macOS / Linux (Bash)
bash scripts/setup-git-config.sh
```

**Eller manuell setup:**

```bash
# Rebase by default on pull
git config pull.rebase true

# Auto-stash changes during rebase
git config rebase.autoStash true

# Better conflict markers
git config merge.conflictStyle zdiff3

# Detect file renames
git config diff.renameLimit 5000
```

### 3. Setup Node dependencies

```bash
npm install --legacy-peer-deps
```

### 4. Setup environment

```bash
# Copy example env
cp .env.example .env.local

# Edit .env.local with your settings
# (ask team for values if unsure)
```

### 5. Setup database

```bash
# Run migrations
npm run db:migrate

# (optional) Seed test data
npm run db:seed
```

## Verify Setup

```bash
# TypeScript
npx tsc --noEmit

# ESLint
npm run lint

# Unit tests
npm run test:unit

# Build
npm run build

# Dev server
npm run dev
# Open: http://localhost:5173
```

If everything passes ✅ – you're ready to contribute!

## First Contribution

```bash
# 1. Create branch
git co -b feat/my-feature

# 2. Make changes & commit
git add .
git commit -m "feat: describe what you did"

# 3. Before push: rebase
git fetch origin
git rebase origin/main
git push origin feat/my-feature

# 4. Open PR on GitHub
# → go to https://github.com/JbmbAb/Milj-beslut-V1.2/pulls
# → "New pull request"
# → Select your branch
```

See [`docs/GIT_WORKFLOW.md`](../docs/GIT_WORKFLOW.md) for full guide.

## Troubleshooting

### npm install fails

```bash
# Try with --legacy-peer-deps
npm install --legacy-peer-deps

# Or clear cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### TypeScript errors after setup

```bash
# Clear cache
rm -rf dist .vite node_modules/.vite

# Reinstall
npm install --legacy-peer-deps

# Recheck
npx tsc --noEmit
```

### Can't push to main

```bash
# Make sure you're on a feature branch, not main
git branch  # shows current branch

# Create one if needed
git co -b feat/my-feature
```

### Git refuses to rebase

```bash
# Make sure you have no uncommitted changes
git status

# If you do, either:
git add . && git commit -m "WIP: ..."  # commit them
# or
git stash  # temporarily store them
```

## Common Commands

```bash
# Status
git st

# Create branch
git co -b feat/my-feature

# Rebase before push
git fetch origin && git rebase origin/main

# Push
git push origin feat/my-feature

# See visual log
git visual

# Undo last commit (keep changes)
git undo-last

# Interactive rebase
git rebasin
```

## Ask for Help

- **Git questions:** See `docs/GIT_WORKFLOW.md`
- **Setup issues:** Create an Issue on GitHub with `[SETUP]` tag
- **Team slack/chat:** @mention the team

Welcome! 🎉

---

**Last updated:** 2026-07-21
