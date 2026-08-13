# P4A-LU — läsning av de tre återstående spatialkontrakten (A–F)

> ```
> Document class:    RECONCILIATION UNDERLAG (komplettering till P4A-reconciliationen)
> Program parent:    P4A / P4A-LU
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Status:            DRAFT — read-only. Ingen kod skriven.
> Scope:             besvarar exakt fråga A–F. Ingen ny roadmap.
> ```

Lästa dokument: `TV-S1-Spatial-Verification-Layer.md` (**FRYST, ACTIVE Final**),
`TV-4.3-Spatial-Processing-Compatibility.md` (**FRYST**),
`ADR-29-TV4-Spatial-Foundation.md` (**Frozen 2026-08-08**).

---

## ⛔ Kort svar först: `P4A-LU` kan INTE frysas som planerat

Läsningen ändrar bilden materiellt. Den provider som P4A-reconciliationen rekommenderade som
"strikt bättre" **bryter mot en fryst invariant vid namn**, och identitetshashen som båda
providers delar **utelämnar ett fält som TV-S1 uttryckligen placerar i identitetsdomänen**.

Fem konkreta avvikelser, alla verifierade i kod mot fryst text:

| # | Avvikelse | Fryst krav | Faktisk kod |
|---|---|---|---|
| **S1** | Wildcard-version i engine fingerprint | **SV-I03:** *"A wildcard such as `\"3.x\"` is not a version and SHALL be rejected."* Även TV-4.3 §10 förbjuder det. | `spatial-provider-postgis/src/SpatialProviderPostGIS.ts`: `engine_fingerprint: { postgis: "3.x", srid: ... }` — **bokstavligen den förbjudna strängen** |
| **S2** | `engine_fingerprint` ligger utanför identitetsdomänen | **TV-S1 §5.1:** `engine_fingerprint` är listad som *identity input*. **SV-I03** kräver exakt och komplett fingerprint i hashdomänen. | `SpatialEvidenceIdentity.ts:buildSpatialEvidenceIdentityPayload()` tar med `operation.algorithm` och `operation.engine` — **men inte `engine_fingerprint`**. Fingerprintet påverkar alltså inte identiteten alls. |
| **S3** | Ofullständig geometry stack | **SV-I03:** fingerprintet ska täcka *hela* stacken (GEOS, PROJ, GDAL), inte bara frontend. **TV-4.3 §9** ger den verifierade baseline: PostGIS 3.4.3, GEOS 3.9.0, PROJ 7.2.1, GDAL 3.2.2. | Koden har bara `postgis` + `srid`. GEOS/PROJ/GDAL saknas helt. |
| **S4** | Lager refereras med namn/etikett, inte `version_hash` | **TV-S1 §4:** *"Every input layer is referenced by `version_hash`, never by layer name alone."* **TV-4.3 §5:** *"A human-assigned label such as `water_risk_v1` or `\"1.0\"` SHALL NOT be the model identity."* **TV-4.3 §6** kräver `source_artifact_hash` i `spatial_layer_registry`. | Identitetspayloaden binder `layer_ref.layer_id` + `layer_ref.layer_version`; testfixturen använder `layer_version: "v1"` — en etikett, inte en hash. |
| **S5** | `sv-canonical-1` är namngiven men inte implementerad | **SV-I07** kräver fixerad CRS, axelordning, koordinatprecision (avrundning före serialisering), ringorientering, vertexordning, och avrundade `measurements`. **TV-S1 §12 DoD:** *"`sv-canonical-1` serialization rules specified in code — ❌ implementation phase."* | `SPATIAL_CANONICAL_VERSION = "sv-canonical-1"` sätts som hash-prefix, men geometrin hashas som råa `coordinates` utan synlig avrundning eller normalisering. **Konstanten hävdar en kanonisk form som inte finns.** |

S5 är den allvarligaste i förlängningen: den gör att identiteten *ser* versionerad ut medan
flyttalsbrus kan ändra hashen — precis det SV-I07 finns för att förhindra.

---

## A. Tillför något dokument ytterligare bindande krav till P4A-LU-01..05?

