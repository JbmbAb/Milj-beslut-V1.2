# NEGATIVE-KNOWLEDGE-LEDGER-01
**SYFTE:** Dokumentera arkitektoniska koncept, entiteter och objekt som vi uttryckligen har bevisat att vi *INTE* ska bygga just nu. Detta förhindrar ontologiexplosion och "Agentic Amnesia" hos LLM:er.

**REOPENING RULE:** Ingen punkt här får ändras utan formellt bevis på *Semantic Gap* enligt `KERNEL-INTEGRATION-AUDIT-01`.

| Concept / Kärnbegrepp | Disposition | Reason / Evidence | Reopening Criteria |
| :--- | :--- | :--- | :--- |
| **MissionArtifact (Som fristående ny typ)** | CONFIRMED_DO_NOT_BUILD | Semantiken kan sannolikt realiseras via `LATENT_REUSE` (explicit bindning mellan befintlig Project Intent + Authority Scope). | Bevis på att befintlig struktur orsakar governance-förlust. |
| **OutcomeArtifact (Som fristående ny typ)** | CONFIRMED_DO_NOT_BUILD | Är en mekanism/relation, reduceras till `Evidence` som observerar ett `Decision` mot ett `Expected Outcome`. | Bevis på semantisk förlust om det hanteras som relation. |
| **DecisionRecord (Som ny ArtifactType)** | REUSE/NORMALIZE | Är ett kontrakt som ska appliceras på befintliga typer, inte ett nytt oberoende objekt. | Bevis på att kontraktet inte kan ärvas av befintliga beslutstyper. |
