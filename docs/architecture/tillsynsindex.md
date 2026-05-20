# Koncept: Tillsynsindex för Miljötillsyn (Regulatory Intelligence)

Detta dokument beskriver metodiken och det strategiska värdet av ett **Tillsynsindex** – ett unikt mått inom svensk miljötillsyn som kvantifierar graden av kravställning och tillsynsomfattning på kommunal nivå.

## 1. Vad är ett Tillsynsindex?

Indexet är ett normaliserat mått (0–1.0) som indikerar hur omfattande tillsynskraven är i en specifik kommun baserat på historiska beslut.

- **Lågt värde (t.ex. 0.2)**: Kommunen har färre standardkrav och ett smalare riskfokus.
- **Högt värde (t.ex. 0.8)**: Kommunen ställer omfattande krav på provtagning, skyddsåtgärder och löpande dokumentation.

## 2. Metodik: De Tre Dimensionerna

Indexet beräknas genom en sammanvägning av tre dimensioner som extraheras via AI ur databasens beslutsmaterial:

### Dimension 1: Kravtäthet (Requirement Density)

Mäter det genomsnittliga antalet unika krav per beslut.

- _Exempel_: Förekomst av krav på provtagning, tätskikt, invallning, bullervallar etc.
- _Logik_: Fler standardiserade krav indikerar en högre tillsynsnivå.

### Dimension 2: Riskbredd (Risk Coverage)

Analyserar vilka riskfaktorer som adresseras i besluten.

- _Kategorier_: Vattenpåverkan, Damm, Buller, Lukt, Vibrationer, Transporter.
- _Logik_: En kommun som analyserar och ställer krav inom fler riskkategorier får ett högre index.

### Dimension 3: Dokumentationsbörda (Compliance Overhead)

Mäter kraven på operatörens löpande rapportering.

- _Exempel_: Krav på journalföring, årliga miljörapporter, egenkontrollprogram.
- _Logik_: Högre krav på administrativ uppföljning ökar indexet.

## 3. Formel och Normalisering

Ett preliminärt index beräknas enligt:
$$Index = \frac{W_{krav} \cdot K + W_{risk} \cdot R + W_{doc} \cdot D}{Normaliseringsfaktor}$$
Där $K, R, D$ är de tre dimensionerna och $W$ är deras respektive viktning. Resultatet normaliseras mellan 0 och 1 för att möjliggöra jämförelse mellan Sveriges 290 kommuner.

## 4. Strategiskt Värde (The Moat)

Att bygga detta index ovanpå 260+ kommuners beslutshistorik skapar en unik marknadsposition:

1.  **Regulatorisk Intelligence**: Företag kan förutse krav och budgetera rätt för skyddsåtgärder innan anmälan skickas in.
2.  **Standardisering**: Möjliggör vetenskapliga studier av regionala skillnader i rättstillämpning (tillsynsvariation).
3.  **Proaktiv Rådgivning**: AI-plattformen kan proaktivt rekommendera specifika skyddsåtgärder om projektet ligger i en kommun med högt tillsynsindex (t.ex. "Nacka kräver ofta tät platta för denna verksamhetstyp").

## 5. Produktifiering

I användargränssnittet visualiseras detta som en **Kommunprofil**:

- **Ranking**: Var i Sverige ligger kommunen i strikthet?
- **Heatmap**: Geografisk visualisering av tillsynstryck.
- **Prediktiv Checklista**: Automatisk generering av checklistor baserat på de vanligaste kraven i den specifika kommunen.
