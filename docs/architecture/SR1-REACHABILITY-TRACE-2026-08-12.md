# SR1 — Runtime reachability trace för source-registry-authorityn

> ```
> Document class:    REACHABILITY TRACE (read-only)
> Program parent:    P1, tredje grinden — runtime authority convergence
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Status:            RED PROOF EXECUTED — SR1 VIOLATED, P1 runtime convergence KNOWN_BROKEN.
> Purpose:           dokumentera reachability och det exekverade röda beviset innan fix.
> ```

Beställt före kod, av ett uttryckligt skäl: *"en guardrail som föds grön har aldrig mätt något"*
gäller ofta — men **inte om den förbjudna vägen redan är död**. Då vore en konstruerad röd
situation bara symmetri med A1, inte bevis.

---

## Svar

**Det hårdkodade registret är INTE nåbart från serverns/applikationens entrypoint — men det ÄR
nåbart för en operatör via CLI, och den vägen är oskyddad.** Det är en annan slutsats än både
"aktiv produktionsbypass" och "död väg".

---

## Spårningen, steg för steg

### 1. HTTP-/applikationsyta

```
grep source-registry|SOURCE_REGISTRY|getSourceDefinition  →  server/
```

Enda träffen i hela `server/` är registerfilen själv
(`server/modules/harvest/source-registry/registry.ts`). Ingen route, ingen service, ingen
`createApp`-koppling importerar den. Sökning på `lokeRuntime|lokeScheduler|harvestPlan|
executeLokeHarvest|import/loke` i `server/` ger **noll träffar**.

→ **Ingen HTTP-yta. Registret kan inte nås av en inloggad användare.**

### 2. npm-registrerade skript

`package.json` registrerar fem harvest-kommandon:

| Script | Fil | Status |
|---|---|---|
| `harvest:sfs` | `harvest-sfs-all.ts` | ⛔ `assertNotQuarantined()` kastar direkt |
| `harvest:regulatory` | `harvest-regulatory-all.ts` | ⛔ samma |
| `harvest:municipal` | `harvest-municipal-abva-all.ts` | ⛔ samma |
| `harvest:court` | `harvest-court-decisions-all.ts` | ⛔ samma |
| `harvest:parallel` | `run-parallel-harvest.ts` | ⛔ samordnar fyra karantänsatta workers |

→ **Alla fem npm-vägar är hårt stoppade.** De kastar innan något registeruppslag sker.

### 3. CI

```
grep harvest|loke  →  .github/workflows/
```

Noll träffar. → **Ingen automatiserad väg.**

### 4. Loke-runtime — här ligger den verkliga vägen

```
scripts/import/loke/lokeScheduler.ts
        │  rad 232:  executeLokeHarvestForSource(source.sourceId, { execute: true })
        ▼
scripts/import/loke/lokeRuntime.ts
        │  rad 22:   import { getSourceDefinition, isUrlAllowedForSource }
        │            from '../../../server/modules/harvest/source-registry/registry'
        │  rad 39, 62, 133
        ▼
server/modules/harvest/source-registry/registry.ts   ← HÅRDKODAD SOURCE_REGISTRY
        │
        ▼
adapter dispatch → fetch() → quarantine write
```

**Avgörande detalj — `lokeScheduler.ts:293-300`:**

```ts
// Självexekveringsblock för CLI-anrop
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  const execute = process.argv.includes('--execute');
  runScheduler({ execute }).catch(...)
}
```

Detta kör **vid import**, inte bara vid explicit anrop. Och till skillnad från de fem
karantänsatta skripten bär **varken `lokeScheduler.ts` eller `lokeRuntime.ts` någon
karantänsmarkering**. Det finns ingen `assertNotQuarantined()`, ingen `⛔`-header, ingen
godkännandekontroll.

→ `tsx scripts/import/loke/lokeScheduler.ts --execute` når det hårdkodade registret och kan
utföra nätverkshämtning mot dess `allowedDomains` — utan att någon governance-approval,
attestation eller `SourceRegistryArtifact` har passerats.

---

## Klassificering

```
parallel_authority_implementation:      EXISTS
http_production_reachability:           NOT_REACHABLE
npm_script_reachability:                BLOCKED (all five quarantined)
ci_reachability:                        NOT_REACHABLE
operator_cli_reachability:              REACHABLE — and unguarded
canonical_registry_runtime_materialization: DOES NOT EXIST
```

**Detta är alltså inte en död väg.** Den saknar bara de skyddsräcken som de fem
harvest-skripten redan fått. Karantänen tycks ha applicerats på de fyra workers som skrevs sist
— och missat den runtime som faktiskt exekverar dem.

---

## Vad detta betyder för tredje P1-grinden

Ett **rött SR1-bevis är befogat**, men det måste formuleras mot rätt väg. Inte mot `registry.ts`
för att filen existerar — utan mot den faktiskt nåbara kedjan:

```
lokeScheduler (CLI, självexekverande, okarantänsatt)
   → executeLokeHarvestForSource
      → getSourceDefinition (hårdkodat register)
         → adapter dispatch
            → fetch()
```

Föreslagen invariant att låsa ett rött bevis mot:

> **SR1 — No harvest execution path SHALL resolve source authority from an implementation that
> is not a verified materialization of a governance-approved SourceRegistryArtifact.**

