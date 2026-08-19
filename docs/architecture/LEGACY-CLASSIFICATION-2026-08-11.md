# Legacy/Active-klassning — 2026-08-11

Status: **DRAFT — read-only investigation, väntar på frysning.** Ingen kod ändrad.

Beställt av: prioritet #1 efter MPS Legal Corpus Import Gate PROVEN v1 ("Separera aktiv
arkitektur från legacy/prototyp... Först behövs en formell klassning: ACTIVE, LEGACY,
QUARANTINED, RETIRED").

## Metod

Klassningen bygger på faktisk importgraf, inte namn eller mapstruktur:

- **ACTIVE** — importeras av `server/` (route eller entrypoint) eller av ett npm-`script` som
  faktiskt körs i CI/produktion, ELLER är den bevisade (PROVEN) auktoriteten för sin domän.
- **LEGACY** — har en verklig konsument (server, script, eller ett annat aktivt paket) men
  uppvisar konkreta trasiga kontrakt (residualer, brutna importer, drift mellan test och
  implementation). Måste antingen repareras till aktivt spår eller sättas i quarantine —
  inte lämnas i limbo.
- **QUARANTINED** — noll konsumenter utanför det egna paketet, men täcks fortfarande av
  `vitest.config.ts`s `compliance`-projekt och belastar därmed full-svitens proof-baseline
  trots att ingen produktionskod är beroende av det.
- **RETIRED** — noll konsumenter någonstans, och inte ens täckt av någon vitest-`project`
  (dess ev. tester körs aldrig). Kandidat för formell radering, inte bara omklassning.

Varje rad nedan har en konkret bevisrad (grep/import) — inget är en gissning.

## Domän: Promotion / Approval / Quarantine release

| Paket | Klass | Bevis |
|---|---|---|
| `mimers-brunn-core` (`QuarantinePromoter`, `ArtifactAttestation`) | **ACTIVE** | Enda promotion/attestation-mekanismen som faktiskt körs — wired in i `server/routes/governance.routes.ts` (Level 2-arbetet, PR 2 PROVEN). Noll externa deps (`package.json` `dependencies: {}`). |
| `mps-governance-runtime` (`GovernanceRuntime`) | **ACTIVE** | Importeras direkt (relativ path) i `governance.routes.ts` rad 4. |
| `mps-data-governance` (`ImportGate`) | **ACTIVE** | Konsumeras av sex `scripts/import/*.ts`-filer (`reconcile-quarantine.ts`, `run-document-ingest-batch.ts`, `run-document-ingest-recovery.ts`, `seed-single-master-document.ts`, `seed-single-pdf-document.ts`, `verify-cold-start-replay.ts`). Inte kopplad till någon HTTP-route, men en verklig, körbar operatörsväg — inte orphaned. **Notera:** ingen av dessa scripts är registrerad i root `package.json`s `scripts`-block, så de körs bara manuellt (`tsx scripts/import/...`), aldrig automatiskt i CI. |
| `mps-promotion` (`contracts/engine/resolver/validation`) | **RETIRED (kandidat)** | Noll konsumenter — inte server, inte scripts, inte ens `mimers-brunn-core` eller `mps-data-governance`. Inga testfiler alls. En parallell, oanvänd promotion-modell bredvid den faktiska (`QuarantinePromoter`). |
| `mps-governance` (`actors/artifacts/capabilities/engine/explorer/registry/release/replay/resolver/retention/signatures/state`) | **RETIRED (kandidat)** | Noll konsumenter någonstans. Har ETT testfilnamn (`ADR23Compliance.test.ts`) men det matchar ingen `include`-glob i någon vitest-`project` (`unit`, `component`, `integration`, `compliance`) — testet körs alltså aldrig, någonsin. Ett helt, arkitektoniskt ambitiöst governance-system som varken exekveras eller bevisas. Högst prioriterad radering/arkivering-kandidat. |
| `mps-decision-governance` | **QUARANTINED** | Noll konsumenter i `server`/`scripts`/andra paket. Testerna körs dock via `compliance`-projektets `test.include` (`packages/mps-decision-governance/**/*.test.ts`) — bidrar alltså till de 16 filer/17 tester som föll i den bredare svitkörningen, för kod ingen produktionsväg beror på. |
| `mps-retrieval-governance` | **QUARANTINED** | Samma mönster: noll konsumenter, men täckt av `compliance`-projektets `test.include` — belastar proof-baseline utan produktionsberoende. |

