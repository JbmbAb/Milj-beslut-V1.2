# F0A — Reconciliation av LU/MVP-flödet mot ADR-28

Status: **DRAFT — read-only reconciliation. Ingen ny spec skapad, ingen kod skriven.**

Uppdrag (fryst formulering): *"Läs ADR-28 som authority för LU scope. Klassificera varje steg i
det föreslagna tiostegsflödet som: already governed by ADR-28, implementation detail under
existing ADR, missing normative requirement, eller conflicting requirement. Endast verkliga
luckor får bli nytt normativt tillägg. Ingen parallell LU-scope-spec skapas."*

---

## Huvudfynd

**Tiostegsflödet är redan reglerat — men inte av ADR-28 ensam, utan av sju frysta/accepterade
ADR:er.** ADR-28 täcker bara steg 6-7 och delar av 10. Resten ligger i andra frysta dokument.
Det betyder att risken inte var "ADR-28 räcker inte" utan det motsatta: **flödet spänner över
flera redan frysta kontrakt, och ett nytt normativt tillägg hade kolliderat med minst fyra av
dem.**

Genuina luckor (kategori 3) är **två**, och båda är små.

### Relevanta frysta dokument som hittades under reconciliationen

| ADR | Status i filen | Vad den styr |
|---|---|---|
| `ADR-27-LU-Architecture-Charter.md` | **Frozen**, "bindande för all utveckling av LU v1.0" | Tre nivåer: Infrastruktur-adaptrar → LU Application → Frozen Core. Explicita satser: *"LU är en applikation, inte en plattform"*, *"Governance aldrig dupliceras"*, *"Artifacts skapas på rätt plats"*. |
| `ADR-28-LU-Definition-Scope.md` | **Frozen** | Fem artifacts, SpatialQueryContract, datadrivna regler (Evidence→Rules→Findings→Assessment), rapportprojektion, LU:s egen DoD. |
| `ADR-30-LU-Runtime-v1-Freeze-...md` | Accepted, `lu-runtime-v1` | Normativ LU-exekveringsmodell; enda spine, ingen parallell RuleEngine. |
| `ADR-24-23-Audit-Reconstruction-and-Replay.md` | **Accepted (Frozen)** | Replay-modellen i sin helhet: sex artifact-typer, determinism, equivalence. |
| `ADR-23B-Operational-Governance-Runtime.md` | Accepted | *"Admit exactly one `ViewerCapabilityArtifact`"* (VIEW-22-I2, I6) — dvs. **uppströmskällan för F8**. |
| `ADR-CHUNKING-Subsystem.md` | Accepted | Ett chunking-subsystem, två kontrakt (`text/v2.3`, `archive/v1.0`). Uttrycklig **non-decision**: ingen `UniversalChunker`. |
| `ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md` | **ACCEPTED / SEQUENCE FROZEN** | GEO_Master_Archive som canonical truth; presentationsklienter är rena visualiserare av verifierat bevis, inte egna GIS-frågemotorer. |
| `ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` | **ACCEPTED / SEQUENCE FROZEN** | Steg 1-5 (se F0B). |

---

## Klassificering av tiostegsflödet

