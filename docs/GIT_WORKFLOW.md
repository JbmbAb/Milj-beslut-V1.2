# Git Workflow – Miljöbeslut V2.0

## The Golden Rule: Rebase Locally, Squash Merge to Main

En optimal git-strategi för ett svenskt miljöstödsystem med många bidragsgivare och långa feature-branches.

---

## 1. Syfte

- **Linear history på main** → lätt att hitta bugs med `git bisect`
- **Clean PRs** → reviewers ser intentionen, inte 112 slumpmässiga commits
- **Fewer conflicts** → löses per-commit under rebase, inte i en stor merge-commit
- **Sustainable branching** → undviker "merge hellscape" vid långa feature-branches

---

## 2. Principer

### A. **Rebase Locally Before Push**
```bash
git fetch origin
git rebase origin/main
git push origin feature-branch
```

**Varför:**
- Dina commits stackas ON TOP av main's senaste historia
- Inga merge-commits i din branch
- Konflikter löses incrementellt per commit (lättare debugging)

### B. **Squash Merge to Main** (via GitHub UI eller CLI)
```bash
# Via CLI:
gh pr merge --squash

# Eller via GitHub UI: 
# PR → "Squash and merge"
```

**Varför:**
- Main branch förblir helt linear (1 commit per feature)
- Feature-grenen preserverar full commit-historia (checkout manuellt om behövligt)
- Enkelt att se: "PR #42 = vad gjorde vi?" utan 47 intermediate commits

### C. **Never Force-Push to Main**
- main är **immutable**
- Feature-branches: force-push OK (lokalt arbete)
- main: merge only (skyddar historiken)

---

## 3. Workflow: Steg-för-steg

### **Setup (första gången)**

```bash
# 1. Clone repo
git clone https://github.com/JbmbAb/Milj-beslut-V1.2.git
cd Milj-beslut-V1.2

# 2. Konfigurera lokalt (optional, sparar tangenttryckningar)
git config user.name "Ditt Namn"
git config user.email "din@email.se"

# 3. Sätt rebase som standard för pull
git config pull.rebase true
```

### **Starta Feature**

```bash
# 1. Synka main
git fetch origin
git checkout main
git reset --hard origin/main

# 2. Skapa feature-branch
git checkout -b feat/my-feature
# eller: git checkout -b fix/issue-123
```

### **Under Utveckling**

```bash
# Commit ofta (små, logiska ändringar)
git add .
git commit -m "feat: add sewage requirement validator"

# Push när redo för review
git push -u origin feat/my-feature
```

### **Innan Push (eller innan PR)**

```bash
# Uppdatera från main
git fetch origin

# Rebase (inte merge!) lokalt
git rebase origin/main

# Om konflikter:
# 1. Fixa conflict markers
# 2. git add <file>
# 3. git rebase --continue
# (alternativt: git rebase --abort för att avbryta)

# Push (force OK eftersom det är EN branch)
git push origin feat/my-feature --force-if-needed
```

### **PR → Review → Merge**

1. **Öppna PR** från `feat/my-feature` → `main`
   ```bash
   gh pr create --title "feat: add X" --body "Closes #123"
   ```

2. **Request review** på GitHub

3. **Reviewers granskar**
   - Branch är redan rebased (linear)
   - Enkelt att följa commits

4. **Merge via Squash**
   ```bash
   gh pr merge --squash --auto
   # Eller via GitHub UI:
   # PR → "Squash and merge"
   ```

5. **Delete remote branch** (GitHub gör ofta auto)
   ```bash
   git push origin --delete feat/my-feature
   ```

6. **Cleanup lokalt**
   ```bash
   git checkout main
   git pull origin main
   git branch -d feat/my-feature
   ```

---

## 4. Konflikthantering

### **Scenario A: Konflikt Under Rebase**

```bash
# Medan du rebasar
git rebase origin/main
# Fel: Conflict in src/types/core.ts

# Fix konflikten i editorn, sedan:
git add src/types/core.ts
git rebase --continue

# (repeat for each commit with conflicts)

# När klar, force-push
git push origin feat/my-feature --force-if-needed
```

### **Scenario B: Konflikt Under PR Merge**

Om GitHub säger "This branch has conflicts":

```bash
# Lokalt:
git fetch origin
git rebase origin/main
git push origin feat/my-feature --force-if-needed

# GitHub uppdateras automatiskt
# PR märkare försvinner → kan merga nu
```

### **Scenario C: Lång Feature (112+ commits)**

Om din branch är långt bakom main:

```bash
# Innan rebase, stashu all uncommitted work
git stash

# Rebase
git rebase origin/main

# Pop stash
git stash pop

# Många commits = många konflikter?
# → Bra sign att din branch redan divergerat
# → Splita i flera PRs (som vi gjorde här)
```

---

## 5. Best Practices

### ✅ DO

- **Commit messages på engelska** (GitHub standard)
  ```
  feat: add SWEREF99 projection support
  fix: handle null municipality in report
  docs: update GIT_WORKFLOW.md
  chore: update dependencies
  ```

