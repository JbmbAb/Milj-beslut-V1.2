# Sewage Portal – Fullständigt Ansökningsystem för Enskilt Avlopp

**Status:** ✅ IMPLEMENTERAT | **Datum:** 2026-04-02 | **Omfattning:** 1-200 PE

---

## 🎯 ÖVERSIKT

**Sewage Portal** är ett komplett juridiskt system för privatpersoner att ansöka om enskilt avlopp (enskilt avlopp) till sin kommun. Systemet integrerar:

- ✅ **Automatiserad regelverksprövning** (Miljöbalken 32 kap, Naturvårdsverket NFS 2016:16)
- ✅ **GIS-driven analys** (SGU brunnsarkiv + jordart, Lantmäteriet fastighetsgränser, Naturvårdsverket skyddade områden)
- ✅ **Dynamisk systemrekommendation** (baserat på PE, jordförhållanden, skyddsnivå)
- ✅ **Juridisk gatekeeping** (markundersökning, grannemedgivande, dokumentation)
- ✅ **Automatisk dokumentgenerering** (situationsplan, tvärsektion, ansökan)
- ✅ **Inskickningsarbetsflöde** (med källspårning för revisionsövervakning)

---

## 📋 JURIDISKA RAMVERK

### Svenska Lagar & Direktiv

| Lag/Direktiv                       | Kapitel/Avsnitt      | Tillämpning                                     |
| ---------------------------------- | -------------------- | ----------------------------------------------- |
| **Miljöbalken (1998:808)**         | Kap 32               | Privatbrunnar, toaletter och avloppsanordningar |
| **Naturvårdsverkets allmänna råd** | NFS 2016:16          | Enskilt avlopp – detaljerade krav               |
| **Vattendirektivet**               | 2000/60/EG           | Vattenskyddsstatus och ekologisk kvalitet       |
| **Bassändirektivet**               | 91/271/EEG           | Känsliga mottagarvatten                         |
| **Mark- och miljödomstolspraxis**  | Se t.ex. MÖD 2018:38 | Infiltrationssystems efektivitet                |
| **Länstyrelses lokala riktlinjer** | Varierar per fylke   | Kommunspecifika tillägg                         |

---

## 🏗️ SYSTEMARKITEKTUR

### Backend Services

```
server/services/
├─ sewageRegulationsService.ts       # Regelverksevardet (Miljöbalken, Naturvårdsverket)
├─ sewageApplicationService.ts        # Ansökningslogik + gates
├─ sewageDocumentGeneratorService.ts  # SVG/PDF-generering
└─ sewageAnalysisService.ts          # GIS-analys (befintlig)

server/routes/
└─ admin.sewage-application.ts       # API-endpoints för ansökan
```

### Frontend Components

```
components/admin/modules/sewage-portal/
├─ SewagePortalView.tsx              # Huvudmodul + arbetsflödesorkestrering
├─ SewageSystemSelector.tsx           # Systemval (befintlig, uppdaterad)
├─ SewageRequirementChecklist.tsx     # Juridisk checklista (auto-genererad)
├─ SewageRiskPanel.tsx               # Riskvisualisering
├─ SewageMapView.tsx                 # Kartvy med GIS-lager
├─ SewageApplicationSummary.tsx       # Slutgranskning före inskickning
└─ [CSS files]

components/admin/hooks/
├─ useSewageAnalysis.ts              # GIS-analysishook (befintlig)
├─ useSewageApplicationGenerator.ts   # Ansökan + dokumentation
└─ useSewageApplicationCreate.ts      # Skapande av ansökan
```

---

## 🔄 ANSÖKNINGSFLÖDE (Workflow)

