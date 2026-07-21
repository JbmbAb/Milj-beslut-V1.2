# Bidra till Milj-beslut-V1.2

## Behörigheter och åtkomst

### Var ändrar jag behörigheter? (GitHub)

Behörigheter hanteras av repositoryts **ägare eller administratör** direkt i GitHub-inställningarna:

1. Gå till: `https://github.com/JbmbAb/Milj-beslut-V1.2/settings/access`
2. Klicka på **"Add people"** eller **"Add teams"**
3. Välj roll: `Read`, `Triage`, `Write`, `Maintain` eller `Admin`

> **Obs:** Bara ägare/admins kan ändra behörigheter. Om du saknar åtkomst, kontakta repo-ägaren (JbmbAb).

### Begära skrivrättigheter

Om du vill ha skrivrättigheter (`Write` eller `Maintain`):

1. Öppna ett **Issue** i detta repo med rubriken: `[ACCESS] Begäran om skrivrättigheter`
2. Beskriv varför du behöver åtkomst och vilket team/syfte det gäller
3. En admin granskar och beviljar åtkomst

### GitLab-spegling (om aktuellt)

Om projektet speglas till GitLab hanteras GitLab-behörigheter separat:

- Gå till GitLab-projektets **Settings → Members**
- Välj roll: `Guest`, `Reporter`, `Developer`, `Maintainer` eller `Owner`
- Kontakta GitLab-projektets ägare för att begära åtkomst

---

## Utvecklingsmiljö

```bash
npm install
cp .env.example .env.local   # fyll i nödvändiga miljövariabler
npm run db:migrate
npm run dev                   # startar på http://localhost:5173
```

## Tester

```bash
npm run test:unit          # enhetstester
npm run test:components    # komponenttester (jsdom)
npm run typecheck          # TypeScript-kontroll
npm run lint               # ESLint
```

## Hantering av instabila ('flaky') tester

En policy för att säkerställa en stabil testsvit.

1.  **Identifiering:** Ett test anses vara "flaky" om det passerar och misslyckas intermittent utan kodändringar.
2.  **Karantän:** När ett "flaky" test identifieras ska det omedelbart sättas i karantän genom att hoppa över det (t.ex. med `test.skip`). En kommentar ska läggas till som förklarar varför testet hoppas över, inklusive en länk till ett relevant issue.
3.  **Issue-skapande:** Ett issue ska skapas i issue-trackern för att dokumentera det instabila testet. Issuet ska innehålla testnamn, felmeddelande och annan relevant information.
4.  **Prioritering:** Flaky tester ska prioriteras och åtgärdas så snart som möjligt, eftersom de kan dölja verkliga buggar.
5.  **Åtgärd:** Målet med att fixa ett "flaky" test är att göra det deterministiskt. Detta kan innebära bättre mockning, förbättrad testdata-setup eller andra tekniker.
6.  **Återintroduktion:** När testet är fixat ska det återaktiveras och övervakas för att säkerställa att det inte längre är instabilt.

## Pull Requests & Git Workflow

**Se [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md) för fullständig guide.**

Kort sammanfattning:

1. **Skapa branch från main**
   ```bash
   git fetch origin
   git checkout -b feat/min-feature main
   ```

2. **Gör ändringar & commit**
   ```bash
   git add .
   git commit -m "feat: beskriv vad du gör"
   ```

3. **Rebase innan push** (viktigt!)
   ```bash
   git fetch origin
   git rebase origin/main
   git push origin feat/min-feature
   ```

4. **Tester & linting**
   ```bash
   npm run typecheck && npm run lint && npm run test:unit
   ```

5. **Öppna PR** med beskrivande titel
   - GitHub Actions körs automatiskt
   - Vänta på review
   - Merge via **"Squash and merge"** när godkänd

### Rebase Strategy

Vi använder **Rebase + Squash Merge** för:
- ✅ Linear history på main
- ✅ Clean git log (bisect, blame)
- ✅ Färre konflikter

Se `docs/GIT_WORKFLOW.md` för:
- Konflikthantering
- Best practices
- Troubleshooting
- Commit message standard (Conventional Commits)
