# Implementeringsbeskrivning: Bank och Finansiell Scoring (Green Finance)

Miljöbeslut.se tillhandahåller ett avancerat ramverk för att kvantifiera miljömässig regelefterlevnad och risk, vilket möjliggör automatiserad bedömning för banker (för t.ex. Gröna lån) och försäkringsbolag.

## 1. Compliance Score (0–100)

Systemets primära mätetal för finansiella institutioner är **Compliance Score**. Detta beräknas dynamiskt i `ExecutiveSummary.tsx` utifrån fyra viktade faktorer:

1.  **Stage-Gates (40%)**: Andel godkända kontrollstationer. En passerad gate innebär att en specifik regulatorisk risk har hanterats.
2.  **Modulberedskap (25%)**: Status på systemets integrationer (t.ex. om LIMS eller logistikmodul är aktiv).
3.  **Verifierade Dokument (20%)**: Andel dokument som genomgått mänsklig kontroll och digital signering.
4.  **Carbon-status (15%)**: Huruvida en klimatberäkning (CO2e) har genomförts och validerats.

## 2. Risk Score Model (LOW / MEDIUM / HIGH)

I `complianceRulesEngine.ts` finns en neuro-symbolisk riskmotor som poängsätter projektets inneboende risk. Denna model används av banker för att prissätta kreditrisk baserat på miljöansvar.

### Värdering av riskfaktorer:
-   **Volym (+1 till +3 poäng)**: Större masshantering innebär högre logistisk och miljömässig risk.
-   **Farligt avfall (+5 poäng)**: Viktas tyngst då det medför strikt juridiskt ansvar och begränsade mottagningsmöjligheter.
-   **Vattenskydd (+3 poäng)**: Geografisk närhet till grundvatten ökar kravet på skyddsåtgärder (invallning, täta plattor).
-   **Dokumentationsbrister (+2 poäng)**: Saknad spårbarhet ökar sannolikheten för sanktionsavgifter.
-   **Lab-överskridanden (+4 poäng)**: Identifierade föroreningar över riktvärden indikerar en direkt miljörisk.

### Nivåindelning för Banker:
-   **LOW (0-2 poäng)**: Standardrisk. Lämplig för automatiserad kreditgivning.
-   **MEDIUM (3-6 poäng)**: Förhöjd risk. Kräver manuell granskning av miljöexpert.
-   **HIGH (7+ poäng)**: Kritisk risk. Projektet kan kräva utökade säkerheter eller nekas finansiering tills åtgärder vidtagits.

## 3. Långivarerapport (Executive Summary)

I gränssnittet finns en dedikerad vy (`mode="reports"`) som sammanfattar detta för externa intressenter. Rapporten innehåller:
-   **Status på Stage-Gates**: Bevis på att lagstadgade grindar passerats.
-   **CO2-avtryck**: Verifierade utsläppssiffror för projektets klimatbudget.
-   **Audit Trail**: En oförvanskad logg över vem som fattat besluten, vilket minskar risken för "Greenwashing".

## 4. Strategiskt värde för Finanssektorn

Genom att erbjuda en objektiv, datadriven scoring-modell transformerar Miljöbeslut.se miljöjuridisk data till finansiella nyckeltal. Detta underlättar implementeringen av **EU-taxonomin** och stärker transparensen i den gröna omställningen.

---

Denna scoring-motor gör det möjligt för banker att inte bara "tro" att ett projekt är hållbart, utan att ha matematiska bevis för det i realtid.
