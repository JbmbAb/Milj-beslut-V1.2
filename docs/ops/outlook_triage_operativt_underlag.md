# Outlook Triage: Operativt Underlag

## 1. Arbetsordning
Syfte: skydda tidskritiska handlingar, hålla handläggardialogen fungerande och bygga en användbar databas för fortsatt analys.

Daglig arbetsordning:

1. Öppna `outlook_email_triage_report.csv` som huvudfil.
2. Filtrera bort uppenbara felträffar först:
   - `SenderEmail` eller `ExternalLinkDomain` som innehåller `westudents`, `cloudfront`, sociala medier eller annan tydlig marknadsföring.
3. Hantera `P1` först.
4. Inom `P1`, prioritera i denna ordning:
   - `ExpiredRisk = TRUE`
   - länkar som inte har laddats ner ännu
   - lösenord eller åtkomstproblem
   - avgiftsärenden
   - uttrycklig återkoppling
5. För varje P1-mejl:
   - öppna länken
   - ladda ner allt lokalt
   - notera kommun, ärende, datum och lokal sökväg
   - svara direkt om avgift eller återkoppling krävs
6. Hantera `P2` efter samma modell men utan akut tidsrisk.
7. Registrera `P3` som informationssvar:
   - inga ärenden
   - hänvisning till annan myndighet
   - autosvar eller rena bekräftelser
8. Uppdatera databasen samma dag:
   - status
   - nästa åtgärd
   - om material är säkrat
   - om svar har skickats
9. Skicka kort tack-/bekräftelsemejl när en handläggare skickat material eller begärt återkoppling.
10. Kör ny triage först när föregående P1-hög är hanterad.

Operativ princip:

- Rädda material först.
- Svara på relationella blockerare därefter.
- Strukturera databasen efter `nästa åtgärd`, inte bara efter lagring.

## 2. Tre mejlmallar

### A. Svar på avgiftsmejl
Hej,

Tack för återkopplingen.

Jag godkänner avgiften enligt ert besked. Om det är möjligt får ni gärna skicka handlingarna digitalt.

Om ni bedömer att begäran behöver avgränsas för att minska omfattningen får ni gärna återkomma med förslag, så anpassar jag den.

Vänliga hälsningar,  
Jimmy Bruce

### B. Svar på fråga om syfte eller återkoppling
Hej,

Tack för ert svar och för att ni återkopplar.

Syftet med arbetet är att analysera hur C-anmälningar för mellanlagring och närliggande avfallshantering hanteras i praktiken i olika kommuner. Målet är att identifiera återkommande krav, vanliga kompletteringspunkter och goda exempel, så att framtida underlag kan bli tydligare och mer kompletta redan från början.

Ambitionen är alltså att bidra till bättre förberedda anmälningar och därmed mer effektiva handläggningsprocesser.

Tack för hjälpen.

Vänliga hälsningar,  
Jimmy Bruce

### C. Standardiserad ny begäran
Hej,

Jag arbetar med en sammanställning av hur C-anmälningar för mellanlagring av avfall och liknande verksamheter hanteras i praktiken i olika kommuner.

Syftet är att bättre förstå vilka tekniska och miljömässiga krav som normalt ställs, exempelvis kring lagringsytor, dagvattenhantering och egenkontroll, samt att identifiera gemensamma mönster som kan bidra till mer kompletta anmälningar och minska behovet av kompletteringar.

Om ni har möjlighet tar jag gärna del av relevanta anmälningar, beslut, förelägganden eller motsvarande handlingar inom detta område. Om begäran behöver avgränsas för att underlätta hanteringen får ni gärna återkomma med förslag.

Tack på förhand för hjälpen.

Vänliga hälsningar,  
Jimmy Bruce

## 3. Slutlig CSV-kolumnlista

### Basidentitet
- `TriageRunId`
- `FolderPath`
- `EntryID`
- `InternetMessageId`
- `ConversationId`
- `ReceivedTime`
- `SenderEmail`
- `SenderDomain`
- `SenderName`
- `Subject`

