# Val av AI-Modell för Miljobeslut.se

Denna guide beskriver **vilket AI-verktyg** som passar bäst för olika uppgifter i repot,
baserat på kontextfönsterstorlek och modellegenskaper.

---

## TL;DR – snabbval

| Uppgift | Verktyg | Modell |
|---|---|---|
| Daglig kodgenerering (1–10 filer) | Cursor / Copilot Agent | Claude 3.5 Sonnet |
| Helikopteranalys av hela kodbasen | Google AI Studio | Gemini 1.5 Pro |
| Komplex logisk bugg i GIS/AI-motor | OpenAI web | o1 / o3-mini |
| CI/CD, tester, commit | GitHub Copilot Agent | – (primär, se AGENTS.md) |

---

## 1. Gemini 1.5 Pro – Bäst för helhetsanalys

**Kontextfönster:** upp till **2 000 000 tokens** (~100 000+ rader kod)

Välj Gemini 1.5 Pro när du behöver:
- Läsa **hela backend-mappen** + alla markdown-dokument + databasschemat samtidigt
- Identifiera **glapp mellan dokumentation och faktisk kod**
- Göra en fullständig **funktions- och täckningsanalys** (se prompt-mall nedan)
- Analysera **migrationshistorik** mot nuvarande schema

**Hur du använder det:**
1. Kör `npx repomix` i repots root (se `repomix.config.json`)
2. Öppna [Google AI Studio](https://aistudio.google.com)
3. Välj modell: **Gemini 1.5 Pro**
4. Ladda upp `repomix-output.xml`
5. Klistra in prompt-mallen från `docs/templates/context-dump-prompt.md`

**Kostnad:** Gemini 1.5 Pro i AI Studio har en generös gratisnivå (upp till 2M tokens/minut för analys utan streaming).

---

## 2. Claude 3.5 Sonnet – Bäst för kodgenerering i editorn

**Kontextfönster:** **200 000 tokens** (~10 000 rader)

Välj Claude 3.5 Sonnet när du behöver:
- Förstå hur **5–10 komplexa filer** interagerar (repositories + services)
- Generera ny källkod med hög kvalitet
- Implementera en spec från Figma Make eller AI Studio
- Snabb refactoring av en specifik modul

**Hur du använder det i Cursor:**
```
1. Öppna Cursor-inställningar → Model → välj claude-3-5-sonnet-20241022
2. Aktivera: Settings → Features → Codebase Indexing (ON)
3. Vänta tills indexeringen är klar (statusbar längst ner)
4. Använd @-flaggor i chat:
   - @Codebase   → semantisk sökning i hela indexet
   - @server/repositories  → inkludera hela mappen
   - @docs/architecture/system_architecture_blueprint.md  → arkitekturregler
   - @AGENTS.md  → AI-direktiv och flödesregler
```

**Tänk på:** Claude 3.5 Sonnet är bättre på att generera *korrekt* kod än att hålla hela arkitekturen i minnet. Kombinera med `@Codebase` för bästa resultat.

---

## 3. OpenAI o1 / o3-mini – Bäst för komplex logik

**Kontextfönster:** 128 000 tokens (o1), 200 000 tokens (o1-pro)

Välj o1/o3-mini när du behöver:
- Lösa en **extremt svår logisk bugg** i GIS-analysmotor, embedding-pipeline eller vektorsökning
- Verifiera ett komplext **PostgreSQL-index** eller Prisma-query
- Analysera ett race condition i `searchWorker.ts` eller `errorTrackingService.ts`

**Hur du använder det:**
- Direkt i [ChatGPT](https://chatgpt.com) med modell `o1` eller `o3-mini`
- Klistra in den relevanta filen + felmeddelandet

> **Obs:** o1 är sämre lämpad för att läsa tusentals filer jämfört med Gemini 1.5 Pro. Använd det för punktanalys, inte helhetsanalys.

---

## 4. Codebase Indexing i Cursor – steg för steg

```
Settings (Ctrl+,) → Features → Codebase Indexing → Enable ✓
```

Cursor bygger nu en lokal vektordatabas av repot. Filer i `.cursorignore` indexeras INTE.

**Nyttiga @-kommandon:**
| Kommando | Effekt |
|---|---|
| `@Codebase` | Söker igenom hela indexet semantiskt |
| `@docs` | Inkluderar alla filer i `docs/` |
| `@server/repositories` | Inkluderar hela repositories-mappen |
| `@AGENTS.md` | Sätter AI-direktiven som kontext |
| `@system_architecture_blueprint.md` | Sätter arkitekturreglerna |
| `@prisma/schema.prisma` | Inkluderar hela databaschemat |

---

## 5. Full Context Dump – steg för steg

För helikopteranalyser som inte ryms i editorns RAG-sökning:

```bash
# 1. Installera repomix (en gång)
npm install -g repomix

# 2. Generera context dump från repots root
npx repomix

# Filen repomix-output.xml skapas (~5-20 MB beroende på kodbas)
# package-lock.json, CSV-filer och binärer exkluderas automatiskt

# 3. Öppna Google AI Studio
#    → Ladda upp repomix-output.xml
#    → Välj Gemini 1.5 Pro
#    → Klistra in prompt från docs/templates/context-dump-prompt.md
```

> `repomix-output.xml` är listad i `.gitignore` och ska INTE committas.

---

## 6. Ansvarsfördelning (koppling till AGENTS.md)

```
Analys-/helikopterbehov
    └─► Gemini 1.5 Pro (AI Studio) ──► text/spec/rapport ──► du

Kodgenerering (dagligt)
    └─► Claude 3.5 Sonnet (Cursor) ──► spec till Copilot Agent ──► commit

Logisk bugg / punktanalys
    └─► o1 / o3-mini (ChatGPT) ──► förslag ──► du ──► Copilot Agent implementerar

Commit till repot
    └─► ALLTID GitHub Copilot Agent (primär) – inga andra AI:er commitar
```
