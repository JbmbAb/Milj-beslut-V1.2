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

## Pull Requests

1. Skapa en branch från `main`
2. Gör dina ändringar med tillhörande tester
3. Kör `npm run typecheck && npm run lint && npm run test:unit`
4. Öppna en PR mot `main` med en beskrivande titel