### Innehåll och struktur
- `HasAttachments`
- `AttachmentCount`
- `AttachmentTypes`
- `LinkCount`
- `ExternalLinkDomain`
- `FirstExternalLink`
- `BodyHash`
- `Keywords`

### Triage och risk
- `NeedsFeedback`
- `FeeMentioned`
- `TimeSensitive`
- `DeadlineDetected`
- `DeadlineDate`
- `ExpiredRisk`
- `PriorityScore`
- `PriorityBucket`
- `CategorySuggestion`

### Nya kolumner som bör till för avvikande mejl
- `ResponseType`
- `IsMunicipalSender`
- `IsBulkMail`
- `PasswordRequired`
- `PasswordReceived`
- `LinkDownloaded`
- `LinkExpiresAt`
- `FeeStatus`
- `RequestedCallback`
- `NoCasesFound`
- `ReferredToAuthority`
- `AckSent`
- `LocalArchivePath`
- `ActionStatus`
- `ActionOwner`
- `NextActionDate`
- `ManualExclude`
- `FalsePositiveReason`
- `ThreadRootId`

### Rekommenderade värden i `ResponseType`
- `material_mottaget`
- `material_via_lank`
- `avgift`
- `aterkoppling_kravs`
- `losenord_kravs`
- `inga_arenden`
- `hanvisning`
- `autosvar`
- `ovrigt`

## 4. Jämförelse av Outlook-CSV:er

Filer som jämförts:

- `C:\Users\jimmy\Desktop\OutlookExport\manifest.csv`
- `C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_report.csv`
- `C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_actionable_2026-03-07T09-29-13.csv`
- `C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_actionable_2026-03-07T09-41-31.csv`

### Faktiska skillnader

`manifest.csv`
- 2838 rader
- 8 kolumner
- rå export/loggnivå

`outlook_email_triage_report.csv`
- 1044 rader
- 25 kolumner
- triagefil med prioritering, länkar, bilagor och riskindikatorer

`outlook_email_triage_actionable_2026-03-07T09-29-13.csv`
- 137 rader
- 25 kolumner

`outlook_email_triage_actionable_2026-03-07T09-41-31.csv`
- 137 rader
- 25 kolumner

Jämförelse mellan de två actionable-filerna:
- samma antal rader
- samma kolumner
- inga skillnader i `EntryID`

Slutsats:
- de två actionable-filerna är i praktiken identiska
- de utgör ingen ny dataversion, bara samma urval exporterad två gånger

### Faktiska observationer i `outlook_email_triage_report.csv`
- `P1`: 529 rader
- `P2`: 79 rader
- `P3`: 436 rader
- `FeeMentioned = TRUE`: 547 rader
- `ExpiredRisk = TRUE`: 515 rader
- `NeedsFeedback = TRUE`: 1 rad

Det finns tydliga felträffar, exempelvis marknadsmejl från `marknad@westudents.se` som klassats som avgiftsrelevanta eftersom ord som `50%` eller datum triggar regeln.

Slutsats:
- nuvarande triage fångar mycket, men överskattar `FeeMentioned` och delvis `TimeSensitive`
- avvikande mejl behöver bättre klassning av avsändartyp och falska positiva träffar

## 5. Saknade kolumner för avvikande mejl

För att hantera avvikande mejl praktiskt saknas framför allt:

- `IsMunicipalSender`
  - skiljer kommunmejl från nyhetsbrev, externa plattformar och ovidkommande mejl
- `IsBulkMail`
  - fångar massutskick och marknadsföring
- `ManualExclude`
  - gör att samma felträff inte måste granskas om igen
- `FalsePositiveReason`
  - dokumenterar varför ett mejl inte är relevant
- `ResponseType`
  - gör arbetsflödet styrbart
- `PasswordRequired`
  - särskiljer verkliga blockerare
- `LinkDownloaded`
  - visar om länkrisk är hanterad
- `FeeStatus`
  - skiljer avgift nämnd från avgift hanterad
- `RequestedCallback`
  - fångar verklig dialog, vilket nuvarande `NeedsFeedback` nästan inte gör
