# U30 – Omgranskning av innehållspinnade poster i skrivskyddsinventeringen

**Status:** gäller från U30F9 (2026-10-03). **Omfattning:** `tests/unit/protectedWriteChannels.reviewed.ts` (listan `REVIEWED_CHANNELS`), inventeringstestet `tests/unit/protectedRelationGateInventory.test.ts` och de två specifikationerna `protected-relations.v1.json` / `protected-relation-classification.v1.json`.

## 1. Vad en innehållspinne är

Varje post med policyn `DYNAMIC_REVIEWED` i `REVIEWED_CHANNELS` är **innehållspinnad**: fältet `contentSha256` är sha256 av det skannern läser av filen –

- för `package.json`: JSON-texten av fälten i `PACKAGE_JSON_PINNED_FIELDS` (`scripts`, `bin`, `config`, `husky`, `lint-staged`, `simple-git-hooks`, `nano-staged`, `gitHooks`), i den ordningen; ett nytt beroende är ingen ny körväg och fäller inte;
- för alla andra filer: hela texten med radslut normaliserade (`\r\n` → `\n`). En ren radslutsändring (CRLF/LF) fäller **inte**; en ändrad kodrad, en kommentar eller en tom rad fäller.

Grundregeln (ägarbeslut 2026-10-03, default-deny): en DB-kapabel sats med en icke-bokstavlig konstruktion är KAN_INTE_AVGÖRAS (`UNRESOLVABLE`/`DYNAMIC`) **om inte** sajten täcks av en granskad, innehållspinnad post med nåbarhetsbevis. Pinnen är det som gör undantaget hållbart: ändras filen upphör granskningen att gälla tills någon granskat om den.

## 2. Vad som krävs av varje pinnad post

Inventeringstestet kräver för varje `DYNAMIC_REVIEWED`-post:

| Fält | Krav |
|---|---|
| `justification` | ≥ 60 tecken: varför de dynamiska sajterna är godtagbara (vad som är dynamiskt, vad grinden eller koden gör vid körning). |
| `reachability` | ≥ 30 tecken: **nåbarhetsbevis** – hur filen nås (npm-skript, CI-steg, runbook, operatörskörning, anropare) eller varför den visats onåbar från produkt-, CI- och operatörsväg. |
| `reviewedOn` | ISO-datum för senaste granskning av posten. |
| `reviewedBy` | Vem som granskade (enhet + agent, t.ex. `U30F9 W-U30F9 (Claude Fable 5.1)`). |
| `contentSha256` | 64 hex: pinnen enligt avsnitt 1. |
| `sites` | exakt skannerns sajter i filen (multiset av `VERDICT KIND channel \| excerpt`). |

En post med PROTECTED-sajt får inte vara `DYNAMIC_REVIEWED` (grinda eller pensionera filen).

## 3. Omgranskningsförfarandet (det testets felmeddelande pekar på)

När inventeringstestet säger `a reviewed DYNAMIC file changed ... U30 re-review required` gör **den som ändrade filen**, i **SAMMA commit** som ändringen:

1. **Läs om filen** och kontrollera att postens `sites` och `justification` fortfarande stämmer. Har en ny kanal, ett nytt anrop eller en ny dynamisk sajt tillkommit: uppdatera `sites` (testet visar `new`/`gone`) och skriv om motiveringen. Har sajten blivit PROTECTED: posten får inte finnas kvar – grinda eller pensionera.
2. **Kontrollera `reachability`**: nås filen fortfarande på samma sätt? Har en ny start tillkommit (npm-skript, CI-steg, runbook) – skriv in den.
3. **Uppdatera `contentSha256`** till det värde testets felmeddelande anger (`content sha256 <hex>`), sätt `reviewedOn` till dagens datum och `reviewedBy` till dig själv (enhet + agent).
4. **Skriv `U30 re-review: <fil>` i commit-texten**, en rad per omgranskad fil.
5. **Godkännande före merge:** U30-spåret (den som för tillfället äger skyddsgrinden, se `LU-PRODUCT-STATUS`) eller en CODEOWNER för de filer som räknas upp i avsnitt 5 godkänner omgranskningen. Att posten, pinnen och låsen kan ändras i en och samma commit är den organisatoriska blockeraren D-9: pinnen fångar drift, den auktoriserar inget.

Att höja `contentSha256` utan steg 1–2 är **inte** en omgranskning. En post vars `reviewedOn` inte ändras när pinnen ändras är ett tecken på att steg 1–2 hoppats över.

## 4. Vad som INTE får göras

- Ta inte bort en pinne för att "slippa" omgranskning. Posten utan pinne fäller.
- Byt inte policy från `DYNAMIC_REVIEWED` till en opinnad policy för att slippa pinnen.
- Lägg inte en PROTECTED-sajt bakom en `DYNAMIC_REVIEWED`-post.
- Lägg inte till en post för en sajt som inte visats nåbar/onåbar enligt avsnitt 2 ("allowlista inte massvis").

## 5. Filer som kräver U30-spårets eller en CODEOWNERs godkännande (D-9)

- `tests/unit/protectedWriteChannels.reviewed.ts`
- `tests/unit/protectedRelationGateInventory.test.ts`
- `tests/unit/protectedWriteChannels.ts`
- `packages/spatial-provider-postgis/src/protected-relations.v1.json`
- `packages/spatial-provider-postgis/src/protected-relation-classification.v1.json`
- `packages/spatial-provider-postgis/src/ProtectedWriteClassifier.ts`, `scripts/data-pipeline/protected_relation_gate.py`, `scripts/lib/ProtectedRelationGate.ps1`

`.github/CODEOWNERS` är i dag en platshållare (`@your-github-username`). Bindningen av filerna ovan till CODEOWNERS eller Dev-Gov är ett ägarbeslut (D-9) och ingår inte i U30F9.

## 6. Relaterat

- `U30F3-REPORT.md` (tillägg U30F8/U30F9) i `demo-runtime/u30/` – fynd G6-2, G8-9, G8-13 och default-deny-kärnan.
- Inventeringstestets felmeddelande `pinMismatch(...)` upprepar steg 1–4 med filens namn och det nya hashvärdet.
