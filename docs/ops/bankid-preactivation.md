# BankID – förberedelser innan avtal och certifikat är klara

Detta underlag beskriver vad som kan göras **nu** utan att slå på skarpt BankID, och vad som måste vänta tills avtal, testcertifikat och produktionscertifikat finns.

## Målbild

- **Lokal utveckling:** BankID-mock får användas.
- **Staging/test:** förbered separat konfiguration för BankID:s testmiljö.
- **Produktion före avtal:** BankID ska vara **avstängt eller oaktiverat**, och admin-/organisationsinloggning används i stället.
- **Produktion efter avtal:** aktivera riktig mTLS-konfiguration och rätt BankID-endpoint.

## Det som kan förberedas redan nu

1. **Konfigurationsstruktur**
   - Bestäm att BankID styrs via:
     - `BANKID_MOCK_MODE=true` för lokal utveckling
     - `BANKID_BASE_URL`
     - `BANKID_PFX_PATH` + `BANKID_PFX_PASSPHRASE`
     - eller `BANKID_CERT_PATH` + `BANKID_KEY_PATH`
     - valfritt `BANKID_CA_PATH`
   - Lägg alla känsliga värden i Secret Manager, inte i repo eller workflow-filer.

2. **Miljöseparation**
   - Förbered tydlig uppdelning mellan:
     - **lokal mock**
     - **BankID testmiljö**
     - **BankID produktion**
   - Återanvänd inte samma certifikat, endpoint eller truststore mellan test och produktion.

3. **Driftpolicy**
   - Kundnära produktion före avtal ska använda admin-/organisationsinloggning.
   - BankID-mock ska inte vara bevis för produktionsberedskap.
   - Om BankID inte är färdigkonfigurerat ska API:t svara med kontrollerat fel, inte ett otydligt certifikatfel.

4. **Drifthemligheter**
   - Förbered Secret Manager-namn och montering för:
     - `BANKID_PFX_PASSPHRASE`
     - certifikatfil/PFX-fil
     - eventuell `BANKID_CA_PATH`
   - Dokumentera vem som äger rotation och förnyelse av BankID-certifikat.

5. **Testplan**
   - Definiera redan nu acceptanskriterier för:
     - initiering
     - collect/polling
     - cancel
     - felkoder vid avbruten signering
     - session efter lyckad autentisering

## BankID:s testmiljö

Förbered följande värden och artefakter för staging/test när leverantörsdelen är klar:

- **RP endpoint (test):** `https://appapi2.test.bankid.com/rp/v5.1`
- Separat **testcertifikat**
- Separat **trust chain / CA**
- **BankID testapp**
- **testidentiteter**

Använd inte produktionsapp, produktionscertifikat eller produktionsidentiteter i staging/test.

## Produktion efter avtal

När avtal är klart aktiveras först:

1. rätt **produktionsendpoint**
2. riktigt **RP-certifikat**
3. PFX-lösenord / PEM-nyckel via Secret Manager
4. korrekt CA/truststore i runtime
5. stagingtest med samma kopplingssätt som produktion

## Rekommenderad ordning

1. Behåll BankID som mock lokalt.
2. Behåll BankID som oaktiverat i kundnära miljö tills avtal finns.
3. Förbered Secret Manager, env-namn och mount points.
4. Lägg in testmiljöns endpoint och certifikat först när testartefakterna är mottagna.
5. Slå på produktion sist, efter verifierad testmiljö.

## Repo-status

I den här koden ska BankID före avtal behandlas som **ej aktiverat** om varken mockläge eller komplett mTLS-konfiguration finns. Då ska användaren hänvisas till administratörsinloggning tills BankID-avtal och certifikat är klara.