## Domän: CAS write

| Paket | Klass | Bevis |
|---|---|---|
| `mimers-brunn-core/src/cas` | **ACTIVE** | Egen, självständig CAS/WORM-implementation (ADR-042), noll externa deps, konsumeras via `governance.routes.ts` och (nu) `mps-legal-corpus`. |
| `mps-artifact-store` | **ACTIVE** | Faktisk beroendekedja: `mps-data-governance`, `mps-replay` och `mps-runtime` listar den som dependency i respektive `package.json`. `mps-runtime` i sin tur importeras direkt av `server/index.ts` (`createKernelArtifactRepository`) — så kedjan är verklig, inte bara test-intern. |
| `mps-cas-boundary` | **QUARANTINED** | Noll paket listar den som dependency någonstans (kontrollerat mot samtliga `packages/*/package.json`), noll server-referens. En egen, parallell CAS-gräns-implementation bredvid `mimers-brunn-core/src/cas`. Dess tre testfiler (`CASContractFreeze`, `CASPhysicalBoundary`, `DiskCASRepository`) körs ändå i `compliance`-projektet och är sannolika bidragsgivare till de rapporterade CAS-boundary/governed-write-felen — dvs. döda kontrakt som ändå kostar proof-budget. |

## Domän: Legal corpus import

| Paket | Klass | Bevis |
|---|---|---|
| `mps-legal-corpus` (`CorpusImportGate`) | **ACTIVE, PROVEN v1** | Windows-bevisad 2026-08-11 (18/18 isolerat + paket-scopat, kollateralt bekräftat via stash-test). Se TOR_INSTRUKTION-filens PROVEN-avsnitt. |

## Domän: LU (viewer/replay/execution) — OMKLASSAT 2026-08-11 efter ägarbeslut

**Ägarbeslut:** LU ska INTE avvecklas eller quarantinas. Ny klass: **ACTIVE MVP, not authority
owner — under sanering.** LU är produktspåret; Mimers Brunn äger sanningen (attestation,
CAS-promotion, approval). Nedan är uppdaterat efter att faktiskt läsa koden bakom
originalklassningens antaganden — några håller, en är preciserad.

