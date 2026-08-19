# F0C — Read-only spårning av F4 / F8 / F9

> ```
> Document class:    DEFECT TRACE (read-only)
> Program parent:    P3 (LU end-to-end maturity)
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Lane:              OPUS
> Status:            DRAFT — ingen kod ändrad, inget kontrakt rört, ingen fix gjord.
> WIP:               1 arbetsenhet (F0C). Stoppunkt efter detta dokument.
> ```

Syfte: göra F4/F8/F9 till **verifierade luckor** i stället för antaganden, så att nästa
implementation drivs av bevis. Ingen fix ingår.

---

## ⚠️ Huvudfynd: det är inte tre oberoende defekter

**F9 är en kaskad av F4, inte ett replay-kontraktsbrott.** F8 är en testfixtur-brist, inte ett
saknat kontrakt. Endast **F4 är en verklig produktdefekt** — och den består i sin tur av två
separata orsaker, varav den ena är att en regel aldrig implementerats.

Det ändrar arbetsordningen materiellt: F4 måste åtgärdas först, och F9 kan mycket väl försvinna
utan egen åtgärd.

---

## F4 — findings blir 1 i stället för 2

| Fält | Värde |
|---|---|
| **file** | `packages/mps-lu/src/execution/LuExecutionKernelClient.ts:36, 92` · `packages/mps-lu/src/rules/LURuleEngine.ts:6` |
| **runtime path** | `runLuAssessmentViaKernel({ evidence, document_evidence })` → `engine.evaluate(input.evidence)` → `AssessmentFinding[]` |
| **expected invariant** | ADR-28 §3: `Evidence → Rules → Findings → Assessment`. *"Varje finding måste ha minst en evidensreferens."* Dokumentbevis är en av ADR-28:s fem artifacts (`DocumentEvidenceArtifact`) och ska kunna generera findings. |
| **actual behavior** | **Två oberoende orsaker, båda måste vara sanna för att ge 1 finding:**<br>**(a)** Kernelvägen droppar dokumentbevis. `LuExecutionKernelClient.ts:36` och `:92` anropar `engine.evaluate(input.evidence)` — endast spatialt bevis. `document_evidence` tas emot som parameter men vidarebefordras aldrig. `LURuleEngine.evaluate()` har dessutom signaturen `evaluate(evidence: SpatialEvidenceArtifact[])` — den kan **inte** ta emot dokumentbevis som typen ser ut.<br>**(b)** Regeln existerar inte. `LU-DOC-BESLUT-001` finns **enbart i testfiler**. Grep över `packages/`, `server/`, `scripts/` exklusive `*.test.ts` ger noll träffar. `LURuleEngine.ts` implementerar endast `LU-WATER-001`. |
| **proof/test** | `packages/mps-lu/tests/LUEndToEnd.test.ts:71-77` · `packages/mps-lu/tests/VerticalProof.test.ts:84` |
| **owner** | OPUS (LU-domänimplementation) |
| **dependency** | Ingen. Kräver ingen authority-, spatial- eller replay-ändring. Ligger helt inom ADR-28 §3. |

**Bedömning:** testet beskriver ett avsett beteende som aldrig byggts. Det är alltså inte en
regression utan en **ofullständig implementation dokumenterad som ett rött test**. Frågan om
`LU-DOC-BESLUT-001`:s regeldefinition (vilka nyckelord, vilken `rule_version`) är ospecificerad
i ADR-28 och behöver ett litet innehållsbeslut innan den kan implementeras.

---

## F8 — `viewer_identity_ref` saknas

| Fält | Värde |
|---|---|
| **file** | `packages/mps-lu/tests/VerticalProof.test.ts:27-32` (fixtur) · `packages/mps-lu/src/viewer/ViewerKernel.ts:24-26` (korrekt kontroll) |
| **runtime path** | `new ViewerKernel(casRepo, mockCapability)` → `exportAsGeoJSON()` → kastar `"ViewerCapabilityArtifact lacks viewer_identity_ref provenance"` |
| **expected invariant** | ADR-23B: *"Admit exactly one `ViewerCapabilityArtifact`"* (VIEW-22-I2, I6). `packages/mps-governance-runtime/src/ViewerCapabilityAdmission.ts:29-30` avvisar redan explicit: `REJECT_CAPABILITY_PROVENANCE: missing viewer_identity_ref`. |
| **actual behavior** | Testet **handkonstruerar** en capability med endast `artifact_id`, `artifact_type` och `release_hash` — `viewer_identity_ref` saknas helt. Ingen admission-funktion anropas: `admitViewerCapability` har **noll anropare** i `packages/mps-lu` eller `server/`. |
| **proof/test** | `VerticalProof.test.ts:27` |
| **owner** | OPUS (LU wiring) — men admission-kontraktet ägs av governance-runtime och får inte redefinieras |
| **dependency** | ADR-23B (fryst). LU ska **konsumera** `admitViewerCapability`, inte bygga en egen capability-konstruktion. |

