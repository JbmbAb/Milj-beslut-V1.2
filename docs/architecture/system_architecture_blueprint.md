# Systemarkitektur Blueprint: Miljöbeslut.se (Full Stack GovTech)

Detta dokument utgör den slutliga tekniska blåkopian för plattformen Miljöbeslut.se. Arkitekturen transformerar systemet från ett statiskt arbetsverktyg till en **Prediktiv Regulatorisk Intelligence-plattform** för miljöprojekt.

## 1. Den Prediktivascoring-motorn
Systemet skiftar fokus från reaktiv dokumenthantering till proaktiv prediktion genom att kombinera historiska myndighetsbeslut, geografiska data och maskininlärning.

### 1.1 Analys på tre nivåer
Plattformen opererar med tre distinkta prediktiva modeller:
-   **Modell 1: Regulatorisk Prediktion**: Analyserar sannolikheten för kompletteringskrav, förelägganden eller avslag baserat på kommunens beslutshistorik för liknande ärenden.
-   **Modell 2: Miljörisk (GIS-driven)**: Beräknar risk för påverkan på grundvatten, skyddade arter och recipienter genom geospatial överlagring av projektplatsen mot nationella geodatabaser.
-   **Modell 3: Finansieringsrisk (Bank-rating)**: Klassificerar projektets finansieringsbarhet (AAA till C) baserat på Compliance Score, Risk Score och CO2-estimat.

### 1.2 Den Prediktiva Riskformeln
```text
Risk = R_risk (Regulatorisk) + E_risk (Miljö) + D_risk (Dokumentation) + L_risk (Logistik)
```
Denna formel genererar en vägd poäng som ger banker och investerare ett objektivt beslutsunderlag i realtid.

---

## 2. Teknisk Arkitektur (Blueprint)

### Lager 1: Datakällor
-   **Myndighetsdata**: Beslutshistorik från 260+ kommuner, Länsstyrelser och Mark- och miljödomstolar.
-   **GIS-data**: Lantmäteriet, SGU, SMHI, SLU Artdatabanken, MSB och Trafikverket.
-   **Operativa data**: LIMS-labbrapporter (Eurofins/ALS), realtids-GPS från transporter och projektplaner.

### Lager 2: Ingestion & Processing
-   **Ingestion Pipeline**: Automatiserad insamling via E-post (VBA), Web-crawlers och API:er.
-   **Text AI**: OCR (Gemini Vision) och metadata-extraktion som omvandlar ostrukturerad PDF till strukturerad lagkunskap.

### Lager 3: Dataplattform (The Triple Store)
-   **PostgreSQL**: För all affärslogik, projekt och relationell data.
-   **PostGIS**: För alla geografiska frågor (geofencing, avstånd till vattendrag).
-   **Vector DB (pgvector)**: För semantisk RAG-sökning och likhetsanalys mellan rättsfall.

### Lager 4: Knowledge Graph & Regulatory Engine
-   **Knowledge Graph**: Binder samman `Municipality --> Requirement --> Risk --> Activity`.
-   **Regulatory Engine**: Kodar Miljöbalken och Miljöprövningsförordningen (SNI/EWC) till tvingande logik för Stage-Gates och dokumentkrav.

### Lager 5: Operationella Moduler
-   **ProjectPlan Engine**: Orkestrerar projektets livscykel (Status: INIT --> EXECUTION --> CLOSE).
-   **Logistics Engine**: Hanterar massflöden, fraktbörser och CO2-beräkningar.
-   **LIMS Engine**: Validerar labbdata mot legala gränsvärden och spärrar logistik vid överskridanden.

### Lager 6: Scoring & AI Layer
-   **Scoring Engine**: Beräknar Compliance Score (0-100) och Risk Score (Low/High).
-   **Predictive AI**: Genererar sannolikhetsbedömningar för regulatoriska hinder.

---

---

## 5. Fastighetsanalys-motorn (GIS Analysis Engine)

Detta lager utgör kärnan i systemets förmåga att utföra proaktiv riskbedömning genom att automatiskt analysera projektområden mot nationella geodataskikt.

### 5.1 GIS-regel-motor
Motorn fungerar som en geospatial overlay-analys som körs i realtid när en fastighet eller ett område väljs.

1.  **Fastighetsgeometri (Lantmäteriet):** Hämtar polygoner via *Fastighetsindelning Direkt*.
2.  **Naturreservat (Naturvårdsverket):** Analys mot skyddad natur (NVR).
3.  **Strandskydd (NV/LM):** Automatisk buffertanalys (100-300m) mot vattenlinjer.
4.  **Grundvatten (SGU):** Kontroll mot grundvattenmagasin och sårbarhetskartor.
5.  **Kulturmiljö (RAÄ):** Analys mot Fornsök (Lämningar och kulturmiljöer).
6.  **Riksintressen (Boverket/NV):** Kontroll mot MB 3-4 kap.

### 5.2 Automatisk Miljöbalk-regelmotor (Rule Engine)
Systemet översätter geospatiala träffar till juridisk riskklassning:

| Skyddstyp | Regel | Riskklass | Åtgärd |
| :--- | :--- | :--- | :--- |
| Naturreservat | ST_Intersects | **BLOCK** | Projektet kan sannolikt ej genomföras |
| Strandskydd | < 100-300m | **HIGH** | Strandskyddsdispens krävs |
| Riksintresse | ST_Intersects | **MEDIUM** | Prövning enligt 3-4 kap MB krävs |
| Grundvatten | ST_Intersects | **HIGH** | Hydrogeologisk utredning krävs |
| Fornlämning | ST_Intersects | **HIGH** | Samråd med Länsstyrelsen (KML) |

### 5.3 Risk Scoring & AI-generering
När geodata-motorn har identifierat restriktioner, används en vägd formel för att generera ett **Compliance Score**. En AI-agent (Gemini) tar sedan resultatet och genererar en sammanfattande tillståndsbedömning som:
*   Identifierar nödvändiga dispenser.
*   Föreslår tekniska skyddsåtgärder.
*   Bedömer tillståndschans (Permit Probability).

## 6. Dataplattform (The Triple Store - Expanded)
*   **PostGIS:** Hanterar spatiala index för blixtsnabb overlay-analys (1-3 sekunder).
*   **Lastkajen API (Trafikverket):** För integrering av logistiska risker och bulleranalys.
*   **Knowledge Graph:** Binder samman `Fastighet --> Restriktion --> Miljökrav --> Verksamhetskod`.

## 7. Slutsats
Genom att kombinera dokumentinsikter (39 000+ krav) med realtids-GIS skapas en digital tvilling av det svenska tillståndssystemet. Detta gör det möjligt för systemet att förutsäga kommunens krav innan ansökan ens har skickats in.

