# LU v1.0 – Definition & Scope (Frozen)

## Målgrupp
Miljökonsulter som behöver skapa en kvalitetssäkrad Lokaliseringsutredning (LU) snabbare, med högre precision och med fullständig spårbarhet från slutsats till rådata.

---

# 1. Tre artifacts (Frozen Core-konforma)

## LocalizationAssessmentArtifact
- artifact_type: "localization_assessment"
- binder till release_hash
- innehåller:
  - property_ref
  - findings[]
  - evidence_refs[]
  - rule_refs[] (med rule_version)
  - system_summary
  - consultant_commentary_ref (valfritt)

## SpatialEvidenceArtifact
- observerat faktum från GIS
- canonical geometry
- layer_ref + layer_version
- source_metadata
- query_context

## DocumentEvidenceArtifact
- relevant dokument
- document_ref
- metadata
- source_metadata

---

# 2. SpatialQueryContract
UI → SpatialQueryRequest → Spatial Engine → Provider → SpatialEvidenceArtifact[]

LU är databasmotor-agnostiskt från dag ett.

---

# 3. Datadrivna regler
Ingen DSL.  
Ingen eval.  
Regler definieras via RulePredicate + rule_version.

Kedja:
Evidence → Rules → Findings → Assessment

Varje finding måste ha minst en evidensreferens.

---

# 4. GIS-värde
Varje polygon = evidence + regel + finding.

UX-mål:
“Klick → bevis + regel + motivering.”

---

# 5. Rapportgenerering
Artifacts → ReportProjection → HTML → PDF

Rapporten är rendering, inte sanning.

---

# 6. Definition of Done (DoD)
- [ ] Fastighet identifierad  
- [ ] Alla GIS-lager analyserade  
- [ ] Relevanta dokument analyserade  
- [ ] Alla LU-regler körda  
- [ ] Findings har evidensreferenser  
- [ ] Assessment är immutable snapshot  
- [ ] Audit-graf komplett  
- [ ] Rapport exportbar