**Bedömning:** `ViewerKernel` är korrekt — den kastar precis som kontraktet kräver. Felet är att
testfixturen kringgår admission. Detta är samma klass av avvikelse som A1: en governance-gate
finns, men den anropas inte. Skillnaden är att här finns ingen bypass i produktionskod, eftersom
LU:s viewer inte har någon produktionsanropare alls.

---

## F9 — replay får `undefined` artifact id

| Fält | Värde |
|---|---|
| **file** | `packages/mps-lu/tests/VerticalProof.test.ts:19-20, 84-86, 113` |
| **runtime path** | `replayEngine.replay({ artifact_id: assessmentManifestId, ... }, kernelState)` |
| **expected invariant** | ADR-24-23 (fryst): replay kräver `AuditReconstructionProfileArtifact`, `ReconstructedExecutionGraphArtifact`, `ObservedExecutionGraphArtifact`, `ReplayVerificationProfileArtifact`, `ReplayVerificationArtifact`, `ReplayEquivalenceReportArtifact`. |
| **actual behavior** | **Kaskad, inte replay-defekt.** Sekvensen i filen:<br>`:84` `expect(kernelResult.findings).toHaveLength(2)` ← **faller (F4)**<br>`:85` `assessmentManifestId = kernelResult.manifest_id` ← **exekveras aldrig**<br>`:86` `kernelState = kernelResult.state` ← **exekveras aldrig**<br>`:113` `artifact_id: assessmentManifestId` ← **`undefined`**<br><br>Tilldelningen sker i samma `it`-block, **efter** F4-assertionen. När F4 faller avbryts blocket och båda variablerna förblir odefinierade. `runLuAssessmentViaKernel` returnerar bevisligen `manifest_id` (`LuExecutionKernelClient.ts:212`), så värdet finns — det når bara aldrig variabeln. |
| **proof/test** | `VerticalProof.test.ts:113, 118` |
| **owner** | OPUS |
| **dependency** | **F4.** Ingen självständig åtgärd bör planeras förrän F4 är åtgärdad och F9 kan observeras igen. |

**Bedömning:** F9 är i nuvarande form **inte bevis för något replay-kontraktsbrott**. Att
klassificera det som en ADR-24-23-avvikelse vore en överklassificering. Om F9 kvarstår efter att
F4 är åtgärdad måste den spåras om — då mot ADR-24-23:s sex artifacts.

---

## Konsekvenser för arbetsordningen

Den frysta ordningen i LU-planen var `F0C → P4A-LU prerequisites → F4 → F8 → F9`. Spårningen
visar att F9 inte är parallell med F4 utan **härledd** ur den:

```
F4  (verklig produktdefekt, två orsaker)
 ├─ (a) kernel droppar document_evidence
 └─ (b) LU-DOC-BESLUT-001 finns inte
        ↓
F9  (kaskad — kan försvinna utan egen åtgärd)

F8  (fixturbrist, oberoende — LU anropar inte admitViewerCapability)
```

Rekommenderad ordning inom LU-blocket: **F4 → observera om F9 kvarstår → F8**. F8 kan tas
parallellt eftersom den inte delar orsak med de andra.

---

## 🔒 REGISTRERAD KLASSIFICERING (ägarbeslut 2026-08-12)

```
F4  KNOWN_BROKEN / REAL_PRODUCT_DEFECT
    cause A: document_evidence dropped before rule evaluation
    cause B: LU-DOC-BESLUT-001 not implemented

F8  TEST_FIXTURE / WIRING_DEFECT
    ViewerKernel contract behaves correctly
    ViewerCapability admission exists but is bypassed by fixture
    production reachability: NOT PROVEN

F9  DERIVED_FAILURE
    current replay failure is downstream of F4
    NOT evidence of ADR-24-23 violation
    re-observe only after F4 is green
```

**F9 ska tas bort ur listan över självständiga implementation targets.** Annars riskerar man att
"reparera replay" trots att replay aldrig fick giltig input.

---

## Öppna frågor — en besvarad, en kvarstår

### ✅ BESVARAD: dokumentbevis räknas som evidensreferens