| # | Steg | Klass | Styrande dokument / motivering |
|---|---|---|---|
| 1 | Ladda ned källor | **Utanför ADR-28:s scope; delvis oreglerat** | ADR-28 reglerar bedömning, inte insamling. Ingestion-ADR:n täcker dokumentkatalogisering men **inte hämtningskontraktet** (URL, HTTP-status, retry, MIME). Det ligger i `SourceRegistryArtifact`/`HarvestPlan` — **ofryst** (task #19 / F0D). → **Genuin lucka G1**, men den ska fyllas i F0D, inte här. |
| 2 | Sortera enligt källa/domän/datum/identifierare | `already governed` (ingestion-ADR) | `DocumentInventoryManifest` definierar redan `authority`, `document_date`, `case_number`, `document_type`, samt tre kunskapsdomäner (`LEGAL`, `ENVIRONMENTAL_DECISIONS`, `TECHNICAL`). Determinismkravet (stabil sortering före hash) är `implementation detail` — redan bevisat i `mps-legal-corpus`. |
| 3 | Arkivera råfil i masterarkiv | `conflicting requirement` | Ingestion-ADR:n + spatial-presentation-ADR:n förutsätter båda `GEO_Master_Archive` som canonical truth med `Documents/Sources/`-layout. Den föreslagna `raw/manifests/normalized/...`-strukturen är en konkurrerande modell. → **F0B avgör.** |
| 4 | Skapa manifest/provenance | `already governed` | `DocumentInventoryManifest`-schemat är fryst i sin helhet. |
| 5 | Chunkning enligt fryst policy | `already governed` | `ADR-CHUNKING-Subsystem`: `text/v2.3`-kontraktet. Notera dess **non-decision** mot `UniversalChunker` — ett nytt LU-eget chunkningsspår hade brutit mot den. `chunk_set_content_hash`-determinismen är redan PROVEN i `mps-legal-corpus`. |
| 6 | Skapa evidens/artifacts | **`already governed by ADR-28`** | §1: `SpatialEvidenceArtifact`, `DocumentEvidenceArtifact` med fastställda fält. |
| 7 | Köra LU-bedömning | **`already governed by ADR-28`** (+ ADR-30) | §3: `Evidence → Rules → Findings → Assessment`, RulePredicate + `rule_version`, kravet att *varje finding måste ha minst en evidensreferens*. ADR-30 fryser exekveringsmodellen. |
| 8 | CAS-lagra via governed write | `implementation detail under existing ADR` — **inte ett nytt beslut** | ADR-27 har redan fryst *"Governance aldrig dupliceras"* och *"LU är en applikation, inte en plattform"*. Ägarbeslutet 2026-08-11 (A1: staging förkastat, write bort ur authority-vägen) **återställer efterlevnad av ett redan fryst kontrakt** — det inför ingen ny norm. Se konsekvens nedan. |
| 9 | Replaya beslut | `already governed` | `ADR-24-23` är fryst och fullständig: `AuditReconstructionProfileArtifact`, `ReconstructedExecutionGraphArtifact`, `ObservedExecutionGraphArtifact`, `ReplayVerificationProfileArtifact`, `ReplayVerificationArtifact`, `ReplayEquivalenceReportArtifact`. F9 (replay `undefined` artifact id) ska därför bedömas som **avvikelse från ADR-24-23**, inte som en oreglerad bugg. |
| 10 | Exportera enkel viewer/QGIS-vy | Delvis `already governed`, delvis **genuin lucka G2** | `ViewerCapabilityArtifact` admitteras enligt ADR-23B (VIEW-22-I2/I6) — **det är uppströmskällan för F8**. Presentationsprincipen ("visualiserare av verifierat bevis, inte egen frågemotor") är fryst i spatial-presentation-ADR:n, och `ViewerKernel.ts` följer den redan. **Men:** själva QGIS/GeoJSON-exportkontraktet (EPSG:3006, `VERIFIED_OBSERVATION`-taggning, vilka properties som får exponeras) finns bara i kod, inte i någon ADR. |

---

## De två genuina luckorna (enda kandidaterna för nytt normativt tillägg)

**G1 — Hämtningskontraktet (steg 1).** ⚠️ **KORRIGERAD AV F0B — G1 är i huvudsak INTE en lucka.**
`mimers-brunn-v3.0.0.md` (ACTIVE) §3.1 fryser `rate_limit`/`concurrency_limit`/
`max_object_size`/`retry_policy` per producent, och §2/§5 fryser förbudet mot
AI-relevansfiltrering på tre ställen. Kvarstående rest: exakt vilka tekniska responsfält
(HTTP-status, MIME, storlek) som ska loggas per hämtning — en detaljnivå under befintligt
kontrakt. **Åtgärd: fastställs i F0D:s `SourceRegistryArtifact`-schema. Se
`F0B-INGESTION-ARCHIVE-RECONCILIATION-2026-08-11.md`.**

**G2 — QGIS/GeoJSON-exportkontraktet (steg 10).** Implementerat i `ViewerKernel.ts` men inte
normerat. Minsta rimliga tillägg: en kort ADR-notis som fryser CRS (EPSG:3006), den
obligatoriska `governance_status: "VERIFIED_OBSERVATION"`-taggningen, och att endast
CAS-upplösta properties får exponeras.
**Åtgärd: minimalt tillägg, inte en ny LU-scope-spec.**

Allt annat i tiostegsflödet är antingen redan styrt eller ett implementationsdetalj under
befintlig ADR. **Ingen parallell LU-scope-spec ska skrivas.**

---

## Tre konsekvenser som ändrar planen

**K-A — A1 är starkare än vi trodde.** Ägarbeslutet om LU:s CAS-write formulerades som ett nytt
arkitekturbeslut. Reconciliationen visar att `ADR-27` redan frusit *"Governance aldrig
dupliceras"* och *"LU är en applikation, inte en plattform"*. LU:s direkta `cas.put(...)` är
alltså inte bara en känd bypass — den är ett **brott mot en bindande, fryst charter**. Det höjer
prioriteten och tar bort varje kvarvarande argument för staging-omdöpning.

**K-B — F8 har fått sin uppströmskälla.** F0C-frågan *"var konstrueras
`ViewerCapabilityArtifact`?"* är delvis besvarad utan spårningsarbete: ADR-23B kräver att exakt
en admitteras, och `packages/mps-governance-runtime/src/ViewerCapabilityAdmission.ts` finns.
F0C:s viewer-del kan därför börja där i stället för att söka brett.

**K-C — F9 ska mätas mot ADR-24-23.** Replay-avvikelsen är inte ett oreglerat fel utan en
avvikelse från ett fryst kontrakt med sex definierade artifact-typer. Det ger F0C ett facit att
mäta mot i stället för att bedöma från fall till fall.

---

## Vad F0A INTE gjorde

Ingen ny normativ text skrevs. Inget kontrakt frystes. Ingen kod rördes. De två luckorna (G1,
G2) är identifierade men inte fyllda — G1 tillhör F0D, G2 kräver ditt beslut om det är värt en
egen ADR-notis eller kan lämnas som implementerat-men-onormerat i MVP.