```
┌────────────────────────────────────────────────────────────────────┐
│ STEG 1: Fastighetsuppgifter                                         │
│ - Fastighetsbeteckning                                              │
│ - Kommun (dropdown)                                                 │
│ - PE (1-200)                                                        │
│ - Valfritt: Latitud/Longitud                                        │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 2: GIS-Analys (Automatisk)                                     │
│ - SGU geologisk data (jordtyp, infiltrationskapacitet)             │
│ - SGU brunnsarkiv (avstånd till brunnar)                            │
│ - Lantmäteriet fastighetsgränser (avstånd till grannars mark)      │
│ - Naturvårdsverket skyddade områden (vattenskyddsområden, Natura 2000) │
│ - SMHI översvämningsrisk                                            │
│                                                                      │
│ OUTPUT:                                                              │
│ - Skyddsnivå (NORMAL / HIGH)                                        │
│ - Risk-poäng (0-100)                                                │
│ - Feasibility-poäng (0-100)                                         │
│ - Rekommenderade system                                             │
│ - Blockerade system                                                 │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 3: Systemval                                                    │
│ - Visa alla 6 systemtyper (med status: Rekommenderad/Blockerad)    │
│ - Visuell display av:                                               │
│   - Kostnad per PE (dynamisk beräkning)                             │
│   - Beräknad yta                                                    │
│   - Avståndskrav                                                    │
│ - Användare väljer system                                           │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 4: Juridisk Granskning & Gates                                 │
│ (Automatiskt genererad baserat på systemval + lokation)            │
│                                                                      │
│ GATE 1: Skyddsnivå-bedömning                                        │
│ - Status: ✓ COMPLETED (automatisk från GIS)                        │
│                                                                      │
│ GATE 2: Markundersökning (om krävs)                                │
│ - Infiltration/Markbädd → TB145-perkolationsprov obligatorisk      │
│ - Användare matar in LTAR-värde                                    │
│ - Status: ⏳ PENDING                                                │
│                                                                      │
│ GATE 3: Grannemedgivande (om krävs)                                │
│ - <50m till grannboll eller grannbrunnar → medgivande krävs        │
│ - <4.5m till tomtgräns → kan kräva medgivande (kommun-specifikt)   │
│ - Användare bekräftar erhållet medgivande                          │
│ - Status: ⏳ PENDING (om nödvändigt)                               │
│                                                                      │
│ GATE 4: Dokumentation                                              │
│ - Situationsplan + Tvärsektion måste genereras                     │
│ - Status: ⏳ PENDING                                                │
│                                                                      │
│ GATE 5: Regelverksprövning                                         │
│ - Automatisk validering mot alla Miljöbalken-krav                  │
│ - Visar violations / warnings / recommendations                    │
│ - Status: ⏳ PENDING                                                │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 5: Dokumentgenerering                                          │
│ Automatisk generering av:                                           │
│                                                                      │
│ 1. SITUATIONSPLAN (SVG/PDF)                                         │
│    - Fastighetsgränser (Lantmäteriet)                              │
│    - Byggnader/befintliga strukturer                                │
│    - Avloppsystemets placering                                     │
│    - Brunnsavstånden                                                │
│    - Höjdkurvor (höjdmodell)                                        │
│    - Skala + orientering                                            │
│                                                                      │
│ 2. TVÄRSEKTION (SVG/PDF)                                            │
│    - Terrängprofil                                                  │
│    - Marklagren + jordtyp                                           │
│    - Grundvattennivå                                                │
│    - Djup till berg                                                 │
│    - Systemets installation + dimensioner                          │
│    - Infiltrationskapacitet (LTAR)                                  │
│                                                                      │
│ 3. ANSÖKNINGSSAMMANFATTNING (PDF)                                   │
│    - Fastighetsuppgifter                                            │
│    - GIS-analysresultat                                             │
│    - Valt system + motivering                                       │
│    - Jordförhållanden                                               │
│    - Miljöbedömning                                                 │
│    - Juridiska references                                           │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 6: Slutgranskning & Inskickning                                │
│                                                                      │
│ Visar:                                                               │
│ - Sammanfattning av alla val                                        │
│ - Färdigställelsechecklista                                         │
│ - Juridisk överensstämmelse                                         │
│ - Bifogade dokument                                                 │
│                                                                      │
│ GODKÄNNANDE KRÄVS:                                                  │
│ ☐ "Jag bekräftar att all information är korrekt och fullständig"  │
│                                                                      │
│ INSKICKNING → API-anrop → Kommun                                   │
│ OUTPUT: Referensnummer + beräknad handläggningstid                 │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────────────┐
│ STEG 7: Bekräftelse & Nästa Steg                                    │
│ - ✓ Ansökan mottagen av kommun                                     │
│ - Referensnummer: AVLOPP-XXXX                                       │
│ - Beräknad handläggningstid: 6-8 veckor                             │
│ - Nästa steg: Kommun granskar, möjliga kompletteringar             │
└────────────────────────────────────────────────────────────────────┘
```