- `ReferredToAuthority`
  - viktigt när kommun hänvisar vidare
- `NoCasesFound`
  - viktigt för täckningsanalys
- `AckSent`
  - för relationsarbete
- `NextActionDate`
  - för daglig prioritering

## 6. Exakt operativ sortering

### Med nuvarande CSV direkt i Excel
1. Filtrera bort:
   - `SenderEmail` som innehåller tydlig marknadsföring
   - `ExternalLinkDomain` med uppenbart irrelevanta domäner
2. Sortera på:
   - `ExpiredRisk` fallande
   - `NeedsFeedback` fallande
   - `FeeMentioned` fallande
   - `LinkCount` fallande
   - `HasAttachments` fallande
   - `DeadlineDate` stigande
   - `ReceivedTime` fallande

### Med förbättrad CSV
1. `ManualExclude = FALSE`
2. `ActionStatus` där `open` kommer först
3. `ResponseType` i denna ordning:
   - `material_via_lank`
   - `losenord_kravs`
   - `avgift`
   - `aterkoppling_kravs`
   - `material_mottaget`
   - `hanvisning`
   - `inga_arenden`
   - `autosvar`
4. `LinkDownloaded` så `FALSE` kommer först
5. `LinkExpiresAt` stigande
6. `NextActionDate` stigande
7. `ReceivedTime` fallande

## 7. Rekommenderad praktisk slutsats

Gör så här nu:

1. Behåll `outlook_email_triage_report.csv` som arbetsfil.
2. Använd actionable-filen bara som snabbkö, inte som huvudregister.
3. Lägg till de saknade kolumnerna i nästa triageversion eller i en arbetskopierad Excel-tabell.
4. Rensa bort felträffar som `westudents` direkt med `ManualExclude`.
5. Prioritera länkar, lösenord, avgifter och återkoppling före all annan klassning.

## 8. Mejlforslag till lansstyrelser

Anvand detta nar syftet ar att fa ut sa relevant material som mojligt med sa liten belastning som mojligt for handlaggaren.

Hej,

Jag arbetar med en sammanstallning av hur C-anmalningar och narliggande tillsynsarenden for mellanlagring, sortering, bearbetning och anvandning av avfall for anlaggningsandamal hanteras i praktiken.

Syftet ar att identifiera vilka tekniska och miljomassiga krav som normalt stalls, exempelvis kring lagringsytor, dagvattenhantering, egenkontroll och forsiktighetsmatt. Ambitionen ar att bidra till tydligare och mer kompletta underlag i framtida arenden och darigenom minska behovet av kompletteringar.

For att minska arbetsinsatsen hos er far ni garna avgransa sokningen till arenden under de senaste 24 manaderna som bedoms mest relevanta for:
- mellanlagring av avfall
- sortering eller mekanisk bearbetning av avfall
- anvandning av avfall for anlaggningsandamal
- tekniska losningar for lagringsytor, tatyta, invallning eller dagvattenhantering

Om handlingarna finns digitalt tar jag garna emot dem via lank eller bilaga. Om min begaran ar for bred far ni garna foresla en mer traffsaker avgransning utifran era register eller arendetyper.

Tack for hjalpen.

Vanliga halsningar,  
Jimmy Bruce

## 9. Mejlforslag till domstolssparet

### A. Mark- och miljoedomstol
Hej,

Jag arbetar med en kartlaggning av hur arenden om mellanlagring, sortering, behandling och anvandning av avfall for anlaggningsandamal hanteras i praktiken, med fokus pa vilka krav som stalls i underlag och beslut.

Jag onskar darfor ta del av avgoranden, domar, beslut eller andra handlingar under de senaste 24 manaderna som ror denna typ av verksamhet, sarskilt dar fragor om lagringsytor, dagvattenhantering, teknisk uppbyggnad eller forsiktighetsmatt behandlats.

Om det underlattar far ni garna avgransa till de mest relevanta avgorandena inom omradet. Om handlingarna redan finns digitalt tar jag garna emot dem via lank eller bilaga.

Tack for hjalpen.

Vanliga halsningar,  
Jimmy Bruce