- **Commits = logiska, reviewable changesets**
  ```
  Bra:  feat(sewage): validate requirement deadlines
  Dålig: WIP, update, fixes, omg this is broken
  ```

- **Rebase early, rebase often**
  - Rebase daily om main uppdateras ofta
  - Mindre konflikter per commit

- **Push frequently** (gärna som draft PR)
  - Låt reviewers se progress
  - Backup om datorn kraschar

### ❌ DON'T

- **Aldrig force-push till main**
  - Kan riva sönder collaboration
  - GitHub branch protection förhindrar detta

- **Aldrig rebasa efter public push** (om noen annan använder din branch)
  - Omskriven historia = broken för others
  - Använd merge eller --no-verify

- **Aldrig committa secrets**
  - `.env` files i `.gitignore`
  - Use GitHub Secrets för CI/CD

- **Aldrig merga utan review**
  - PR reviews är obligatoriska (policy)
  - Branch protection enforcar detta

---

## 6. GitHub Configuration (Branch Protection)

Denna repo bör ha GitHub branch protection för `main`:

**Inställningar** → **Branches** → **Add rule**:

```
Branch name pattern: main

✓ Require a pull request before merging
  ✓ Require approvals (1)
  ✓ Require conversation resolution before merging
  ✓ Dismiss stale pull request approvals
  
✓ Require status checks to pass before merging
  ✓ Require branches to be up to date
  - tsc --noEmit (TypeScript)
  - npm run lint (ESLint)
  - npm run test:unit (Vitest)

✓ Include administrators
✓ Restrict who can push to matching branches
```

---

## 7. Commit Message Standard (Conventional Commits)

Alla commits ska följa [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: Nya features
- `fix`: Bugfixes
- `docs`: Dokumentation
- `style`: Formatting, ingen kod-ändring
- `refactor`: Omstrukturering utan behavior-ändring
- `perf`: Prestandaförbättringar
- `test`: Test-ändringar
- `chore`: Build, dependencies, tools

### Examples

```
feat(sewage): add requirement validator

Add a new validator for sewage effluent requirements
that checks against SWEREF99 coordinates.

Closes #123
```

```
fix(map): handle null geometry in GIS layer

Previously threw TypeError when feature had no geometry.
Now gracefully skips invalid features.
```

```
docs: update GIT_WORKFLOW for rebase strategy

Adds step-by-step instructions for local rebasing
and squash-merging to main.
```

---

## 8. Troubleshooting

### "My branch is 112 commits ahead"

**Orsak:** Du har inte rebased på flera veckor/månader

**Lösning:**
```bash
git fetch origin
git rebase origin/main

# Om många konflikter:
# Split features in separate branches/PRs
```

### "Cannot push, branch has diverged"

**Orsak:** Du rebased lokalt, men main uppdaterades

**Lösning:**
```bash
git fetch origin
git rebase origin/main
git push origin feat/my-feature --force-if-needed
```

### "Merge conflict in rebase"

**Orsak:** Same file changed i main och din commit

**Lösning:**
```bash
# 1. Edit file, remove conflict markers
# 2. git add <file>
# 3. git rebase --continue
# (eller git rebase --abort för att backtrack)
```

### "Accidentally force-pushed to main"

**STOP. Contact admin immediately.**

Main kan recoveras från backup/reflog, men detta är kritiskt.

---

## 9. Tools & Automation

### Git Aliases (spara i `~/.gitconfig`)

```bash
[alias]
  st = status
  co = checkout
  br = branch
  ci = commit
  unstage = reset HEAD --
  last = log -1 HEAD
  visual = log --graph --oneline --all
  rebasin = rebase -i origin/main
```

### Pre-commit Hooks (optional, i repo)

Planerats: `.git/hooks/pre-push` för att köra tester före push.

### GitHub Actions (CI/CD)

Redan konfigurerad (`.github/workflows/`):
- ✅ npm run typecheck
- ✅ npm run lint
- ✅ npm run test:unit
- ✅ Build test

---

## 10. FAQ

**F: Varför rebase och inte merge?**
A: Rebase ger linear history, lättare debugging, cleaner git log.

**F: Kan jag rebasa efter push?**
A: JA, på feature branches. NEJ, på main. Använd `--force-if-needed` för safety.

**F: Vad om jag gör misstag under rebase?**
A: `git reflog` sparar allt. Du kan alltid göra `git reset --hard <commit>`.

**F: Squash merge raderar commits?**
A: NEJ, commits är kvar på feature-branchen. Main får bara 1 commit.

**F: Kan jag rebasa en PR efter den är öppen?**
A: JA, push en ny rebased version. GitHub uppdaterar PR automatiskt.

**F: Hur många commits per feature?**
A: 1–10. Om du har 50+, split i flera PRs.

---

## 11. References

- [Pro Git: Rebasing](https://git-scm.com/book/en/v2/Git-Branching-Rebasing)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Flow](https://guides.github.com/introduction/flow/)
- [Squash Merging](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)

---

**Version:** 1.0 (2026-07-21)
**Autor:** Copilot + JbmbAb
**Status:** Aktivt
