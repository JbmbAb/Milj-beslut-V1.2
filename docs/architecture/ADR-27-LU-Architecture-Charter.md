# LU Architecture Charter v1.0 (Frozen)

## 0. Syfte
Denna charter definierar den konstitutionella arkitekturen för LU v1.0.  
Den säkerställer att:

- Frozen Core förblir ren och domänoberoende  
- LU är en applikation, inte en plattform  
- Adaptrar är integrationer, inte logikmotorer  
- Artifacts skapas på rätt plats  
- Governance aldrig dupliceras  
- Spårbarhet är total  
- Ingen domänlogik läcker in i fundamentet  

Detta dokument är bindande för all utveckling av LU v1.0.

---

# 1. Arkitekturens tre nivåer

Infrastruktur-adaptrar (PostGIS, dokument, filer, UI)
        |
        ↓ (beror på)
LU Application (lokaliseringsutredning)
        |
        ↓ (beror på)
Frozen Core (sanning, identitet, bevis)

---

# 2. Frozen Core (Fundamentet)

## Ansvar
- ArtifactContract  
- content hashing  
- provenance  
- immutable storage  
- audit graph  
- release binding  
- governance invariants  
- proof resolution  

## Förbud
- får inte importera LU  
- får inte känna till LU-regler  
- får inte känna till LU-artefakter  
- får inte innehålla domänlogik  
- får inte skapa LU-artifacts  

## Konstitutionell regel
**Frozen Core är sanningsmotorn. Den får aldrig förorenas av domänspecifik logik.**

---

# 3. LU Application (Domänapplikationen)

## Ansvar
- definiera LU-artefakter (payload ovanpå ArtifactContract)  
- definiera LU-regler  
- definiera LU Assessment Engine  
- definiera LU-services  
- definiera LU-report-projection  
- definiera LU Consultation Projection  
- producera ett verifierbart analysresultat  

## Moduler
packages/
mps-lu/
artifacts/
domain/
rules/
services/
projections/
  LUReportProjection
  LUConsultationProjection
tests/

## Förbud
- får inte definiera governance-principer  
- får inte skapa egna identitetsfält  
- får inte skapa muterbara artifacts  
- får inte importera UI, PostGIS eller dokumentmotorer  
- får inte skapa artifacts direkt från adaptrar  

## Konstitutionell regel
**LU är en applikation som producerar ett bevisat analysresultat.  
LU får aldrig definiera nya governance-principer.**

---

# 4. Infrastruktur-adaptrar (Reality Layer)

## Ansvar
- PostGIS-integration  
- dokumenthämtning  
- filsystem  
- UI-rendering  
- rapportrendering  

## Förbud
- får inte skapa LU-artifacts  
- får inte skapa findings  
- får inte skapa regler  
- får inte göra bedömningar  
- UI får inte se PostGIS, LU Assessment Engine eller Document Provider  

## Konstitutionell regel
**Adaptrar hämtar data. LU tolkar data. Frozen Core bevisar data.**

---

# 5. Arkitekturregler (frusna)

## Regel 1 — Frozen Core får inte importera LU
Förbjudet:
```ts
import "mps-lu"
```
## Regel 2 — LU får importera Frozen Core
Tillåtet:
```ts
import { ArtifactContract } from "mps-compliance"
```
## Regel 3 — UI får endast se projections
UI får inte se:
- PostGIS
- LU Assessment Engine
- Document Provider

UI får endast se:
Projection → Artifacts → Viewer

## Regel 4 — LU får inte skapa governance
All governance ligger i Frozen Core.

## Regel 5 — LU får inte skapa muterbara artifacts
Assessment är alltid immutable snapshot.

## Regel 6 — Artifact Creation Boundary
Adapters
   |
   | raw observations
   ↓
LU Services
   |
   | domain artifacts
   ↓
Frozen Core
   |
   | verification + storage

PostGIS får aldrig skapa SpatialEvidenceArtifact.  
UI får aldrig skapa LocalizationAssessmentArtifact.  
LU Services är enda skaparen av LU artifacts.  
Frozen Core verifierar och lagrar artifacts.

## 6. LU Assessment Engine (ersätter RuleEngine)
LU ska inte ha en generell regelmotor.
LU ska ha en LU Assessment Engine som tolkar LU-regler.

Konstitutionell regel
LU Assessment Engine är LU:s tolkning av evidens.
Den är inte en generell regelmotor.

## 7. Architecture Boundary Tests
Skapa:
`ArchitectureBoundary.test.ts`

Verifierar:

- Frozen Core får inte importera LU
- LU får inte importera UI, PostGIS eller dokumentprovider
- UI får inte importera artifact-store eller LU-regler

De specifika invarianterna är:
- **ARCH-27-I1**: Frozen Core SHALL NOT depend on domain packages.
- **ARCH-27-I3**: Domain applications SHALL NOT depend on infrastructure providers.
- **ARCH-27-I5**: Presentation layers SHALL consume projections only.
- **ARCH-27-I7**: Infrastructure SHALL NOT create domain conclusions.

## 8. SpatialEvidenceArtifact – observerat faktum
SpatialEvidence är inte geografisk sanning.
Det är ett observerat faktum från en källa vid en version.

Payload måste innehålla:
```ts
source_metadata: {
  provider: string
  dataset: string
  dataset_version: string
  retrieved_at: ISO8601
}
```

## 9. Dokumentmotorn – korrekt placerad
Flöde:
Document Provider
        ↓
DocumentEvidenceArtifact
        ↓
LU Assessment Engine

**AI Prohibition**
LU v1 SHALL NOT depend on AI services for producing assessments.
AI kan senare göra sammanfattningar, språkförbättring, sökhjälp. Men aldrig:
Evidence → LLM → Assessment

## 10. Strategisk arkitektureffekt och Modelleringsgräns
Ni har nu:
```
                  Frozen Core
                      ↑
                      |
                LU Application
                      |
          -------------------------
          |
    Project Context
          |
    Evidence Collection
          |
    Assessment Engine
          |
    Report Projection
          |
    Consultation Projection
```
Inte:
```
          Environmental Platform
                  |
        --------------------
        |        |         |
       LU    C-anmälan   Tillsyn
```

## 11. Implementation ska vara tråkig
Första releasen ska kännas nästan banal:

- konsult väljer fastighet
- systemet hämtar evidens
- systemet kör LU-regler
- findings visas
- karta visar evidens + regel + finding
- rapport exporteras

Det räcker.

## 12. Slutlig konstitutionell regel (FRYST)
- Frozen Core är sanningsmotorn.
- LU är en applikation som producerar ett bevisat analysresultat.
- Infrastruktur-adaptrar kopplar verkligheten till LU.
- LU får aldrig definiera governance.
- Frozen Core får aldrig importera LU.
- UI får endast se projections.
- LU Services är enda skaparen av LU artifacts.
Detta är den frusna arkitekturen för LU v1.0.