**Ja — fyra tillkommande krav.**

- **SV-I03 / SPC-R09** — geometry stack är identitetsinput och **ska pinnas innan första
  `SpatialEvidenceArtifact` produceras**: *"upgrading afterwards changes every subsequent
  identity and turns comparison into a migration problem."* Detta är ett **tidskritiskt** krav:
  det blir dyrare för varje evidens som produceras.
- **SV-I07** — kanonisk geometriserialisering måste faktiskt implementeras innan hashen kan
  hävdas vara identitet.
- **TV-S1 §4** — lager per `version_hash`.
- **SPC-R08** — kapabiliteter namnges per operation (`spatial.buffer`), aldrig per vendor.

## B. Motsäger något dokument valet av `spatial-provider-postgis` som enda LU runtime-provider?

**Nej — valet är korrekt och uttryckligen sanktionerat.** TV-S1 §9: *"PostGIS-native execution
is a first-class provider, not a fallback: for vector predicates and joins it is already the
sanctioned operational spatial engine under TV-3.0."*

**Men:** TV-S1 §5.2 tillför en viktig nyans som P4A-reconciliationen inte hade — *"substituting
an engine produces a new evidence identity, not an equal one"*. Providerbyte är alltså inte en
neutral refaktorering: **all evidens producerad med den gamla providern får en annan identitet
än samma analys via den nya.** Cross-engine-överensstämmelse är en *verification claim*, aldrig
en *identity claim*. Det påverkar hur migreringen får beskrivas.

## C. Definierar TV-S1 ytterligare identity inputs än dem `buildSpatialEvidenceContentHash` använder?

**Ja.** Se S2, S4, S5 ovan. Konkret saknas i identitetspayloaden:

- `engine_fingerprint` (hela stacken) — **SV-I03**
- lager-`version_hash` i stället för `layer_version`-etikett — **TV-S1 §4**
- avrundade `measurements` och kanoniskt normaliserad geometri — **SV-I07**

Din punkt om **effective** buffertavstånd bekräftas som befogad: identitetspayloaden tar
`parameters: payload.query_context.parameters`, dvs. **frågans parametrar**. Om budgetpolicyn i
`spatial-provider-postgis` klipper avståndet är det oklart om det klippta eller det begärda
värdet hamnar i hashen. Jag har **inte** verifierat vilket — men TV-S1 §8:s replay-krav
(*"same input + same algorithm + same version = same spatial evidence"*) kan bara hållas om det
**exekverade** värdet binds. Detta bör vara ett explicit krav i `P4A-LU-02`.

## D. Definierar TV-4.3 en annan ansvarsfördelning än reconciliationen antog?

**Delvis ja — den är mer detaljerad, men inte motsägande.** Två tillägg:

- **SPC-R06:** `spatial_layer_registry` är *"a governance projection ... rebuildable from CAS"*
  — den *"records which artifact a layer projects, never the layer's authority itself."*
  `SPATIAL_LAYER_REGISTRY` (som `gis.routes.ts` importerar) är alltså korrekt placerad som
  projektion, inte auktoritet.
- **SPC-R07:** en **read-only-roll** ska finnas för GIS-klienter, med privilegier satta *innan*
  tabellerna skapas — annars bryts SV-I05 i praktiken *"regardless of what the documents say"*.
  Ej verifierat (kräver DB-åtkomst, `riskguard`-blockeraren). Tillhör P4B/HC-S1.

## E. Kräver ADR-29 en capability registry/factory som gör direkt konstruktion felaktig?

**Ja — och kravet kommer från två håll.**

- **TV-S1 §9:** *"The runtime sees spatial analysis as a capability, not as a vendor."*
  Kedjan är `Capability Definition → Spatial Verification Capability → Engine Provider →
  Execution Session → Artifact Output`.
- **TV-4.3 §8 + SPC-R08:** capability registry med engine-neutrala namn (`spatial.buffer`),
  *"Core SHALL carry no GIS-vendor-specific dependency."*

