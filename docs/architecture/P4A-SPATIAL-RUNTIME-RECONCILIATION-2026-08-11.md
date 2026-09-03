# P4A — Spatial runtime convergence (read-only reconciliation)

> ```
> Document class:    RECONCILIATION UNDERLAG
> Program parent:    P4A
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Status:            DRAFT — read-only. Ingen kod skriven, inget kontrakt fryst.
> Purpose:           avgöra om hela eller bara delar av P4A blockerar P3 (LU PROVEN).
> ```

Besvarar de tio punkterna i beställningen. Där något inte kunnat verifieras står det uttryckligen.

---

## Svar på huvudfrågan först

**Hela P4A behöver sannolikt INTE blockera P3.** Det finns en tydlig, avgränsbar `P4A-LU`-gate.
Motiveringen är att den ena av de två providerna är **helt oanvänd i produktion** — inte ett
konkurrerande live-spår utan en dubblett som aldrig kopplades in. Bevis nedan (punkt 2–3).

Men det finns ett fynd som ändrar riskbilden åt andra hållet, se punkt 7.

---

## 1. Normative authority — vilka frysta ADR:er styr spatial runtime?

| Dokument | Status | Styr |
|---|---|---|
| `ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md` | **ACCEPTED / SEQUENCE FROZEN** | *"Cesium is a pure visualizer of verified evidence, rather than an independent GIS query engine."* GEO_Master_Archive → PostGIS Master → presentation. |
| `TV-4.0-Spatial-Foundation-Roadmap.md` (formerly `ADR-29-TV4-Spatial-Foundation.md`) | ej läst i detalj | Spatial foundation |
| `ADR-POSTGIS-REBUILD-DATA-CONTRACT.md` | Accepted | *"PostGIS är en **rebuildable projection** av GEO_Master_Archive"* — PostGIS är alltså **inte** sanning. |
| `ADR-POSTGIS-ADMIT-V1.md` | Accepted | *"No source enters the new PostGIS merely because it exists under GEO_Master_Archive."* |
| `ADR-28` §2 | Frozen | `SpatialQueryContract`: UI → SpatialQueryRequest → Spatial Engine → Provider → `SpatialEvidenceArtifact[]`. *"LU är databasmotor-agnostiskt från dag ett."* |
| `mimers-brunn-v3.0.0.md` | ACTIVE | Tier 5: *"SGU jordart → Geodata → PostGIS → spatial retrieval"* |

**Slutsats punkt 1:** auktoriteten är redan fryst och sammanhängande. PostGIS är en
återuppbyggbar projektion, inte sanning; providern är utbytbar per ADR-28 §2; presentation är
inte bevis. **Ingen ny normativ text behövs för P4A.**

## 2. Runtime reachability — vilken provider används faktiskt från LU-pathen?

**Ingendera.** Verifierat via grep över hela repot:

- `packages/mps-lu/src/providers/PostgisSpatialProvider.ts` — refereras endast av `mps-lu/src/index.ts` (barrel), sina egna tester och `LuEnforcementReplay.test.ts`.
- `packages/spatial-provider-postgis/src/SpatialProviderPostGIS.ts` — refereras endast av sitt eget paket och sina egna fyra testfiler.
- **Noll referenser från `server/` till någondera klassen.**

Den enda spatiala produktionsvägen som faktiskt finns i `server/` är
`server/routes/gis.routes.ts`, som importerar **`SPATIAL_LAYER_REGISTRY`** (en konstant) från
`packages/spatial-provider-postgis/src/SpatialLayerRegistry` — inte providern. Rutten arbetar
i övrigt mot `prisma`, `NATIONAL_ENVIRONMENTAL_LAYERS` och `GeoPresentationAdapter`.

**Detta är samma mönster som LU-spåret i stort:** en genomtänkt arkitektur som aldrig kopplades
in på den exekverande vägen.

## 3. Provider overlap — vilka exports/imports leder till den äldre providern?

Två fullständiga implementationer av samma `ISpatialProvider`-kontrakt:

| | `mps-lu/src/providers/PostgisSpatialProvider.ts` | `spatial-provider-postgis/src/SpatialProviderPostGIS.ts` |
|---|---|---|
| Lagermappning | **Hårdkodad** `LAYER_TABLE_MAP` (`water`→`env.sgu_well_actual`, `ebh`→…, `protected_area`→…) | `resolveLayerBinding()` via `SpatialLayerRegistry` |
| Sökavstånd | **Hårdkodad** `SEARCH_DISTANCE_METERS = 500` | Budget-styrd, `DEFAULT_SPATIAL_QUERY_BUDGET`, *"Fail-closed on budget"* |
| DB-koppling | Injicerad `PostgisQueryFunction` (rå SQL) | Egen `pg.Pool` |
| SRID | 3006 | 3006 |
| Identitetshash | `buildSpatialEvidenceContentHash` | `buildSpatialEvidenceContentHash` (**samma funktion**, importerad från `mps-lu`) |
| Algoritm-fingerprint | `OPERATION` lokalt | `spatial.dwithin_existence`, `postgis: "3.x"` |

Den nyare (`spatial-provider-postgis`) är strikt bättre: registerbaserad lagermappning,
budgettak, fail-closed. Den äldre (`mps-lu`-lokala) har hårdkodade tabellnamn och avstånd.

**Överlappet är rent** — ingen tredje väg hittad, och båda producerar `SpatialEvidenceArtifact`
via samma hashfunktion. Det gör konvergensen billig.