| Modul | Klass | Bevis |
|---|---|---|
| `mps-lu` (helhet) | **ACTIVE MVP, not authority owner** | Importeras inte av `server/` direkt, men konsumeras av arkitektur-audit/benchmark-tooling (`scripts/audit/final-freeze-audit.test.ts`, `master-boundary-audit.test.ts`, `scripts/benchmark/{adversarial-retrieval-test,legal-golden-set,rag-evidence-gate}.ts`). Produktvärdet (spatial+dokumentär bedömning, CAS-artifact, replaybar bedömning, viewer/QGIS-export) är reellt — det som ska bort är inte LU utan sidospåren nedan. |
| `ViewerKernel.ts` (`src/viewer/`) | **ACTIVE — arkitektoniskt korrekt, inget sidospår** | Läst i sin helhet. Read-only mot CAS (`cas.resolve`, aldrig `put`), kräver en extern `ViewerCapabilityArtifact` (typ importerad från `mps-compliance`, inte lokalt uppfunnen) med `release_hash` + `viewer_identity_ref` innan export, taggar varje feature `governance_status: "VERIFIED_OBSERVATION"`. Ingen egen approval-modell här — det här är INTE Gemini-kladd, det är rätt byggt. Öppen fråga (ej undersökt ännu): var utfärdas/attesteras `ViewerCapabilityArtifact` självt? |
| `src/loke/QuarantinePromoter.ts` (klass `DocumentEvidenceMaterializer`, `@deprecated`-aliaserad som `QuarantinePromoter`) | **SIDOSPÅR — konkret governed-write-bypass, prioritet 1 att kapa** | Egen kommentar i filen erkänner uttryckligen: "This is not the platform governance promotion authority... owned by mimers-brunn-core QuarantinePromoter and requires a signed ArtifactAttestation". Trots det gör `promote()`-metoden `this.cas.put(...)` DIREKT, utan attestation-verifiering — bara en råhash-koll mot quarantine-payloaden. Namnkollisionen (`QuarantinePromoter` som deprecated alias, samma namn som den riktiga attesterade klassen i `mimers-brunn-core`) är i sig en risk: fel klass kan importeras av misstag. Detta är den konkreta "governed write capability"-bristen — inte viewer-lagret. |
| `mps-governance` (standalone paket) | **Sannolikt inte LU:s eget kladd — separat spår** | `mps-lu/tests/ArchitectureBoundary.test.ts` listar `mps-governance` som del av "Frozen Core" som INTE får bero av LU (envägsregel, inte ett LU-beroende). `mps-governance` självt har dock noll konsumenter någonstans (se ovan) — sannolikt ett stalled/övergivet försök till vad som blev `mimers-brunn-core`, inte något LU byggde in. Kvarstår som RETIRED-kandidat, men oberoende av LU-saneringen. |
| Åtta sköra relativa importer `../../../mps-runtime/src/...` (`LuExecutionKernelClient.ts`, `LokeIngestor.ts`) | **SIDOSPÅR — teknisk skuld, inte authority-fråga** | Bekräftat i kod. Fungerar bara om katalogdjup aldrig ändras, ingen alias-upplösning. Bör bytas mot `@miljobeslut/mps-runtime`-aliaset som redan finns i `tsconfig.json`/`vitest.config.ts`. |
| Kvarglömd `f;` | **SIDOSPÅR — kosmetisk** | Bekräftat, `LUMagicMoment.test.ts:156`. |
| `viewer_identity_ref` saknas / replay `undefined` artifact id / findings `1` vs väntat `2` | **Rapporterat av dig från faktisk testkörning — inte ännu självständigt bekräftat av mig** | `viewer_identity_ref`-kravet finns och kastar korrekt fel i `ViewerKernel.ts` (se ovan) — så om detta trigger:as i testkörning är frågan var uppströms i pipelinen fältet inte sätts, inte att kontraktet i sig saknas. De två andra (replay-`undefined`, findings-count-drift) har jag inte spårat till källkod än. |
| `mps-runtime` | **ACTIVE** | Importeras direkt av `server/index.ts`. LU:s koppling till den (om än via sköra relativa paths) pekar mot en verkligen levande modul — det är LU-sidans koppling som är skör, inte målet. |

### MVP-scope (ditt förslag, ej ännu format som frysbar kontraktstext)

Inkommen besluts-/plan-/geodata → evidensmaterialisering → spatial + dokumentär bedömning →
CAS-lagrad artifact (via mimers-brunn-core, INTE via `DocumentEvidenceMaterializer`s direkta
`cas.put`) → replaybar bedömning → enkel viewer/QGIS-export (redan korrekt byggd i
`ViewerKernel`). Detta är en ram, inte en fryst spec — nästa steg om du vill gå vidare hade
varit att formalisera den till samma typ av schema-convergence-spec som redan använts två
gånger i det här projektet.

## Domän: Governed writes (direkta skrivningar utanför porten)

| Fynd | Klass | Bevis |
|---|---|---|
| `scripts/import/generate-embeddings.ts` | **LEGACY / AUDIT-BRÄNNPUNKT** | `prisma.$executeRawUnsafe('UPDATE "DocumentChunk" SET "embedding" = ...')` rakt mot databasen. Inget CAS/ImportGate/attestation i vägen — en authority-bearing write som helt kringgår governance-porten. Detta är sannolikt (åtminstone en av) källorna till "governed write capability"-felen i compliance-sviten. |

