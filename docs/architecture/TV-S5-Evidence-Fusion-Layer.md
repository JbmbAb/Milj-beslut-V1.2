# TV-S5: Evidence Fusion Layer Architecture (FRYST)

**Status:** Frozen
**Owner:** Spatial Governance Domain
**Scope:** Combining verifiable evidence into higher-order assessments without violating causality or domain independence.

## 1. Syfte och Avgränsning (Vad TV-S5 är och inte är)

TV-S5 är det lager i Mimers arkitektur som reglerar hur flera bevis (`EvidenceArtifacts`) slås samman till en härledd bedömning (`AssessmentFinding`). 

Detta är ett **kontraktuellt lager**, inte en AI-motor. 

### De Gyllene Invarianterna (Får ej brytas)
1. **Capability ≠ Provider:** Vad som görs (Capability) är frikopplat från hur det görs (Provider).
2. **Provider ≠ Artifact:** Providern producerar en Artifact, men är inte själv bärare av sanning.
3. **Artifact ≠ Assessment:** Ett bevis (t.ex. avståndet till en brunn) är skilt från bedömningen (t.ex. risken för förorening).
4. **Assessment ≠ Decision:** En AI-bedömning är inte ett juridiskt beslut. Beslutet kräver mänsklig granskning (`Review`).
5. **AI ≠ Authority:** LLM-resonerande hålls utanför TV-S5:s kontraktsdefinition. AI kan vara en *Provider*, men inte en oberoende auktoritet.
6. **Fusion ≠ Domain Logic:** Fusion-kontraktet vet *inget* om domänlogiken (t.ex. hydraulik, geologi). Det vet bara hur man refererar till bevis kryptografiskt.

## 2. Fusion Contract

`TV-S5` definierar flödet som leder från bevis till beslut, utan att blanda ihop ansvarsområdena.

```text
Evidence A (t.ex. LU Property)
Evidence B (t.ex. Vattenskyddsområde)
Evidence C (t.ex. EBH-område)
   │
   ▼
Fusion Contract (Regelmotor, LLM, etc. agerar som Provider här)
   │
   ▼
Assessment Finding (Den härledda insikten, kryptografiskt bunden till A, B, C)
   │
   ▼
Review (Mänsklig verifiering)
   │
   ▼
Decision (Auktoritativt beslut)
   │
   ▼
CAS (Bevarande av hela kedjan för replay/revision)
```

## 3. Livscykelnivåer för Capabilities (ROADMAP → AVAILABLE → VERIFIED)

För att tydligt särskilja vad plattformen *kan* göra, vad den *testas* för att göra, och vad som är *bevisat*, införs tre strikta nivåer för alla kapabiliteter som bygger på TV-S5:

*   **ROADMAP:** Kapabiliteten (t.ex. IoT-streaming, 3D Hydraulik) finns i arkitekturen, men saknar implementation. Får **inte** marknadsföras som en funktion.
*   **AVAILABLE (Integratable):** Kapabiliteten (t.ex. LLM-baserad textanalys) kan testas i labbmiljö och integreras, men har ännu inte bevisat sig i den fullständiga kedjan mot CAS och Replay. Får beskrivas som en *möjlighet*.
*   **VERIFIED:** Kapabiliteten (t.ex. LU Spatial Enforcement) är fullt integrerad med CAS, har deterministisk replay och genererar `FailureArtifacts` vid negativt resultat. Får användas operativt och marknadsföras.

## 4. Implementationsregel

**Ingen kod får skrivas för TV-S5 som en abstrakt, generell plattformsfunktion.**
Implementeringen av TV-S5 drivs uteslutande av de domänkapabiliteter som byggs. Varje gång vi lägger till en ny typ av evidence (t.ex. Raster, Hydraulik), tvingas TV-S5-kontraktet att anpassa sig, utan att det ursprungliga kontraktet förlorar sin strikthet.

*Beslut baserat på principen: "Bygg inte plattformen för att bevisa visionen. Bygg kapabiliteter som bevisar plattformen."*
