# LU v1.0 – Konsultflöde (Frozen)

## Steg 1 — Projektbeskrivning
Formulär:
- Projekt: "Ny industrietablering"
- Verksamhet: "Tillverkning av komponenter"
- Planerad omfattning: "5 000 m² byggnad, 50 anställda"
- Övrigt: "Kemikalier kan förekomma"

`UI → LUProjectContextCreateRequest`
`↓`
`LU Application → LUProjectContextArtifact`

## Steg 2 — Fastighet
Sök fastighet: [__________]
[Visa på karta]

Vald fastighet:
ABC 1:123
Geometri verifierad (SWEREF99 TM)

`UI → LUPropertyContextCreateRequest`
`↓`
`LU Application → LUPropertyContextArtifact`

## Steg 3 — Starta LU
`UI → LUCreateRequest`
`↓`
LU Application:
- binder projektkontext + property_ref
- kör SpatialQueryContract
- skapar SpatialEvidenceArtifact[]
- hämtar dokument → DocumentEvidenceArtifact[]
- kör LU Assessment Engine
- skapar LocalizationAssessmentArtifact (immutable)

## Steg 4 — GIS‑granskning
Klick på karta → evidence + regel + finding.

## Steg 5 — Resultat och Samrådsunderlag
Resultat presenteras för konsulten i två vyer:

1. **LU-resultat (Intern riskbedömning)**
   - Risker: Vattenskyddsområde, EBH-objekt, etc.
   - Intressen: Närliggande bostäder, skyddad natur
2. **Samrådsunderlag (`LU Consultation Projection`)**
   - Projektbeskrivning, karta, identifierade miljöfrågor, berörda intressen, frågor inför samråd.
   - Kan exporteras som HTML/PDF för kund.

## Steg 6 — Consultant Commentary
Separat artifact: `ConsultantNoteArtifact`
Assessment refererar den via `consultant_commentary_ref`.

## Steg 7 — Rapport
Artifacts → ReportProjection → HTML → PDF