Direkt konstruktion av `new SpatialProviderPostGIS(connectionString, casRepo)` i produktionskod
vore alltså **fel bindningsform**, även om klassen i sig är rätt provider. Runtime ska lösa
`spatial.*`-kapabiliteten och få en provider — inte instansiera en vendor. Detta ändrar
`P4A-LU-01` från "en provider" till "en provider **upplöst via capability-registret**".

ADR-29 tillför dessutom **Gate B**, som är direkt relevant: *"Must be fulfilled before QGIS
integration begins. Requires: Proven mapping of `query → spatial result → evidence`. Must
demonstrate: PostGIS ≠ authority."* Gate B är i praktiken samma sak som `P4A-LU-05`
(exekverat runtime-bevis) — men uttryckt som ett redan fryst krav.

## F. Kan `P4A-LU → P3` frysas utan bred P4A?

**Ja till avgränsningen — nej till frysning just nu.**

Avgränsningen håller: nationell täckning, raster, QGIS-integration, 3D och
`spatial_layer_registry`-population tillhör P4B/HC-S1 och behöver inte blockera HM-1.

Men gaten kan inte frysas i sin nuvarande formulering, eftersom S1–S5 visar att de frysta
spatialkontrakten redan ställer krav som koden inte uppfyller. En gate som fryses utan dem
skulle certifiera en identitetsmodell som TV-S1 uttryckligen förbjuder.

### Föreslagen reviderad `P4A-LU` (sex gates, inte fem)

```
P4A-LU-01 — Single capability-resolved runtime provider
  The active LU runtime path SHALL resolve spatial queries through exactly one
  production ISpatialProvider, obtained via the engine-neutral capability registry
  (spatial.*), never by direct vendor construction.   [TV-S1 §9, TV-4.3 §8/SPC-R08]

P4A-LU-02 — Canonical query/evidence semantics
  Evidence identity SHALL bind every semantic input capable of changing the spatial
  result, including the EFFECTIVE (post-budget) parameters actually executed, the
  complete engine fingerprint (PostGIS, GEOS, PROJ, GDAL — exact versions, no
  wildcards), and input layers by version_hash rather than label.
                                                      [SV-I03, TV-S1 §4, TV-4.3 §5/§9]

P4A-LU-03 — No alternate LU spatial path
  No LU production path may bypass the canonical provider by querying PostGIS/Prisma
  directly for evidence-bearing spatial facts. Enforced by a static architecture test,
  not only by removing the barrel export.

P4A-LU-04 — Replay isolation
  LU replay SHALL resolve captured canonical evidence and SHALL NOT re-query PostGIS.
                                                      [TV-S1 §8, ADR-24-23]

P4A-LU-05 — Executed runtime proof
  The above SHALL be demonstrated from the real application/runtime entrypoint, not
  only package-scoped tests.                          [= ADR-29 Gate B]

P4A-LU-06 — Canonical geometry form implemented   (NY)
  sv-canonical-1 SHALL be implemented in code before its constant is used as a hash
  prefix: fixed CRS and axis order, fixed decimal grid with rounding before
  serialization, normalized ring orientation and vertex order, explicit empty/null
  encoding, rounded measurements.                     [SV-I07; TV-S1 DoD marks this ❌]
```

### Tidskritiskt: SPC-R09

*"Any planned image upgrade SHALL happen **before** the first `SpatialEvidenceArtifact` is
produced."* Den verifierade baselinen finns redan (TV-4.3 §9: PostGIS 3.4.3 / GEOS 3.9.0 /
PROJ 7.2.1 / GDAL 3.2.2). **Beslut om stack-pinning bör fattas före P2/P3-implementation**, inte
efter — annars blir varje producerad evidens en framtida migreringspost.

---

## Vad denna läsning INTE gjorde

Ingen kod ändrad, inget kontrakt fryst, ingen authority-post skapad, ingen ny roadmap. Ej
verifierat (kräver DB-åtkomst): SPC-R07 read-only-roll, faktiska `layer_id`-populationer, samt
om budgetklippt eller begärt avstånd hamnar i hashen — det sista bör verifieras i kod före
frysning av `P4A-LU-02`.
