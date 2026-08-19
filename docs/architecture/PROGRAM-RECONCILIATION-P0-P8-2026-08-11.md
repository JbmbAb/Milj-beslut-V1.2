# Program-reconciliation — P0–P8 mot befintliga plandokument

Status: **DRAFT — read-only reconciliation. Ingen ny plan skapad, ingen kod skriven.**

Syfte: placera in den föreslagna P0–P8/HM-strukturen bland de plandokument som redan finns, och
identifiera vad som är stale, dubblerat eller motstridigt — innan P0–P8 fryses.

---

## ⚠️ Huvudfynd: planproliferationen är nu den största risken

Det finns just nu **fem** parallella plandokument som beskriver överlappande arbete med **fyra
olika numreringsscheman**:

| Dokument | Status i filen | Schema | Ägare |
|---|---|---|---|
| `HIGH-MATURITY-ARCHITECTURE-IMPLEMENTATION-PLAN.md` | **ACTIVE TRACK, started 2026-08-11** | Workstreams **A–E** | oklart |
| `CODEX-NON-COLLIDING-ARCHITECTURE-PLAN-2026-08-11.md` | DRAFT / BLOCKED | **Phase 1–5** | Codex |
| `LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md` | DRAFT, frysningsbar | **F0A–F5** | Opus |
| P0–P8 / HM-1..HM-3 (denna omgång) | ej nedskriven som fil ännu | **P0–P8** | — |
| `PROOF-BASELINE-MATRIX` + `ARCHITECTURE-CLEANUP-DECISION-PACKETS` | DRAFT | — | Codex |

Detta är **exakt samma mönster som hela saneringen finns för att motverka** — parallella modeller
som beskriver samma sanning med olika vokabulär — fast nu i planlagret i stället för i koden.
`HIGH-MATURITY`-planen är dessutom märkt `ACTIVE TRACK` medan LU/MVP-planen och Codex-planen båda
är DRAFT, så det finns redan en oklarhet om vilken som styr.

**Rekommendation: frys P0–P8 som den enda programnivån, och nedgradera de andra fyra till
underordnade spår som refererar in i den — i stället för att lägga P0–P8 ovanpå som ett femte
lager.** Konkret: `HIGH-MATURITY`s workstreams A–E och Codex Phase 1–5 bör märkas
"subsumed by P0–P8" snarare än leva vidare parallellt.

---

## Stale-flagg: Codex-planens "ADR Alignment Blocker" är löst — och pekade delvis fel

Codex-planen säger fortfarande:

> *"This plan must stay draft until it is reconciled with existing frozen ADRs:
> `ADR-28-LU-Definition-Scope.md` ... `ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` ...
> The next decision must choose one of: follow / supersede / convergence spec."*

**Det beslutet är fattat.** F0A och F0B genomförde reconciliationen och svaret är **"follow the
existing contracts"** i båda fallen. Två korrigeringar krävs dock i Codex-planens formulering:

1. **Det är inte två ADR:er utan sju.** F0A visade att tiostegsflödet regleras av `ADR-27`
   (charter, *bindande*), `ADR-28`, `ADR-30`, `ADR-24-23` (replay), `ADR-23B` (viewer
   capability), `ADR-CHUNKING`, `ADR-SPATIAL-PRESENTATION` — utöver ingest-ADR:n.
2. **Fel dokument utpekat som arkivauktoritet.** Codex-planen behandlar
   `ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` som det som fryser arkivmodellen. F0B visade
   att den styrande auktoriteten är **`mimers-brunn-v3.0.0.md` (Status: ACTIVE, 2026-08-09)**,
   som supersederar `v2.0.1` → som supersederar `offline-first`. Codex-planen nämner inte
   v3.0.0 alls.

Codex-planens blocker kan alltså lyftas, men dess ADR-avsnitt måste uppdateras innan det görs —
annars låser man upp på fel grund. (Codex äger filen; detta rapporteras, patchas inte.)

---

## Mappning: befintligt arbete → P0–P8