ADR-28:s modell är `Evidence → Rules → Findings → Assessment`, och `DocumentEvidenceArtifact` är
uttryckligen ett av de fem evidensartifacten. Det finns därför ingen arkitektonisk grund för att
kräva att `AssessmentFinding` endast refererar spatialt bevis. Invarianten:

```
Every AssessmentFinding SHALL reference
at least one canonical evidence artifact.

Allowed evidence reference classes include:
- SpatialEvidenceArtifact
- DocumentEvidenceArtifact
```

Detta är **inte en ny authority-modell** — det är tillämpning av det redan frysta kontraktet.

**Begränsning:** `AssessmentFinding` får **inte** bära lös dokumenttext som bevis. Referensen ska
gå till artifact identity/reference, aldrig till innehållet.

### ✅ BESLUTAD API-FORM: explicit rule-input, inte en andra arrayparameter

Undvik:

```ts
evaluate(
  spatialEvidence: SpatialEvidenceArtifact[],
  documentEvidence: DocumentEvidenceArtifact[]
)
```

Det fungerar idag men degraderar API:t när nästa evidenstyp tillkommer. Beslutad form:

```ts
interface LURuleEvaluationInput {
  spatial_evidence: readonly SpatialEvidenceArtifact[];
  document_evidence: readonly DocumentEvidenceArtifact[];
}

evaluate(input: LURuleEvaluationInput): AssessmentFinding[]
```

Evidensdomänen blir explicit utan att regelmotorn binds till en provider eller storage. Helt
inom LU-lanen.

### ⬜ KVARSTÅR — owner/domänbeslut: `LU-DOC-BESLUT-001`:s semantik

**Regeln får inte implementeras än.** Att koda `text.includes("risk") || text.includes("avslag")`
utifrån en testkommentar vore domänlogik skapad ur en fixtur — precis den
implementation-by-accident som programmet finns för att eliminera.

Att frysa (litet beslut, ingen roadmap):

```
rule_id:      LU-DOC-BESLUT-001
rule_version: ?
input:        DocumentEvidenceArtifact

predicate:
  exakt vilka dokumentfält undersöks?
  exakt vilka villkor ger match?

finding:
  finding_type / severity / message
  evidence reference semantics
```

**Domänvarning som ska bäras in i predikatbeslutet:** *"Risk"* är sannolikt för brett som
generiskt triggerord för juridiskt material. *"avslag"* kan förekomma i refererade eller
historiska resonemang utan att dokumentet innebär ett relevant avslag för den aktuella
LU-bedömningen. Ett rent nyckelordsvillkor riskerar alltså både falska positiva och
felklassificerad bevisvikt.

**Frågan som måste besvaras först:**

> Vilket juridiskt faktum ska `LU-DOC-BESLUT-001` representera?

Predikat beslutas därefter — inte tvärtom.

---

## Fryst LU-exekveringsordning (ersätter den tidigare F4 → F8 → F9)

```
1. Freeze LU-DOC-BESLUT-001 semantic contract     ← owner, blockerar F4B
        ↓
2. F4A — extend rule input to include DocumentEvidenceArtifact
        ↓
3. F4B — implement LU-DOC-BESLUT-001
        ↓
4. run F4 tests
        ↓
5. re-run / re-observe F9
   ├─ försvinner → stäng som DERIVED_FAILURE
   └─ kvarstår   → NY replay-spårning mot ADR-24-23
        ↓
6. F8 — ersätt handbyggd ViewerCapability-fixtur med admitted capability
        ↓
7. LU E2E continuation
```

F8 kan tekniskt köras parallellt med F4, men med `WIP = 1` finns liten vinst. F4 prioriteras
eftersom den sannolikt eliminerar F9 samtidigt.

**F4A är ogränsad av owner-beslutet** — den utökar bara rule-input och kan påbörjas så snart
LU-grinden släpper. Det är F4B som väntar på semantikfrysningen.

---

## Nettoeffekt av F0C

Två potentiellt stora felsökningar är eliminerade: replay/F9 behöver sannolikt ingen reparation,
och `ViewerKernel`/F8 är inte trasig. Det verkliga LU-arbetet är:

```
document evidence reaches rules
+
one missing document rule
```

Därefter observeras systemet om.

**F0C = COMPLETE. Ingen ytterligare LU-audit ska göras nu.**

---

## Vad F0C INTE gjorde

Ingen kod ändrad. Inget kontrakt rört. Ingen fix påbörjad. Inga tester skrivna. Inga andra fynd
åtgärdade — F4/F8/F9 spårades, inget annat. Stoppunkt här enligt WIP-regeln.