---

## 📝 REGELVERKSPRÖVNING

### Miljöbalken 32 kap – Automatiserad Kontroll

```
Avstandskrav (alla i METER):
├─ Till egen brunn:           ≥ 50m
├─ Till grannbrunnar:        ≥ 50m
├─ Till vattendrag:          ≥ 10m (normal), ≥ 50m (recipientkänslig)
├─ Till tomtgräns:           ≥ 4.5m
└─ Till vattentäkt:          ≥ 100m (ej obligatorisk men rekommenderad)

Systemspecifika krav:
├─ INFILTRATION/MARKBÄDD:
│  ├─ Kräver perkolationsprov (TB145) → LTAR-värde
│  ├─ Max skyddsnivå: NORMAL
│  ├─ Minimum djup till GVN: 0.5m
│  └─ Max LTAR: 40 kg/m²/år (eller enligt testresultat)
│
├─ SLUTEN TANK:
│  ├─ Kräver servicekontrakt för regelbundenEmtömning
│  ├─ Max skyddsnivå: HIGH
│  └─ Skalbar för 1-200 PE
│
├─ MINIRENINGSVERK (BDTA):
│  ├─ Biologisk behandling + kemisk fällning
│  ├─ Max skyddsnivå: HIGH
│  ├─ Regelbunden service obligatorisk
│  └─ Förespeglas för recipientkänsliga områden
│
└─ MINIRENINGSVERK (BDT):
   ├─ Endast biologisk behandling
   ├─ Max skyddsnivå: NORMAL
   └─ Regelbunden service obligatorisk
```

### Naturvårdsverket NFS 2016:16 – Automatiserad Kontroll

```
Höga skyddade områden (HIGH protection level):
├─ Vattenskyddsområden:     Kräver BDTA eller BDTA + Fosforfälla
├─ Natura 2000-områden:     Kräver BDTA eller motsvarande
└─ Känsliga mottagarvatten: Kräver polering (fosforfälla)

Märkt böner (LOW infiltrationskapacitet):
├─ Lera/siltig jord:        Infiltration ej lämplig → Tank/BDTA
└─ Grundvatten nära yta:    Markbädd ej lämplig → Tank/BDTA
```

---

## 🔑 GATES – JURIDISKA BLOCKERARE

| Gate ID                        | Namn                 | Trigger                  | Obligatorisk | Status        |
| ------------------------------ | -------------------- | ------------------------ | ------------ | ------------- |
| `gate-SEWAGE_PROTECTION_LEVEL` | Skyddsnivå-bedömning | Alltid                   | ✅           | AUTO-COMPLETE |
| `gate-SOIL_TEST_COMPLETED`     | Markundersökning     | Infiltration/Markbädd    | ✅           | MANUAL        |
| `gate-NEIGHBOR_CONSENT`        | Grannemedgivande     | <50m brunn / <4.5m gräns | ⚠️ Varierar  | MANUAL        |
| `gate-DOCUMENTATION_COMPLETE`  | Dokumentation        | Alltid                   | ✅           | AUTO-CHECK    |
| `gate-REGULATORY_COMPLIANCE`   | Regelverksprövning   | Alltid                   | ✅           | AUTO-CHECK    |

---

## 📊 SYSTEMTYPER & KOSTNADER (Dinamiskt beräknad per PE)