Mätpunkten bör vara densamma som i A1:s tamper-before-network-mönster: spionera på `fetch`
och bevisa att den anropas **innan** någon attestationsverifiering skett. Det gör beviset
runtime-nåbart och inte bara strukturellt.

### Vad som INTE ska göras

- Ingen konstruerad röd situation mot en död väg. Den här vägen är levande — beviset behövs.
- Ingen karantänsmarkering på `lokeScheduler`/`lokeRuntime` **innan** det röda beviset körts.
  Att stoppa vägen först skulle göra beviset omätbart, exakt som A1:s precondition blev.
- Ingen registry-implementation ännu. Först bevis, sedan konvergens.

---

## Ägarbeslut 2026-08-12 — båda frågorna besvarade JA

**1. Operatör-CLI räknas som produktionsnåbarhet** när CLI:t är en avsedd operativ väg som kan
köras mot verklig miljö/data och inte uttryckligen är test-only, dev-only eller karantänsatt.
P1 handlar om authority convergence, inte serverns importgraf.

**Klassificeringen använder därför två dimensioner, inte en boolesk.** En ensam
`runtime_reachable` hade låtit *"inte importerad av servern"* misstolkas som *"inte
produktionsnåbar"*:

```
server_runtime_reachable:       NOT_PROVEN
operational_runtime_reachable:  true
production_reachability:        PROVEN
reachability_class:             OPERATOR_CLI / SCHEDULED_RUNTIME
```

**2. Självexekveringsblocket är ett eget fynd**, inte en detalj i SR1. Reachability är därmed
inte bara *"en operatör kan starta schedulern"* utan potentiellt *"en produktionsimport kan
oavsiktligt aktivera runtime-beteendet"*. Två olika invarianter — de får inte bakas ihop till
en failure reason.

### Registrerat i `architecture-authority-map.jsonc`

| Finding | Status | Blockerar |
|---|---|---|
| `SOURCE_REGISTRY_PARALLEL_AUTHORITY` | `KNOWN_BROKEN`, `production_reachability: PROVEN` | P1 runtime convergence: **YES**, P1 overall: **YES** |
| `LOKE_SCHEDULER_IMPORT_SIDE_EFFECT` | `KNOWN_BROKEN`, `runtime_reachable: true` | P1 convergence: supporting blocker, HM-P: **YES** |

Båda korslänkade mot `source-registry-runtime` (samma fil, två vinklar: vad projektionen *måste
bli* enligt fryst F0D-kontrakt, respektive vad den *är nu*).

---

## SR1 blir ett tvåfasbevis

```
SR1 RED
→ operativ runtime kan använda legacy registry
→ canonical SourceRegistry/F0D behöver inte användas
→ alternative authority proven reachable

SR1 GREEN
→ operational runtime resolves only canonical SourceRegistry
→ legacy registry cannot act as authority
→ legacy data may remain only as migration input/projection if explicitly classified
```

### Testdesignkrav — måste visa ett authority-RESULTAT

Rödtestet får **inte** bara kontrollera importkedjan. Det måste visa:

```
legacy registry selected/resolved source
canonical SourceRegistry not consulted
operation proceeds far enough to demonstrate authority use
```

Ett test som bara visar `lokeScheduler imports registry.ts` är **reachability-bevis, inte
authority-bypass-bevis**. Föreslagen mätpunkt: spionera på `fetch` och bevisa att den anropas
innan någon attestationsverifiering skett — samma tamper-before-network-mönster som Level 2.

### Vad som INTE får göras före rödbeviset

Ingen karantänsmarkering på `lokeScheduler.ts` eller `lokeRuntime.ts`. Att stoppa vägen först
gör den existerande avvikelsen omätbar — samma fälla som A1:s precondition.

---

## Executed red proof — 2026-08-12

Kommando:

```bash
npx vitest run tests/unit/import/SR1SourceRegistryParallelAuthority.red.test.ts
```

Resultat:

```text
Test Files  1 failed (1)
Tests       1 failed (1)
failure_reason: SR1 VIOLATED
```

Evidence:

```json
{
  "legacy_source_resolved": true,
  "legacy_adapter_selected": "mmd_v1",
  "legacy_allowed_domain_gate_used": true,
  "canonical_source_registry_consulted": false,
  "attestation_verified": false
}
```

Precisionsregel: `canonical_source_registry_consulted: false` betyder att canonical authority inte
var närvarande/konsulterad på den operativa vägen. Testet observerar inte ett negativt anrop mot
en existerande canonical registry-runtime, eftersom en sådan runtime ännu inte finns.

Programklassificering:

```text
SR1 invariant                         VIOLATED
SR1 red proof                         ESTABLISHED_RED_PROOF
parallel authority operational reach  PROVEN
P1 runtime authority convergence      KNOWN_BROKEN
P1 overall                            OPEN
```

Stopregel: ingen karantänmärkning, ingen SourceRegistry-implementation och ingen SR2/scheduler-fix
i samma arbetsenhet som detta röda bevis.

Efterföljande status 2026-08-12: rödtestet är bevarat som historiskt bevis i
`tests/unit/import/SR1SourceRegistryParallelAuthority.red.test.ts.historical`. Den separata
grönarbetsenheten är `tests/unit/import/SR1SourceRegistryAuthorityEnforcement.test.ts`; den
bevisar SR1-enforcement för Loke-vägen utan att ändra det historiska failure-beviset.
