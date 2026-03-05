# Sammanstallning till examensrapport: myndighetskrav for mellanlagringsplattor

Datum: 2026-03-02

## 1. Syfte
Denna sammanstallning ar framtagen for examensrapporten om kravstallan i anmalningsarenden for mellanlagringsplattor, med fokus pa:
1. konstruktionskrav
2. krav pa dagvatten/lakvatten
3. skillnader mellan kommuner, avfallsslag och EWC

## 2. Underlag som redan finns i repo
| Underlag | Fil | Status | Anvandning i rapport |
|---|---|---|---|
| Metodupplagg examensarbete | `examensarbete_mellanlagring_upplagg.md` | Finns | Metodkapitel, fragestallning, avgransning |
| Kravmatris-mall | `kravmatris_mellanlagring_template.csv` | Finns | Huvudmatris for kodning av krav |
| Guide for kodning/kvalitetskontroll | `kravmatris_mellanlagring_guide.md` | Finns | Regler for korrekt ifylld matris |
| C-anmalningsmall med mallkoppling | `mall_c_anmalan_mellanlagringsplatta_v2.md` | Finns | Koppling mellan kravfynd och mallavsnitt |
| Produkt-/API-lage (teknisk mognad) | `docs/qa/product-readiness-checklist.md` | Finns | Kompletterande nulagesbedomning av tjansten |
| Autofylld kravmatris | `kravmatris_mellanlagring_autofylld.csv` | Ska genereras om | Behover genereras innan slutanalys |

## 3. Nulagesbedomning
1. Matrisstrukturen ar klar och anvandbar.
2. Metod och kvalitetsregler ar dokumenterade.
3. Underlag kan extraheras fran databasen via script.
4. Slutlig juridiskt hallbar matris ar inte fardig utan manuell validering mot kallfiler.

## 4. Vad "korrekt ifylld matris" betyder i denna studie
En rad ar korrekt endast om:
1. ett konkret kravcitat finns i `KravtextCitat`
2. tolkning finns i `TolkadKravtext`
3. kravet ar klassat i ratt `Kravkategori`
4. kallsparbarhet finns (`Diarienummer`, `Dokumenttyp`, `Dokumentdatum`, `KallaFil`)
5. koppling till mall ar satt (`Mallavsnitt`, `KommunBlankettFalt`, `BilagaSomStods`)

## 5. Rekommenderad datagang (for rapportfardigt underlag)
1. **Ta bort tidigare kravmatris:** Den gamla filen `kravmatris_mellanlagring_autofylld.csv` ska raderas för att säkerställa att ingen gammal data ligger kvar.
2. Generera ny auto-utkast:
```powershell
npm run kravmatris:auto -- --output=kravmatris_mellanlagring_autofylld.csv
```
2. Manuell validering rad-for-rad mot originaldokument.
3. Markera analysfalten:
`MinimikravJaNej`, `KommunspecifiktJaNej`, `StatusIAnmalan`, `Kommentar`.
4. Las kvalitetskontroll enligt `kravmatris_mellanlagring_guide.md` innan analys.

## 6. Tabeller som ska in i examensrapporten
1. Tabell A: Antal arenden per myndighet (kommun/lansstyrelse).
2. Tabell B: Kravfrekvens per kravkategori.
3. Tabell C: Skillnader mellan kommuner for `Ytkonstruktion` och `DagvattenLakvatten`.
4. Tabell D: Krav per avfallsslag och EWC.

## 7. Klart/Ej klart for rapportunderlaget (nu)
| Punkt | Status | Kommentar |
|---|---|---|
| Metodram for studien | KLAR | Dokumenterad i upplaggfilen |
| Kravmatris med full kolumnstruktur | KLAR | CSV-template finns |
| Kodningsregler + kvalitetskontroll | KLAR | Guide finns |
| Automatisk extraktion fran DB | KLAR | Script finns |
| Ifylld verifierad matris med verkliga arenden | EJ_KLAR | Auto-fil saknas och manuell validering aterstar |
| Slutliga resultattabeller till rapport | EJ_KLAR | Byggs nar verifierad matris ar klar |

## 8. Kort slutsats
Det finns tillrackligt underlag i repot for att sammanstalla en fardig examensrapport, men den avgorande mellanfasen ar att skapa och manuellt validera den ifyllda kravmatrisen. Nar det steget ar gjort kan resultat-, diskussions- och slutsatskapitel fyllas med full sparbarhet.
