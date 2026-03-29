# 🔄 Rutiner för lokal synkning mot VS Code / Cursor

> **Syfte:** Minimera risken för merge-konflikter när du arbetar lokalt i VS Code/Cursor parallellt med att Copilot Agent commitar till samma branch.

---

## Gyllene regel

**Copilot Agent är den enda som commitar till repot.**  
Du jobbar lokalt → beskriver uppgiften för Copilot Agent → Agent commitar → du pullar.  
Jobbar du ändå lokalt, följ rutinerna nedan strikt.

---

## Rutin A – Innan du börjar jobba lokalt

```bash
# 1. Hämta senaste ändringar från GitHub
git fetch origin

# 2. Kolla aktuell status
git status

# 3. Pusha ALDRIG utan att först ha pullat
git pull --rebase origin main
```

> **Varför rebase?** `--rebase` lägger dina lokala commits ovanpå remote-historiken, vilket ger en linjär historik och undviker onödiga merge-commits.

---

## Rutin B – Under arbete (kort session, max 2h)

- Gör **korta, atomära commits** ofta (var 30:e minut eller per logisk förändring)
- Ändra **inte** filer som Copilot Agent typiskt äger:
  - `server/services/` – ägs primärt av Copilot Agent
  - `tests/unit/`, `tests/components/` – ägs primärt av Copilot Agent
  - `prisma/schema.prisma` – kräver koordinering
- Du kan fritt redigera:
  - `components/` (Tailwind-styling, layout)
  - `public/` (statiska assets)
  - `docs/` (dokumentation)

```bash
# Commit ofta, med tydliga meddelanden
git add <specifika filer>
git commit -m "fix: justera padding i PermitTable"
```

---

## Rutin C – Innan du pushar

```bash
# 1. Hämta senaste remote-ändringar
git fetch origin

# 2. Rebasea dina commits ovanpå remote
git pull --rebase origin main

# 3. Lös eventuella konflikter (se Rutin E)

# 4. Kör lokal validering
npm run typecheck
npm run lint

# 5. Pusha
git push origin main
```

---

## Rutin D – När Copilot Agent har committat (du har öppen VS Code)

VS Code visar ofta "1 commit behind". Gör så här direkt:

```bash
# I VS Code-terminalen eller separat terminal:
git pull --rebase origin main
```

Eller klicka på **Sync Changes** i VS Code Source Control-panelen (⌃⇧G).

> ⚠️ **Vänta aldrig** med att pulla. Ju längre du väntar, desto fler konflikter riskerar du.

---

## Rutin E – Hantera konflikter

Om `git pull --rebase` fastnar vid en konflikt:

```bash
# VS Code visar konflikter med <<<<<<< / ======= / >>>>>>>
# 1. Öppna filen i VS Code – välj "Accept Current", "Accept Incoming" eller redigera manuellt
# 2. Markera konflikten som löst
git add <fil>

# 3. Fortsätt rebase
git rebase --continue

# 4. Repetera tills alla konflikter är lösta
```

Om det blir för rörigt – avbryt och börja om:

```bash
git rebase --abort
# Spara dina ändringar i en patch-fil och applicera manuellt
git diff HEAD > /tmp/mina-ändringar.patch
git checkout .
git pull origin main
git apply /tmp/mina-ändringar.patch
```

---

## Rutin F – Branch-strategi för längre lokalt arbete

Om du planerar ett längre lokalt arbetspass (>2h, många filer):

```bash
# 1. Skapa en feature-branch FRÅN senaste main
git checkout main
git pull origin main
git checkout -b feat/din-funktion

# 2. Jobba på branchen
# 3. Merga in eventuella main-uppdateringar under arbetet:
git fetch origin
git rebase origin/main

# 4. När klart – skapa PR mot main (ALDRIG direkt push till main)
```

> Feature-branches isolerar ditt arbete och ger Copilot Agent fri lejd på main.

---

## Snabbreferens – dagliga kommandon

| Situation | Kommando |
|---|---|
| Börja jobba | `git pull --rebase origin main` |
| Spara arbete | `git add -p && git commit -m "..."` |
| Sync mid-session | `git fetch && git rebase origin/main` |
| Avsluta session | `git pull --rebase && npm run typecheck && git push` |
| Agent har committat | `git pull --rebase origin main` |
| Konflikt uppstod | Se Rutin E ovan |

---

## VS Code-inställningar som hjälper

Lägg i `.vscode/settings.json` (om filen saknas, skapa den):

```json
{
  "git.autofetch": true,
  "git.autofetchPeriod": 180,
  "git.rebaseWhenSync": true,
  "git.confirmSync": false
}
```

- `autofetch`: VS Code hämtar automatiskt remote-ändringar var 3:e minut
- `rebaseWhenSync`: Sync-knappen i VS Code kör rebase istället för merge

---

## Vad Copilot Agent aldrig rör utan din begäran

- `.env` och `.env.local`
- `package.json` versionsnummer (utom vid explicit paketuppdatering)
- `prisma/migrations/` (inga manuella migrationer)
- Filer i `.vscode/` (utom om du explicit ber om det)

---

*Senast uppdaterad: 2026-03-29*