| System              | Typ        | costPerPE | baseCost   | Max PE | Skyddsnivå |
| ------------------- | ---------- | --------- | ---------- | ------ | ---------- |
| **CLOSED_TANK**     | Lagring    | 3,500 SEK | 10,000 SEK | 200    | HIGH ✓     |
| **INFILTRATION**    | Behandling | 2,500 SEK | 5,000 SEK  | 50     | NORMAL     |
| **SOIL_BED**        | Behandling | 4,000 SEK | 15,000 SEK | 80     | NORMAL     |
| **MINI_PLANT_BDTA** | Behandling | 5,000 SEK | 50,000 SEK | 200    | HIGH ✓     |
| **MINI_PLANT_BDT**  | Behandling | 4,500 SEK | 40,000 SEK | 150    | NORMAL     |
| **PHOSPHORUS_TRAP** | Polering   | 1,000 SEK | 8,000 SEK  | 200    | HIGH ✓     |

**Kostnadexempel för 8 PE Markbädd:**

```
kostnad = baseCost + (costPerPE * PE)
kostnad = 15,000 + (4,000 * 8) = 47,000 SEK
yta = 3 m²/PE * 8 = 24 m²
```

---

## 🔐 DATAKÄLLA & KÄLLSPÅRNING

Alla uppgifter är märkta med källspårning för revisions- och transparensändamål:

```typescript
interface SewageSourceTracing {
  source: 'GEMINI_AI' | 'SGU' | 'LANTMATERIET' | 'NATURVARDSVERK' | 'LOCAL_RULES';
  timestamp: string; // ISO 8601
  version: string; // Law/regulation version
  confidence?: number; // 0-100 for AI-generated
}
```

---

## 🗂️ DATATYPES

### SewageApplication (Huvudobjekt)

```typescript
interface SewageApplication {
  id: string;
  projectId: string;
  propertyDesignation: string;
  pe: number; // 1-200
  selectedSystemType: SewageSystemTypeId;
  protectionProfile: SewageProtectionProfile;

  // Soil test
  soilTestCompleted: boolean;
  ltar?: number; // mm/h

  // Neighbor consent
  neighborConsentRequired: boolean;
  neighborConsentObtained?: boolean;

  // Documents
  situationPlan?: { url: string; generatedDate: string };
  crossSection?: { url: string; generatedDate: string };

  // Status
  status: 'DRAFT' | 'UNDER_REVIEW' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  currentGates: Gate[];

  createdAt: string;
  updatedAt: string;
}
```

### SewageRequirement (Auto-genererad)

```typescript
interface SewageRequirement {
  id: string;
  category: 'DESIGN' | 'DISTANCE' | 'SOIL' | 'NEIGHBOR' | 'DOCUMENT';
  requirement: string;
  reason: string;
  status: 'DRAFT' | 'REVIEW' | 'COMPLETED' | 'BLOCKED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  applicableTo: SewageSystemTypeId[];
  relatedMunicipalCode?: string;
  blockingFactor?: string; // Why it's blocked
  sourceTracing: SewageSourceTracing;
}
```

---

## 🚀 API-ENDPOINTS

| Metod | Endpoint                                              | Syfte                        |
| ----- | ----------------------------------------------------- | ---------------------------- |
| POST  | `/api/sewage/application/create`                      | Skapa ny ansökan             |
| POST  | `/api/sewage/application/:id/requirements`            | Generera juridisk checklista |
| POST  | `/api/sewage/application/:id/validate`                | Validera ansökan             |
| POST  | `/api/sewage/application/:id/generate-documents`      | Generera PDF/SVG             |
| POST  | `/api/sewage/application/:id/update-soil-test`        | Registrera markundersökning  |
| POST  | `/api/sewage/application/:id/record-neighbor-consent` | Registrera grannemedgivande  |
| POST  | `/api/sewage/application/:id/submit`                  | Skicka till kommun           |
| GET   | `/api/sewage/application/:id`                         | Hämta ansökningsstatus       |

---

## ✅ STATUS & NÄSTA STEG

