# 🏛️ Mimers Brunn Archive Policy & Riksarkivet Born-Digital Integration (v2.3)

Detta dokument utgör den officiella och fullständigt integrerade **långtidsarkiveringspolicyn för Mimer (miljobeslut-se-2.0)**. Den synkar plattformens geodata- och dokumentlagring i `GEO_Master_Archive` med **Riksarkivets Data-API för Born-Digital (digitalt infödda handlingar)** samt gällande förvaltningsgemensamma specifikationer (FGS).

---

## 🧭 1. Syfte & Juridiskt Ramverk

Enligt svensk lagstiftning (Arkivlagen SFS 1990:782 samt Miljöbalken SFS 1998:808) måste kommunala tillståndsbeslut, anmälningar och miljökonsekvensbeskrivningar (MKB) bevaras långsiktigt med bibehållen **autenticitet, spårbarhet och sökbarhet**. 

Mimers Brunn fungerar som ett offline-first och suveränt master-arkiv där inga data är beroende av externa molntjänster. Alla genererade underlag för enskilda avlopp, C-anmälningar och lokaliseringsutredningar ska paketeras och lagras enligt denna policy innan de anses vara officiellt arkiverade.

---

## 📦 2. AIP-Paketering (Archival Information Package)

Varje avslutat miljöärende (`SewageApplicationCase` eller `CNotificationMassCase`) ska automatiskt konverteras till ett standardiserat **AIP-paket** i katalogen `GEO_Master_Archive/archive/cases/` under följande struktur:

```
GEO_Master_Archive/archive/cases/[ÄRENDENR]/
├── metadata_fgs.json         # FGS-kompatibel JSON-metadata
├── [ÄRENDENR]_beslut.pdf     # Långtidsbeständig PDF/A-2a handling
├── [ÄRENDENR]_mkb.pdf        # Tillhörande MKB/Rapport i PDF/A
└── geometries/
    └── [ÄRENDENR]_site.gml   # Exporterade PostGIS-geometrier (GML-format)
```

### A. Formatkrav för Dokument (PDF/A-2a)
* Alla beslut och rapporter som genereras av din lokala `docgen_agent` måste skrivas i **PDF/A-2a (ISO 19005-2)** eller **PDF/A-1a**-format.
* Inga externa typsnitt, JavaScript, lösenordsskydd eller externa hyperlänkar är tillåtna i dokumenten, vilket garanterar att de kan läsas omodifierat om 100 år.

### B. Geodata-bevarande i PostGIS (GML/GeoJSON)
* Riksarkivet kräver att geografiska data (t.ex. koordinaterna för ett enskilt avlopps infiltrationsbädd eller schaktmottagningsområde) lagras i öppna XML-baserade GIS-standarder.
* Vid arkivering av ett ärende ska plattformen automatiskt exportera PostGIS-geometrin till **GML (Geography Markup Language)** via följande databasanrop:
  ```sql
  SELECT ST_AsGML(geom, 15, 3) FROM env_registerenhetsomradesytor WHERE id = $1;
  ```
* GML-filen lagras i undermappen `geometries/` i AIP-paketet.

---

## 🔒 3. Kryptografisk Spårbarhet & Verifiering (AuditTrail)

För att möta Riksarkivets Born-Digital-krav på **integritetsbevis** (proof of non-repudiation) integreras bevarandet direkt i din befintliga hashkedja:

1. **SHA-256 Checksummor:** Varje fil i AIP-paketet (PDF/A, GML, metadata) får sin SHA-256-hash beräknad omedelbart efter skapandet.
2. **Kryptografisk registrering:** Checksummorna och filkontexten sparas i Prisma-tabellen `DocumentRecord` och registreras som en ny transaktion i `AuditTrail`.
3. **Oföränderlig hashkedja (chainHash):** Transaktionen hash-kedjas mot den föregående transaktionen med en strikt SHA-256 beräkning:
   $$\text{chainHash}_n = \text{SHA256}(\text{payloadHash}_n + \text{chainHash}_{n-1} + \text{timestamp})$$
4. **Självverifierande metadata:** Den slutgiltiga hash-referensen (`chainHash`) skrivs in direkt i `metadata_fgs.json`-filen inuti AIP-paketet. Detta gör paketet helt självverifierande – vem som helst kan i framtiden bekräfta ärendets autenticitet genom att kontrollera hashkedjan lokalt.

---

## 🚛 4. Geokalkyl & Klimatpåverkan som Historisk Metadata

I linje med den forskning som publicerats i DiVA-portalen (diva2:1871669) angående klimatkalkyler som juridiska beslutsunderlag under Miljöbalken, integreras nu beräkningar från **SGI Geokalkyl** och Chalmers-studien direkt i arkiveringspolicyn:

* Varje genererat tillståndsbeslut eller anmälan för schaktmassor ska ha sitt totala klimatavtryck ($CO_2$-ekvivalenter och energianvändning i kWh beräknat via `GeokalkylService`) sparat direkt i ärendets metadata-fil (`metadata_fgs.json`).
* Detta lagras under nyckeln `klimat_deklaration` i metadataschemat:
  ```json
  "klimat_deklaration": {
    "total_co2_ekvivalent_kg": 4520.5,
    "energianvandning_kwh": 950.0,
    "berakningsgrund": "SGI_GEOK_CHALMERS_v2.3",
    "lagstod": "Miljobalken SFS 1998:808 2 kap. 3 och 5 $$"
  }
  ```
* Detta säkerställer att framtida generationer och utvärderare kan spåra de exakta klimatavvägningar och beräkningar som låg till grund för prövningsbeslutet.

---

### 📚 Referenser & Källor (Harvard-systemet)
* DiVA, 2024. *Klimatkalkyler som beslutsunderlag enligt Miljöbalken*. DiVA-portal, diva2:1871669.
* JbmbAb, 2026. *Milj-beslut-V1.2: prisma/schema.prisma*. GitHub-koddepå. Tillgänglig via personlig autentisering.
* Riksarkivet, 2026. *Born-Digital Data-API – Specifikationer för digitalt födda handlingar*. Sök Riksarkivet. Tillgänglig på: <https://sok.riksarkivet.se/data-api/born-digital>.
* SGI, 2026. *Geokalkyl – Klimat- och kostnadskalkyl för geotekniska åtgärder*. Statens geotekniska institut.