### B. Mark- och miljooverdomstolen
Hej,

Jag arbetar med en sammanstallning av hur krav i arenden om mellanlagring och narliggande avfallshantering utformas och provas i praktiken. For att komplettera myndighetsmaterialet onskar jag ta del av avgoranden eller andra relevanta handlingar som belyser hur fragor om lagringsytor, tekniska skyddsatgarder, dagvatten eller anvandning av avfall for anlaggningsandamal bedomts.

Om det finns mojlighet tar jag garna del av relevanta avgoranden eller hanvisning till mal/avgoranden under de senaste 24 manaderna. Om ni bedomer att begaran bor avgransas ytterligare far ni garna foresla en traffsakrare avgransning.

Tack for hjalpen.

Vanliga halsningar,  
Jimmy Bruce

## 10. Strategi for maximal datainhamtning med minimal belastning

Princip:
- begar smalt men smart
- be om de mest relevanta arendena, inte allt
- ge mottagaren ratt att foresla avgransning
- acceptera lank, bilaga eller diarienummer

Rekommenderad stegordning:

1. Kommuner
- fokusera pa de kommuner som redan svarat eller visat forstaelse for syftet
- be i forsta hand om beslut, anmalan och tekniska bilagor

2. Lansstyrelser
- anvand dem for oversikt, hanvisningar, overklaganden och kompletterande arenden
- be om diarienummer eller mest relevanta arenden om full sokning blir tung

3. Domstolar
- anvand domstolssparet for praxis, konfliktytor och motiveringar
- det ger hog kvalitet men mindre volym

4. Uppfoljning
- skicka kort tack eller bekräftelse
- fraga bara efter mer material om det finns tydlig relevans

Handlaggarvanliga formuleringar:
- "Om begaran ar for bred far ni garna foresla en mer traffsaker avgransning."
- "Om handlingarna redan finns digitalt tar jag garna emot lank eller bilaga."
- "Om det ar enklare far ni garna skicka diarienummer for de mest relevanta arendena."

Detta minskar belastningen eftersom mottagaren kan:
- valja ut de mest relevanta arendena
- undvika full manuell genomgang av hela diariet
- svara stegvis

## 11. Andra vagar till informationsinhamtning

Anvand dessa parallellt med mejlsparet for att oka traffsakerheten och minska beroendet av individuell handlaggning.

1. Diarier och arendelistor
- be om diarielista for aktuell period for att sedan precisera en andra, smalare begaran
- detta ar ofta mindre betungande an att direkt begara fulla akter

2. Kommunernas e-tjanster och beslutsdatabaser
- vissa kommuner publicerar beslut, protokoll eller kungorelser
- sok pa verksamhetskod, avfall, mellanlagring, anmalan, miljofarlig verksamhet

3. Namndprotokoll och delegationsbeslut
- ger ofta spar till relevanta diarienummer och beslut

4. Domstolsdatabaser och avgorandesok
- bra for att hitta overklagade eller principiellt intressanta arenden

5. Lansstyrelsens och kommunens registratorspar
- om miljohandlaggaren inte har materialet, be registratorn om diarienummer eller formell avgransning

6. Verksamhetsutovare och konsulter
- kan ge anmalningsunderlag, ritningar och tekniska beskrivningar som kompletterar myndighetsakten
- bor anvandas som komplement, inte ersattning for myndighetsmaterial

7. Offentliga upphandlingar, samradshandlingar och planunderlag
- kan ge tekniska beskrivningar av ytor, dagvatten, invallning och materialval

8. Overklaganden och yttranden
- sarskilt vardeffulla for att se vilka fragor som faktiskt blivit tvistiga

## 12. Praktisk rekommendation efter detta

Gor i denna ordning:

1. Fortsatt helgtriage av P1-mejl.
2. Skicka personliga svar dar aterkoppling eller avgift kraver svar.
3. Anvand standardmejlet till nya kommuner och lansstyrelser.
4. Anvand domstolssparet selektivt for praxis och kvalitativa exempel.
5. Begar diarielistor nar full aktbegaran riskerar att bli for tung for mottagaren.
