# Data Dictionary - Miljöbeslut Platform

Detta dokument beskriver de centrala entiteterna i plattformens databasmodell, deras syfte och hur de relaterar till varandra.

## Centrala Entiteter

### Organisation
*   **Syfte**: Rot-entiteten för multi-tenancy. Alla användare och projekt tillhör exakt en organisation.
*   **Viktiga fält**: `name`, `orgNumber`.
*   **Relationer**: Har många `User`, `Project`, och `DocumentRecord`.

### Project
*   **Syfte**: Den centrala containern för allt arbete med miljöärenden. Håller samman dokument, villkor och medlemmar.
*   **Viktiga fält**: `propertyDesignation` (Fastighetsbeteckning), `status` (ACTIVE, CLOSED, ARCHIVED), `complianceScore`.
*   **Relationer**: Tillhör en `Organisation`. Innehåller många `DocumentRecord`, `RequirementCase` och `ProjectMember`.

### User
*   **Syfte**: Representerar en användare i systemet. Hanterar kopplingar till BankID för autentisering.
*   **Viktiga fält**: `bankidId`, `role` (ADMIN, CONSULTANT, etc.).
*   **Relationer**: Tillhör en `Organisation`. Kan vara medlem i många `Project` via `ProjectMember`.

### DocumentRecord
*   **Syfte**: Metadata för ett uppladdat eller inhämtat dokument. Detta är startpunkten för dokumentrelaterade flöden.
*   **Viktiga fält**: `originalName`, `status` (METADATA_ONLY, TEXT_EXTRACTED, etc.), `absolutePath`.
*   **Relationer**: Kopplat till ett `Project`. Har ett `DocumentContent` och många `DocumentChunk`.

### DocumentContent
*   **Syfte**: Den fullständiga extraherade texten från ett dokument. Lagras krypterat.
*   **Relationer**: 1:1 med `DocumentRecord`.

### DocumentChunk
*   **Syfte**: Mindre textsegment (chunks) som används för vektor-baserad sökning (RAG).
*   **Viktiga fält**: `chunkText`, `embeddingJson`.
*   **Relationer**: Tillhör en `DocumentRecord`.

### RequirementCase
*   **Syfte**: Representerar ett specifikt juridiskt ärende (t.ex. ett tillståndsbeslut) som har parseats till individuella villkor.
*   **Viktiga fält**: `caseKey`, `municipality`, `authorityName`.
*   **Relationer**: Kopplat till ett `Project` och ett käll-`DocumentRecord`. Innehåller många `RequirementRecord`.

### RequirementRecord
*   **Syfte**: Ett enskilt juridiskt villkor (villkorskod) extraherat från ett beslut.
*   **Viktiga fält**: `requirementTextQuote`, `category`, `verificationStatus`.
*   **Relationer**: Tillhör ett `RequirementCase`. Kopplat till käll-`DocumentRecord`.

### RequirementCitation
*   **Syfte**: Direkt bevisföring (citat) från källdokumentet som stödjer ett specifikt villkor.
*   **Relationer**: Kopplar en `RequirementRecord` till en specifik del av en `DocumentRecord`.

### GeoSource & GeoAnalysisLayer
*   **Syfte**: Hanterar geospatial data (Lantmäteriet, SGU, etc.) och de analyser (t.ex. NDVI, lutning) som genereras för ett projekt.
*   **Relationer**: `GeoAnalysisLayer` kopplar ett `Project` till en `GeoSource`.

## Övergripande flöde
1. En **Organisation** skapar ett **Project**.
2. **User** (via **ProjectMember**) laddar upp en **DocumentRecord**.
3. Systemet extraherar text till **DocumentContent** och skapar **DocumentChunk** för sökning.
4. Om dokumentet är ett beslut, skapas ett **RequirementCase** med tillhörande **RequirementRecord** och **RequirementCitation**.
5. Geospatiala analyser genereras som **GeoAnalysisLayer** baserat på data från **GeoSource**.