| P | Innehåll | Vad som redan finns | Lucka |
|---|---|---|---|
| **P0** Proof taxonomy + current-state freeze | Vad PROVEN betyder; nuläget fryst | ✅ `proven_criteria` (4 kriterier) i `architecture-authority-map.jsonc`; `proof_status_enum`; klassningsdokumentet; `PROOF-BASELINE-MATRIX` (draft) | Frysning saknas — allt är DRAFT |
| **P1** Authority & Governance Convergence | En kanonisk auktoritet per domän | ✅ Level 2 promotion PROVEN; authority map v2 med 3 dimensioner; A1–A3 avgjorda; **F0A/F0B/F0D klara** | F0D väntar på frysning; A1:s röda test ej skrivet |
| **P2** Governed ingestion, en verklig källa | Första källan hela vägen genom governad väg | ✅ `F0D` minimikontrakt (Tier 1); ✅ `mimers-brunn-v3.0.0` Tier 1–2; ✅ enforcement-invariant + 3 arkitekturtester specificerade | Ingen kod; kräver P1-frysning först |
| **P4A** Spatial runtime convergence | — | ⚠️ **NYTT — finns inte i något befintligt plandokument.** `ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT` (FROZEN) och `ADR-29-TV4-Spatial-Foundation` är relevanta men ospårade av mig | Helt oanalyserad — se nedan |
| **P3** LU MVP PROVEN | LU-spåret grönt | ✅ `LU-MVP-IMPLEMENTATION-PLAN` F0A–F5 med fryst fasordning; F0A/F0B klara | F0C ej gjord (Codex lane); FAS 1–5 ej påbörjade |
| **P5** Legal Knowledge Plane | Juridisk korpus | ✅ **`mps-legal-corpus` PROVEN v1** (18/18, kollateralt bekräftat); ✅ v3.0.0 Tier 5 bekräftar designen | Ej kopplad till `DocumentIngestionEngine` |
| **P6** Canonical identity & replay | Identitet + replay | ✅ `ADR-24-23` fryst med sex replay-artifacts; ✅ CAS/WORM PROVEN | F9-avvikelsen ospårad |
| **P7** Operations | Drift | ✅ mimers ops-proof/backup-restore/durability-matrix finns som scripts | Ej kartlagt av mig |
| **P8** CI/proof fabric (genomgående) | Proof-lanes | ⚠️ `riskguard` DB-auth blockerar; `PROOF-BASELINE-MATRIX` draft; **`ADR23Compliance.test.ts` exekveras aldrig** | §4.3 öppen |
| **P4B** Nationell spatial täckning | Efter P4A | — | Korrekt sekvenserat, inget att tillägga |

---

## Tre observationer om P0–P8-strukturen

**O1 — P4A är genuint nytt och oanalyserat.** Alla andra P-noder har motsvarighet i befintligt
arbete. "Spatial runtime convergence" har det inte. Det finns frysta spatial-kontrakt
(`ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT` — ACCEPTED/SEQUENCE FROZEN, `ADR-29-TV4-Spatial-
Foundation`, `ADR-POSTGIS-REBUILD-DATA-CONTRACT`, `ADR-POSTGIS-ADMIT-V1`,
`MASTER-SPATIAL-SOURCE-INVENTORY`) plus ett `spatial-provider-postgis`-paket och PostGIS-tester
som faller på `riskguard`-auth. **Innan P4A placeras som blockerare för P3 bör den få samma
read-only reconciliation som F0A/F0B fick** — annars riskerar den att bli den nya
"vi-visste-inte-att-det-redan-fanns-ett-fryst-kontrakt"-fällan.

**O2 — P8 som genomgående spår krockar mildt med LU-planens frysta fasordning.** LU-planen har
`F3B (proof-lanes)` som ett *steg* mellan F3 och F4. P0–P8 gör proof-fabric till ett
genomgående spår. Båda kan vara sanna, men formuleringen bör harmoniseras: antingen är P8 en
kontinuerlig disciplin med F3B som dess LU-specifika milstolpe, eller så är F3B redundant.
Rekommendation: behåll F3B som milstolpe *inom* P8.

**O3 — beroendekedjan `P1 → P2` stämmer med F0D:s egen slutsats.** F0D §7 säger att frysning
låser upp proof-splitten och FAS 4. P0–P8 säger samma sak med annan vokabulär. Det är en
bekräftelse, inte en konflikt — men det illustrerar varför ett enda schema behövs.

---

## Vad jag rekommenderar som nästa beslut

1. **Frys P0–P8 som enda programnivå** och märk `HIGH-MATURITY` A–E samt Codex Phase 1–5 som
   subsumerade. (Annars fortsätter fyra scheman leva parallellt.)
2. **Lyft Codex ADR-blockern** — men uppdatera först dess ADR-avsnitt enligt de två
   korrigeringarna ovan.
3. **Frys F0D** (minimikontraktet) — det är P1:s sista öppna punkt.
4. **Beställ en read-only P4A-reconciliation** innan P4A får blockera P3.

Inget av ovanstående kräver kod.
