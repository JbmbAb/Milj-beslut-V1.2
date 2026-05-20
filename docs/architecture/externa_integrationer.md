# Externa API- och GIS-integrationer

Miljobeslut.se är byggt för att vara ett centralt nav för svensk miljöintelligence. Plattformen aggregerar data från en mängd olika nationella källor via både GIS-tjänster och REST-API:er.

## 1. Geografiska Informationssystem (GIS) & Fastighetsdata

Systemet använder professionella GIS-tjänster för att ge en exakt bild av fastigheter och dess omgivning.

- **Lantmäteriet (Maps & Properties)**:
  - **OGC Features API**: Används för att hämta vektordata för fastighetsgränser (`registerenhetsomradesytor`). Detta gör det möjligt att visuellt markera det område som en C-anmälan berör.
  - **WMS/WMTS (Topowebb)**: Fungerar som bakgrundskarta i systemets kartvy, vilket ger handläggaren en bekant orientering.
  - **Direktåtkomst V2.1**: Möjliggör direktuppslag på fastighetsbeteckningar för att verifiera ägarförhållanden och lagfarter.
- **SGU (Sveriges Geologiska Undersökning)**:
  - **WMS Brunnar**: Integrerad vy för att visa registrerade brunnar och grundvattenkällor i närheten av ett projekt, vilket är kritiskt för riskbedömning av lakvatten.
- **MSB (Myndigheten för Samhällsskydd och Beredskap)**:
  - **WMS Översvämning**: Används för att identifiera om en planerad verksamhet ligger i en riskzon för översvämning eller extrema vattenflöden.

## 2. Biologisk Mångfald & Artskydd

För att automatisera kontrollen av artskyddsförordningen integrerar vi med Sveriges främsta källa för artdata.

- **SLU Artdatabanken**:
  - **Species Observations API**: Automatiserad sökning efter fridlysta eller rödlistade arter inom projektets geografi.
  - **Artfakta & Taxonomi API**: Verifiering av vetenskapliga namn och hämtning av skyddsföreskrifter för specifika arter som identifierats i närområdet.

## 3. Miljö- och Myndighetsdata

Plattformen "pingar" och aggregerar data från myndighetsportaler för att ge en 360-graders vy av det regulatoriska landskapet.

- **Naturvårdsverket**: Integration med deras öppna dataportal för att hämta data om naturreservat, vattenskyddsområden och Natura 2000-områden.
- **Länsstyrelsen (SMP)**: Koppling mot Svenska Miljörapporteringsportalen för att se historiska rapporter och tidigare tillsynsärenden.
- **SMHI**: Metfcst API används för att hämta lokala väderdata, vilket är relevant vid beräkning av t.ex. dammspridning eller dagvattenflöden.

## 4. Infrastruktur och Logistik

- **Trafikverket**:
  - **Trafikinfo API**: Används för att hämta data om järnvägsinfrastruktur och vägnät i anslutning till t.ex. en ny återvinningsanläggning.
- **RAÄ (Riksantikvarieämbetet)**: Sökning via `kulturarvsdata.se` för att säkerställa att inga fornlämningar eller kulturhistoriska värden påverkas av verksamheten.

## 5. Systemintegrationer & Verifiering

- **BankID**: För säker autentisering av konsulter och handläggare enligt svensk säkerhetsstandard.
- **Microsoft Graph (Outlook)**: För automatiserad import av beslut och korrespondens direkt från projektets inkorg.
- **SCB (Statistiska Centralbyrån)**: För att hämta demografisk och regional statistik som kan påverka socioekonomiska konsekvensbeskrivningar i en MKB.

---

Sammantaget skapar dessa integrationer ett system där användaren aldrig behöver lämna plattformen för att samla in det underlag som krävs för en komplett miljöprövning.
