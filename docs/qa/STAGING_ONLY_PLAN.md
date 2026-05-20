# Staging-Only Plan: Lokaliseringsutredning + C-anmälan + Enskilt avlopp

Detta dokument är bindande för genomförande tills alla tre fokusflöden är verifierade i staging med äkta data och egna beviskedjor.

**Implementeringsplan (faser, API-kontrakt, kodnuläge):** [`MODULE_IMPLEMENTATION_PLAN.md`](./MODULE_IMPLEMENTATION_PLAN.md)

## Direktiv

1. All funktionskörning och godkännande sker i staging.
2. Lokal miljö används enbart för utveckling/debug.
3. Inga mock/demo-lägen i staging.
4. Inga hemligheter i kod eller .env-filer som checkas in.

## Fokusmoduler och egna flöden

1. **Lokaliseringsutredning** — platsval -> geodata -> regel/risk -> beslutsunderlag -> audit trail.
2. **C-anmälan** — projekt/fastighet -> klassning/krav -> underlag -> submission/export -> audit trail.
3. **Enskilt avlopp** — ansökan -> validering -> statusövergångar -> export -> audit trail.

## Implementerat i repo (klart)

1. Staging-only policy i `AGENTS.md`.
2. PR-mall med obligatoriskt staging-bevis i `.github/pull_request_template.md`.
3. PR-gate som blockerar utan bevis i `.github/workflows/staging-proof-gate.yml`.
4. Manuell staging-E2E beviskörning i `.github/workflows/staging-e2e-proof.yml`.
5. Konfigurations- och mock-flaggkontroll: `scripts/smoke/staging-verify.ts` (`npm run smoke:staging-verify`).
6. Basflöde i staging utan BankID: `tests/e2e/staging-core-flows.spec.ts` (`npm run e2e:staging`).
7. E2E-spec för Enskilt avlopp: `tests/e2e/staging-enskilt-avlopp.spec.ts` (`npm run e2e:staging:avlopp`).
8. Kombinerat staging-kommando för automatiserade flöden: `npm run e2e:staging:all` + `npm run staging:verify`.
9. C-anmälan schaktmassor: E2E i `tests/e2e/staging-c-anmalan-mass.spec.ts` (`npm run e2e:staging:c-mass`).
10. C-anmälan kemikalier förblir separat flöde (`CNotificationUI.tsx`).

## Kor nu (operativ checklista)

1. Satt branch protection pa `main/master` med required check: `Staging Proof Gate`.
2. Konfigurera `STAGING_URL` under repository variables.
3. Konfigurera secrets: `STAGING_E2E_ADMIN_USERNAME` och `STAGING_E2E_ADMIN_PASSWORD`.
4. Kor workflow `Staging E2E Proof` i GitHub Actions (med/utan Vertex-floden).
5. Lagg artifact-lankar i PR-faltet "Staging evidence links".
6. Kryssa i staging-checkarna i PR-mallen.
7. Slutför juridisk slutgranskning innan Go/No-Go.

## Delad konfiguration för alla tre flöden

1. Verifiera att staging använder riktiga nycklar för Lantmäteriet, SLU, Trafikverket och VISS där respektive flöde behöver dem.
2. Bekräfta att `BANKID_MOCK_MODE=false` och övriga mock/demo-flaggor är avstängda i staging.
3. Placera SLU-nycklar i secret store, inte i incheckade `.env`-filer:
   - lokalt i `.env`/`.env.local`
   - staging i GitHub/Vercel secrets, normalt `STAGING_SLU_API_KEY`
   - produktion i Google Secret Manager som `SLU_API_KEY` eller `SLU_*_API_KEY`
4. Verifiera auth/session-stabilitet utan loop.

## Eget staging-flöde: Lokaliseringsutredning

1. Kör end-to-end-scenario: platsval -> datainhämtning -> risk/regelutfall -> beslutsunderlag.
2. Verifiera att rapporten inte går vidare med tyst degradering när livekällor saknas.
3. Verifiera PDF/underlagssteg och obligatorisk Human-in-the-loop-text.
4. Verifiera att audit trail skapas för kritiska steg.
5. Dokumentera vilka externa datakällor som faktiskt användes i körningen.

**Minimal Acceptansnivå (API & Status):**
- POST `/api/localization/generate-report` skapar korrekt underlag utifrån geodata.
- POST `/api/localization/generate-pdf-data` returnerar reproducerbar JSON för export.
- Inga degraderade/mockade demodata tillåts vid staging-beslut.
- Status: Platsval -> Geodata inladdad -> Regel/Risk analyserad -> Rapport genererad.

## Eget staging-flöde: C-anmälan

1. Verifiera att ärendet kan skapas med riktig fastighet/geometri och utan demo/fallback.
2. Bekräfta att krav- och klassningssteg körs mot rätt regelunderlag för C-anmälan.
3. Kör underlagsflödet: dokument -> kravbild -> sammanställning -> export/submission.
4. Verifiera att submission- eller exportsteg är spårbart och kopplat till rätt projekt.
5. Verifiera rollbaserad åtkomst och audit trail för hela C-anmälan-flödet.

**Minimal Acceptansnivå (API & Status):**
- endpoints i `cNotificationMass.routes.ts` stödjer full flow: Fastighetssök -> Kodvalidering -> Mellanlagring/Deponi -> Submission.
- Verksamhetskod (MPF + EWC) ska vara strikt tvingande.
- Mellanlagring och deponi hanteras som separata delbeslut i backend.
- Status: Skapad -> Kod validerad -> Kapacitet & Klassning -> Skickad.

## Eget staging-flöde: Enskilt avlopp

1. Verifiera att API-flödet för ansökan fungerar med staging-data utan fallback-mock.
2. Bekräfta statusövergångar (utkast, handläggning, beslut) i staging.
3. Verifiera valideringsregler för obligatoriska fält, koordinater och mottagare.
4. Kör export/underlagssteg och verifiera resultatets spårbarhet.
5. Verifiera rollbaserad åtkomst för admin kontra övriga roller.

**Minimal Acceptansnivå (API & Status):**
- endpoints i `sewage.routes.ts` stödjer create/validate/generate/submit/status/history.
- Export skapar ett pdf-underlag via `sewageDocumentGenerator.ts`.
- Audit trail finns för alla statusövergångar.
- Statusövergångar: Utkast -> Validerad -> Skickad.

## Genomförandeordning

1. Lås miljö till staging-only (policy + ansvarig + tidsfönster).
2. Stäng av mock/demo i staging.
3. Verifiera externa integrationer.
4. Kör Lokaliseringsutredning som eget staging-flöde.
5. Kör C-anmälan som eget staging-flöde.
6. Kör Enskilt avlopp som eget staging-flöde.
7. Dokumentera utfall och avvikelser per modul.
8. Beslut Go/No-Go med teknik + verksamhet + juridik.

## Klar-definition

Samtliga punkter ovan är verifierade i staging och dokumenterade med ansvarig, datum och testresultat per modul.

Human-in-the-loop: juridisk slutgranskning krävs.