## Sammanfattning (endast det som undersökts — inte alla 43 paket i repot)

- **ACTIVE:** `mimers-brunn-core`, `mps-governance-runtime`, `mps-canonical`, `mps-data-governance`, `mps-legal-corpus` (PROVEN v1), `mps-artifact-store`, `mps-runtime`.
- **ACTIVE MVP, not authority owner — under sanering:** `mps-lu` (inkl. `ViewerKernel.ts`, som redan är korrekt byggd och INTE ska röras). Konkret sidospår att kapa: `src/loke/QuarantinePromoter.ts` (`DocumentEvidenceMaterializer`s direkta `cas.put`-bypass + den vilseledande `@deprecated QuarantinePromoter`-aliasen).
- **LEGACY (kräv beslut: reparera eller quarantine):** `scripts/import/generate-embeddings.ts`.
- **QUARANTINED (döda för produktion, men kostar proof-budget i compliance-sviten):** `mps-cas-boundary`, `mps-decision-governance`, `mps-retrieval-governance`.
- **RETIRED-kandidater (döda överallt, körs inte ens i test):** `mps-promotion`, `mps-governance` (standalone) — sannolikt inte LU:s eget kladd, se LU-avsnittet.

**Inte klassat än** (utanför denna runda, men relevant för nästa varv): `mps-compliance`,
`mps-materialization`, `mps-diagnostics`, `mps-query-budget`, `mps-retrieval-trace`,
`mps-runtime-snapshot`, `spatial-provider-postgis`, samt resten av de ~30 återstående paketen
som inte rör authority/CAS/promotion/LU direkt.

## Rekommenderad effekt på full-svitkravet

Om klassningen fryses ungefär så här skulle `compliance`-projektets `test.include` kunna delas
i två separata körningar: en **proof-bärande** (endast ACTIVE + LEGACY-under-reparation) som
måste vara grön för PROVEN-status, och en **arkiverad/quarantined** körning som får rödas utan
att blockera arkitekturbevis. Det är den konkreta mekanismen bakom punkt 1 i din prioritering
("proof-baseline / CI-kontrakt") — men det är ett separat beslut, inte gjort här.

## Öppna beslut (kräver din frysning, inget är genomfört)

1. `mps-promotion` och `mps-governance` (standalone) — radera/arkivera formellt, eller finns
   det en känd anledning att behålla dem (framtida migrering, referensmaterial)?
2. `mps-cas-boundary` — samma fråga: parallell CAS-gräns som `mimers-brunn-core/src/cas`
   redan täcker, eller avsedd att bli den framtida gränsen (i så fall är det snarare
   `mimers-brunn-core/src/cas` som ska migrera dit)?
3. `mps-decision-governance` / `mps-retrieval-governance` — quarantine (exkludera från
   `compliance`-projektets `test.include` tills de antingen kopplas in på riktigt eller
   retireras formellt)?
4. `mps-lu` — omklassat till ACTIVE MVP, not authority owner (ej längre en quarantine-fråga).
   Kvarstående beslut: ska `DocumentEvidenceMaterializer` (a) skriva till en LU-lokal
   staging-CAS istället för permanent CAS, eller (b) routas om att gå via
   `mimers-brunn-core`s attesterade `QuarantinePromoter.promote()` innan permanent write?
   Och: ska den vilseledande `@deprecated QuarantinePromoter`-aliasen tas bort helt (döpas om)
   så namnkollisionen med den riktiga klassen i `mimers-brunn-core` försvinner?
5. `generate-embeddings.ts` — ska den skrivas om att gå via en styrd port (samma mönster som
   `CorpusImportGate`), eller är den avsiktligt ett "trusted operator tool" med lägre krav?