## 4. Data authority — canonical read-model inputs

Delvis besvarad. `SPATIAL_LAYER_REGISTRY` är den enda strukturen som *både* produktionsrutten
och den nyare providern delar, vilket gör den till den de facto kanoniska lagerdefinitionen.
Den äldre providerns `LAYER_TABLE_MAP` är en konkurrerande, hårdkodad variant av samma sak.

**Ej verifierat:** vilka `layer_id`/versioner som faktiskt är befolkade i PostGIS, och om
`ADR-POSTGIS-ADMIT-V1`s admit-krav efterlevs för dem. Det kräver DB-åtkomst
(`riskguard`-blockeraren) och tillhör P4B/HC-S1, inte P4A-LU-gaten.

## 5. Evidence semantics — identiska mellan vägarna?

**Artifact-identitet: ja** — båda anropar `buildSpatialEvidenceContentHash`.
**Dataset version, algorithm, geometry: nej, inte bevisat identiska.** Fingerprint-strukturerna
skiljer sig (den nyare har `postgis: "3.x"` + `srid` i fingerprint), och buffertavståndet är
hårdkodat 500 m i den äldre men budgetstyrt i den nyare. **Två vägar som ger samma
identitetshash men olika faktiskt sökavstånd vore ett allvarligt bevisproblem** — det är dock
hypotetiskt så länge ingendera är inkopplad.

## 6. Failure semantics

- Nyare: uttryckligen **fail-closed on budget** (dokumenterat i klasskommentaren).
- Äldre: ingen budget, alltså inget fail-closed-läge på query-nivå.
- Produktionsrutten `gis.routes.ts` har en `featureCollectionFallback(warning)` — dvs. den
  returnerar en tom FeatureCollection med varning vid problem. **Det är fail-open i
  presentationslagret.** Acceptabelt för presentation, men får aldrig bli bevisväg.

## 7. Presentation boundary — ⚠️ det viktigaste fyndet

`ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT` (FROZEN) säger att presentationsklienter ska vara
*rena visualiserare av verifierat bevis*, inte egna GIS-frågemotorer. Men den enda inkopplade
spatiala vägen — `gis.routes.ts` — går direkt mot `prisma` och en presentationsadapter, **utan
att passera någon `ISpatialProvider` och utan att producera `SpatialEvidenceArtifact`**.

Det innebär att den nuvarande produktionsvägen levererar spatial data till frontend **utanför
bevisvägen**. Det är strukturellt samma klass av avvikelse som A1 (LU:s CAS-bypass), fast i
läsriktningen i stället för skrivriktningen: inte en förfalskning av auktoritet, men en
presentation som inte kan visa att den bygger på verifierat bevis.

**Detta bör klassas som en egen post i authority-mappen.** Jag har inte lagt in den — det är
Codex lane och kräver ditt beslut.

## 8. Replay boundary

`ADR-24-23` (fryst) kräver replay från canonical audit chain. `ViewerKernel.ts` (LU) gör redan
rätt: `cas.resolve()`, aldrig en ny PostGIS-fråga. **Men** `gis.routes.ts` frågar databasen
direkt. Så länge den vägen inte är en bevisväg är det inte ett replay-brott — men gränsen är
inte kodifierad någonstans.

## 9. Required migration

1. Välj `spatial-provider-postgis` som enda provider (den är strikt bättre).
2. Markera `mps-lu/src/providers/PostgisSpatialProvider.ts` som legacy/sidetrack och ta bort den
   ur `mps-lu/src/index.ts`s barrel-export, så den inte kan nås av misstag.
3. Harmonisera `SEARCH_DISTANCE_METERS`/budget så att två vägar inte kan ge samma identitetshash
   med olika sökavstånd.
4. Kodifiera presentationsgränsen (punkt 7) — `gis.routes.ts` är presentation, inte bevis.

Punkt 4 är **inte** ett LU-blockerande arbete.

## 10. P3 dependency — vad måste vara klart före LU PROVEN?

**Föreslagen `P4A-LU`-gate (minimal, blockerar P3):**

```
✅ one production provider          → välj spatial-provider-postgis, avpublicera den äldre
✅ canonical evidence semantics     → harmonisera budget/sökavstånd; samma hash ⇒ samma query
✅ no alternative LU path           → ta bort äldre provider ur mps-lu barrel
✅ replay does not re-query PostGIS → redan uppfyllt av ViewerKernel; behöver testas, inte byggas
```

**Utanför P4A-LU-gaten (blockerar INTE P3, fortsätter i P4A-brett / P4B):**

- Presentationsgränsen i `gis.routes.ts` (punkt 7) — egen authority-post, eget spår.
- `layer_id`/versioner och ADMIT-V1-efterlevnad (punkt 4) — kräver DB, tillhör P4B/HC-S1.
- Bred spatial runtime-sanering.

**Rekommendation:** frys kanten `P4A → P3` som **`P4A-LU` endast**, inte hela P4A.

---

## Vad denna reconciliation INTE gjorde

Ingen kod ändrad, ingen authority-post skapad, inget kontrakt fryst. `TV-4.0-Spatial-
Foundation-Roadmap.md` (formerly `ADR-29-TV4-Spatial-Foundation.md`), `TV-4.3` och `TV-S1` lästes inte i detalj — de bör läsas innan `P4A-LU`-gaten
fryses formellt, eftersom TV-S1 nämns i den nyare providerns kommentar (*"TV-S1 identity
hashing"*) och kan innehålla ytterligare bindande krav.