| Komponent            | Status  | Fil                                 |
| -------------------- | ------- | ----------------------------------- |
| **Backend Services** | ✅ Done | `sewageRegulationsService.ts`       |
|                      | ✅ Done | `sewageApplicationService.ts`       |
|                      | ✅ Done | `sewageDocumentGeneratorService.ts` |
| **API Routes**       | ✅ Done | `admin.sewage-application.ts`       |
| **UI Components**    | ✅ Done | `SewagePortalView.tsx`              |
|                      | ✅ Done | `SewageSystemSelector.tsx`          |
|                      | ✅ Done | `SewageRequirementChecklist.tsx`    |
|                      | ✅ Done | `SewageRiskPanel.tsx`               |
|                      | ✅ Done | `SewageMapView.tsx`                 |
|                      | ✅ Done | `SewageApplicationSummary.tsx`      |
| **Hooks**            | ✅ Done | `useSewageApplicationGenerator.ts`  |
| **Integration**      | 📋 TODO | Import i `hooks/index.ts`           |
|                      | 📋 TODO | Lägg till route i `createApp.ts`    |
|                      | 📋 TODO | E2E-testning                        |

---

## 📚 JURIDISKA REFERENSER

1. **Miljöbalken (1998:808)**
   - Kap 32: Privatbrunnar, toaletter och avloppsanordningar
   - Länk: https://www.riksdagen.se/sv/dokument-lagar/dokument/svensk-forfattningssamling/miljobalk-1998808_sfs-1998-808

2. **Naturvårdsverkets allmänna råd (NFS 2016:16)**
   - Enskilt avlopp
   - Länk: https://www.naturvardsverket.se/Om-oss/publikationer/ISBN-591-620-096-1/

3. **Vattendirektivet (2000/60/EG)**
   - Upprättande av en ram för gemenskapens vattenåtgärder
   - Länk: https://eur-lex.europa.eu/legal-content/SV/TXT/?uri=CELEX:32000L0060

4. **Bassinbadsdirektivet (91/271/EEG)**
   - Behandling av kommunalt avloppsvatten
   - Länk: https://eur-lex.europa.eu/legal-content/SV/TXT/?uri=CELEX:31991L0271

5. **Mark- och miljödomstolspraxis**
   - Dom MÖD 2018:38 (infiltrationssystems efektivitet)
   - Se Mark- och miljödomstolens webbplats

6. **Länstyrelses lokala riktlinjer**
   - Varierar per fylke – kontakta lokal länstyrelse

---

## 🎯 ANVÄNDARVÄRDE

För privatpersonen innebär detta:

✅ **Snabbar beslutsprocess** – Vet inom minuter vilka system som är lämpliga
✅ **Juridisk transparens** – AI visar vilka lagar som tillämpas och varför
✅ **Geografisk klarhet** – Ser brunnsavstånden på kartan
✅ **Kostnadsclaritet** – Vet exakt kostnad för hennes PE
✅ **Framtidssäkerhet** – Gates säkrar att allt är på plats innan inskickning
✅ **Minskat kompleteringsöverbask** – Färdiga dokument som kommunen förväntar sig
✅ **Källspårning** – Kan visa revisorer exakt vilka data som användes

---

## 🔒 REGELVERKSBESLUT (Audit Trail)

Varje beslut i systemet är loggat med:

- **Vilka regler** som tillämpades
- **Vilka GIS-data** som användes
- **Vilken version** av regel/myndighet
- **Tidsstämpel** för varje förändring
- **AI-konfidens** (för AI-genererad data)

Exempel:

```
[2026-04-02T10:30:00] Gate: gate-SEWAGE_PROTECTION_LEVEL
[SOURCE] SGU Jordartskarta v2024 (confidence: 95%)
[SOURCE] Naturvårdsverket VISS-databasen (version: 2024)
[DECISION] Högt skyddad område → BDTA obligatorisk
```

---

## 📞 SUPPORT & FELSÖKNING

**Fråga:** Systemet säger att mitt system är blockerat
**Svar:** Se `blockedSystems` i GIS-analysen. Vanliga orsaker:

- Avstånd till brunn < 50m → Grannemedgivande behövs
- Högt skyddad område → Endast BDTA/Tank tillåtet
- Låg infiltrationskapacitet → Markbädd ej lämplig

**Fråga:** Hur mäts PE?
**Svar:** 1 PE = 1 persons avloppsbelastning per dag. 1 person = 1 PE. Beräkna baserat på antal invånare som systemet behöver hantera.

**Fråga:** Vad är LTAR?
**Svar:** Loading Rate i kg/m²/år (från perkolationsprov TB145). Bestämmer systemets infiltrationskapacitet.
