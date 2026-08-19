# Gap Report — Harvest Governance Pipeline (`mps-data-governance` / `mps-core`)

**Typ:** Read-only granskning, inte en ADR. Ingen kod ändrad.
**Datum:** 2026-08-10
**Uppdrag:** Avgöra om Source Registry → Loke-kedjan redan är byggd innan ny kod skrivs,
och specifikt utreda hur `national-registry.json` kan innehålla `approved_by: Heimdall /
GOVERNOR` trots att `GOVERNOR` inte finns i den kanoniska `ActorRole`-modellen.
**Metod:** Läste `packages/mps-data-governance/**` (alla 13 src-filer, alla 8 testfiler),
`packages/mps-core/src/{types,identity,errors,references}.ts`, `validateRegistry.ts`,
repo-brett grep för faktisk användning, och befintliga ADR:er. Ingen körning (sandbox
saknar nätverk; `npx tsx` fungerar inte i denna miljö p.g.a. Windows/Linux
esbuild-binärmismatch — se tidigare fynd).

---

## 1. Vad som faktiskt är implementerat (riktig, körbar kod)

- **Tier 1–3 artefaktscheman** (`SourceRegistry.ts`, `RawSourceArtifact.ts`,
  `InventoryArtifact.ts`) — kompletta TypeScript-interface, matchar exakt vad
  `national-registry.json` redan använder.
- **`scripts/loke-harvest.ts`** — en verklig, fungerande, enkel harvester. Läser
  `national-registry.json`, itererar alla poster, respekterar `politeness_delay_ms`,
  hämtar, SHA-256-hashar, skriver `RawSourceArtifact`-manifest. Ingen relevansbedömning.
- **`scripts/validateRegistry.ts`** — en verklig validator, men snäv (se §5).
- **`HarvestExecutionStateMachine.ts`** — ren, testad tillståndsmaskin (15 tillstånd,
  `assertTransition`/`isTerminal`). Inga sidoeffekter.
- **`HarvestOrchestrator.ts`** — en fullständig, sofistikerad orkestrerare:
  `CREATED → HARVESTING → HARVESTED → VERIFYING → VERIFIED → AWAITING_APPROVAL →
  [extern resumeWithApproval()] → APPROVED → COMPLIANCE_CHECK → IMPORT_GATE →
  ALLOW_IMPORT/BLOCKED → POSTGIS_PROJECTION → READY_FOR_LU`, med `QUARANTINED` som
  terminalt tillstånd vid otillåtna övergångar (ORCH-007). Detta är riktig, klar kod —
  inte bara ett interface.
- **`ImportGate.ts`** — verklig logik: kräver `approval_artifact`, verifierar att
  `approved_ref` matchar hämtad manifest (`assertContentReferenceMatches`), kräver att
  alla compliance-kontroller passerat, kräver `decision === "APPROVED"`. Skriver signerat
  `ImportGateEvidenceArtifact`.
- **`FileCheckpointStore.ts`** — verklig, diskbaserad persistens (inte en stub):
  `fs.mkdirSync`/`writeFileSync`/`readFileSync` mot
  `<archive>/National_Archive/_quarantine/{checkpoints,approvals}`.
- **`ReplayEngine.ts`** — ren logik som verifierar strukturell lineage-konsistens
  (t.ex. att `AWAITING_APPROVAL` inte har ett `approval_ref` innan det ska finnas).
- **`DocumentOrchestrator.ts`** — en **separat** pipeline (PDF → extraktion →
  klassificering → chunkning → indexering, för "Mimers Brunn"-dokumentkorpusen). Detta är
  den enda delen av paketet som faktiskt används av annan kod i repot (se §2).

## 2. Vad som är kopplat till resten av systemet — och vad som INTE är det

Detta är den viktigaste enskilda upptäckten: **`HarvestOrchestrator`, `ImportGate`,
`DatasetApprovalArtifact` och hela godkännande-tillståndsmaskinen importeras ingenstans
utanför sin egen paketmapp.** Repo-brett grep (exkl. `node_modules`) visar:

- `packages/mps-data-governance` importeras utanför sin egen mapp **endast** av sex
  script i `scripts/import/` (`reconcile-quarantine.ts`,
  `run-document-ingest-batch.ts`, `run-document-ingest-recovery.ts`,
  `seed-single-pdf-document.ts`, `seed-single-master-document.ts`,
  `verify-cold-start-replay.ts`) — och **alla sex** importerar bara
  `DocumentOrchestrator`/`DocumentOrchestratorTypes`, aldrig `HarvestOrchestrator`,
  `ImportGate` eller `DatasetApprovalArtifact`.
- `server/**` refererar `mps-data-governance` **noll gånger**.
- `npm run` har `loke:harvest` och `registry:validate` (paketets `package.json`), men
  **ingen** kommando som kör `HarvestOrchestrator`.

**Slutsats:** Godkännande-tillståndsmaskinen (steg 2–7 i din ursprungliga pipeline-skiss)
är fullt implementerad och väl testad **i isolering**, men är en död kodväg — ingenting i
produktionssystemet anropar den. Det enda som faktiskt körs mot `national-registry.json`
idag är `loke-harvest.ts` (ingen godkännandekontroll alls, litar blint på registret) och
`validateRegistry.ts` (kontrollerar inte godkännandet, se §5). **Åtta-stegs-pipelinen som
diskuterats existerar delvis som kod, men noll procent av den är faktiskt i drift.**

## 3. Vad som endast är interface (inget implementerat bakom)

- **`GovernanceReviewAwaiter.pollApproval()`** (`HarvestOrchestratorContracts.ts`) — typ
  finns, ingen konkret implementation hittad någonstans i repot. Det finns alltså inget
  kodat svar på "vem/vad pollar för godkännande och hur".
- **`HarvestExecutor`, `VerificationExecutor`, `ComplianceRunner`, `ProjectionExecutor`,
  `LURuntimeInitializer`** — alla interface som `HarvestOrchestrator` tar in via
  constructor-injection. Inga konkreta implementationer hittade i `src/`. Testerna
  (`HarvestOrchestrator.test.ts` m.fl.) injicerar mockar, inte riktiga implementationer.
  Det betyder: orkestreraren är bevisligen korrekt **som tillståndsmaskin**, men det finns
  ingen känd, riktig kod som faktiskt utför harvesting/verifiering/compliance/projektion
  inom detta ramverk. `loke-harvest.ts` är inte skriven mot `HarvestExecutor`-interfacet.

## 4. Vad som är testat

Åtta testfiler i `packages/mps-data-governance/tests/`, alla läsbara och (baserat på
innehåll) meningsfulla — state machine happy path, ORCH-007 karantän-på-otillåten-övergång,
verifieringsfel → QUARANTINED, compliance-fel → BLOCKED, extern ARCHIVED, ReplayEngine
lineage-konsistens (positiva och negativa fall), `ImportGate` saknad-godkännande-blockering,
hash/signatur-bindningsregression, samt Tier 1–4-artefaktformsmoke-tester.

**Kritiskt: inget test kontrollerar `actor_ref.role`, `ActorRole`-giltighet, eller vem som
är behörig att godkänna.** Grep av alla 8 testfiler för
`GOVERNANCE_REVIEWER|actor_ref\.role|ActorRole|Heimdall|GOVERNOR` gav 4 träffar, samtliga
i fixture-data (testinput), noll i assertions. Specifikt:
- `TierSchemas.test.ts:24` använder `role: 'GOVERNOR'` (ogiltig roll) som fixture utan att
  någon typkontroll eller assertion slår larm.
- `Orch007QuarantinePersistence.test.ts:101` kontrollerar bara att en hårdkodad textsträng
  `governance_role: "GOVERNANCE_REVIEWER"` skrevs till en karantänpost — det är en etikett
  om vem som *borde* granska, inte en kontroll av vem som *faktiskt* godkände något.

**Slutsats: rollbaserad behörighetskontroll är obevisad by design.** Ingen befintlig test
skulle fallera om ett godkännande accepterades från en aktör utan giltig roll, eller utan
roll alls.

## 5. Det konkreta, tekniska svaret på "varför kan Heimdall/GOVERNOR existera?"

Tre oberoende luckor, var för sig tillräcklig, tillsammans totala:

1. **`validateRegistry.ts` (rad 17–36) kontrollerar bara tre fält:** `artifact_type`,
   `endpoint.url`, `endpoint.policy.rate_limit_requests_per_second`. Den läser eller
   validerar aldrig `approved_by`, `content_hash`, eller `signature`. En post utan
   godkännande alls skulle också passera denna validator.
2. **`FileCheckpointStore.loadApproval()` (rad 70–79) litar blint på filinnehållet:**
   den läser en JSON-fil från disk via `artifact_id` och gör `JSON.parse()` — utan att
   verifiera signatur, kontrollera `actor_ref.role` mot `ActorRole`-enumen, eller ens
   kontrollera att fältet finns. Vem som helst med skrivbehörighet till
   `_quarantine/approvals/` kan lägga en fil där med vilken `role`-sträng som helst
   (inklusive `"GOVERNOR"`) och få den accepterad som ett giltigt godkännande.
3. **`ImportGate.evaluate()` (`ImportGate.ts` rad 59–127) inspekterar aldrig
   `approval_artifact.actor_ref.role`.** Den kontrollerar att godkännandet finns, att det
   pekar på rätt manifest, att compliance passerat, och att `decision === "APPROVED"` —
   men aldrig vem som satte det beslutet eller om den personen hade rätt roll.

**Signering ≠ behörighet.** `ArtifactIdentityBuilder`/`createSignedArtifactIdentity`
(`mps-core/src/identity.ts`) signerar `content_hash` — det bevisar att artefakten inte
manipulerats efter skapande, men bevisar ingenting om att skaparen hade rätt att skapa den.
`GovernanceIntegrityViolation` (`mps-core/src/errors.ts:54`) är en tom subklass utan egen
kontrollogik — den är bara en typad exception som anropare kastar manuellt.

**Med andra ord: `"Heimdall"`/`"GOVERNOR"` i `national-registry.json` är varken förbjudet
eller möjliggjort av ett specifikt beslut — det är bara aldrig kontrollerat, på tre olika
nivåer samtidigt.** Det förklarar också varför `"GOVERNOR"` (inte i `ActorRole`-enumen)
kunde skrivas in utan att något verktyg protesterade: inget verktyg tittar på det fältet.

## 6. Kontrakt som bryter mot varandra

| A | B | Konflikt |
|---|---|---|
| `mps-core/src/types.ts` `ActorRole` enum (4 roller, ingen `GOVERNOR`) | `national-registry.json` (`role: "GOVERNOR"`, 3 poster) | Datainstans matchar inte typkontraktet den påstår sig följa |
| `CanonicalArtifact` kräver `content_hash` + `signature` på alla artefakter | `national-registry.json`-posterna saknar båda fälten | De tre "godkända" posterna är inte giltiga `CanonicalArtifact`/`SourceRegistryArtifact`-instanser enligt paketets egna typer |
| `ActorReference.identity_ref` ska vara en resolvbar `ContentReference` | `national-registry.json` `approved_by.actor_id` är fri text (`"Heimdall"`) | Samma typkonflikt som ovan, konkretiserad |
| `HarvestOrchestrator`/`ImportGate` existerar som den enda kodade governance-grinden för harvesting | `loke-harvest.ts` (det enda script som faktiskt körs mot registret) går förbi hela den grinden | Två parallella "sanna" vägar till samma resultat — exakt det mönster som skapade det ursprungliga misstaget med de fem karantänsatta scripten, fast redan inbyggt i den kanoniska koden själv |
| `DocumentOrchestrator.ts` importerar `prisma` direkt (`server/db/prisma`) från ett paket som i övrigt är rent domänkod | Övriga filer i `mps-data-governance` har inga produktions-DB-beroenden | Inkonsekvent kopplingsgrad inom samma paket — oklart om `mps-data-governance` är tänkt vara ren domänkod eller infrastrukturkod |

## 7. Vad som krävs för att göra befintlig implementation korrekt (inte en ny)

1. Lägg till en `role`-kontroll i `ImportGate.evaluate()` (eller i `loadApproval()`) som
   avvisar allt `approval_artifact.actor_ref.role !== "GOVERNANCE_REVIEWER"`.
2. Gör `FileCheckpointStore.loadApproval()` verifiera signaturen på den inlästa
   `DatasetApprovalArtifact` innan den returneras (inte bara `JSON.parse`).
3. Utöka `validateRegistry.ts` till att faktiskt validera `approved_by.role` (mot
   `ActorRole`-enumen — vilket kräver att antingen enumen utökas med en roll för detta
   syfte, eller att `GOVERNANCE_REVIEWER` blir den formella termen och `national-registry.json`
   uppdateras till att använda den), samt `content_hash`/`signature`-närvaro.
4. Migrera de tre befintliga `national-registry.json`-posterna till att uppfylla
   kontraktet (rätt roll, `identity_ref`, `content_hash`, `signature`) — eller
   dokumentera explicit att de är historiska undantag och frysa nya poster till att kräva
   fullt kontrakt.
5. Bestäm om `loke-harvest.ts` ska skrivas om för att gå igenom `HarvestOrchestrator`
   (så att en enda governance-väg finns), eller om `HarvestOrchestrator`
   /`ImportGate`-vägen ska avvecklas till förmån för den enkla scriptet plus ett enklare
   godkännandelager. Att ha båda vidare, oanvänt kvar, är i sig en risk (nästa
   agent/utvecklare kan råka bygga mot fel väg, precis som hände denna session).
6. Implementera en konkret `GovernanceReviewAwaiter` eller ta bort interfacet om det
   inte är avsett att användas.
7. Reda ut `DocumentOrchestrator.ts`s direkta Prisma-beroende mot paketets i övrigt rena
   domänmodell — antingen är `mps-data-governance` domänkod (då hör DB-anrop inte hemma
   där) eller så är gränsen redan avsiktligt suddig (då bör det dokumenteras).

## 8. Filer som nu är redundanta och bör tas bort/kvarstå karantänsatta

De fem tidigare skrivna filerna denna session är **inte bara oauktoriserade** (som
tidigare konstaterat) — de är en sämre, kontraktsbrytande dubblett av kod som redan fanns:

- `scripts/import/harvest-sfs-all.ts`
- `scripts/import/harvest-regulatory-all.ts`
- `scripts/import/harvest-municipal-abva-all.ts`
- `scripts/import/harvest-court-decisions-all.ts`
- `scripts/import/run-parallel-harvest.ts`

Rekommendation: behåll dem karantänsatta (redan gjort, `⛔ QUARANTINED`-header + kastar vid
körning) som bevis i denna session, men de bör **inte** vidareutvecklas under några
omständigheter — `scripts/loke-harvest.ts` gör redan jobbet, kontraktsenligt, för allt som
faktiskt finns i `national-registry.json`. Borttagning kräver ditt godkännande (se
`allow_cowork_file_delete`-mönstret som redan använts i denna session) — jag har inte
tagit bort dem utan att fråga.

## 9. Vad som INTE är fryst / vad som är oklart

- Ingen ADR hittad som formellt fryser `packages/mps-data-governance`s
  Harvest-orkestrerare som "det enda sanna sättet att harvesta" — bara `ADR-042`
  (Mimers Brunn v9, CAS/WORM-nivå) och min egen `ADR-DRAFT-Source-Registry-Pipeline.md`
  (status: DRAFT, inte antagen).
  `docs/architecture/import-librarian-only-policy.md` fryser ett *annat* mönster
  (librarian-only writes till PostGIS) som `GovernedWriteCapability.ts` mäter — inte
  harvest-godkännande.
- Alltså: även "den befintliga arkitekturen" har inte formellt status **Accepted** för
  just harvest-governance-delen. Den är byggd och testad, men inte förklarad obligatorisk
  av ett antaget beslut. Det är en lucka i sig — att koda något grundligt är inte samma sak
  som att besluta att det ska användas.

---

## URGENT ADDENDUM 2026-08-10 — svar på "kan en icke-auktoriserad nyckel ändå passera?"

Undersökte om något konkret `SignatureVerifier` (mps-core) med trust anchor/nyckelregister
existerar, för att svara på: *kan en giltigt signerad approval med självdeklarerat
`actor_ref.role = "GOVERNANCE_REVIEWER"` ändå passera utan att nyckeln är bunden till en
auktoriserad reviewer?* **Svaret är ja — och det är värre än hypotetiskt: det finns redan en
skarp, oautentiserad produktionsväg som kringgår hela frågan om roll.**

**Ingen konkret, riktig `SignatureVerifier` hittad.** Grep av hela repot för
implementationer av `mps-core`s `SignatureVerifier`-interface gav bara testfixturer (i
`ImportGate.test.ts` och mina egna PR 2-tester) och en oanvänd, tom stub-klass i
`packages/mps-artifact-store/src/internal/stubs.ts:35` (`class SignatureVerifier { constructor(ctx) {} }`
— implementerar inte ens `verify()`). Samma fils `RepositoryVerifier.verify()` (rad 40) är
hårdkodad `return true` oavsett indata. Inget nyckelregister/trust anchor (`signer_key_id ->
actor identity -> role`) hittades någonstans.

**Allvarligare fynd, utanför `mps-data-governance`:** Sökte efter andra
`DatasetApprovalArtifact`/`QuarantinePromoter`-implementationer (namnkollisioner brukar
avslöja parallell arkitektur i detta repo) och hittade **minst tre till**, utöver den i
`mps-data-governance`:

1. **`packages/mimers-brunn-core/src/governance/DatasetApproval.ts`** — `QuarantinePromoter.promote(quarantineId, approvedBy: string, governanceRelease: string)`.
   `approvedBy` är fri text (kommentaren visar `'jimmy'` som exempel), inget rollbegrepp
   alls. `approval_signature` (rad 83) är `createHash('sha256').update(identitySerialized).digest('hex')`
   — **det är en hash, inte en digital signatur.** Ingen privat nyckel, ingen asymmetrisk
   kryptografi — vem som helst som kan anropa funktionen kan producera en giltig
   "signatur" för valfri identitet de själva konstruerar.

2. **Denna kod är live i produktion.** `server/routes/governance.routes.ts:160-172`
   exponerar `POST /api/governance/quarantine/:id/promote`, monterad utan
   auth-middleware i `server/createApp.ts:185` (`app.use('/api/governance', governanceRouter)`
   — genomsökt hela `createApp.ts` för auth/session/passport/jwt-middleware före denna
   rad: hittade endast CORS-hantering och CSRF-skydd, ingen autentisering). Routen läser
   `approvedBy` direkt från `req.body` (rad 163) och anropar `promoter.promote()` (rad 167)
   utan någon kontroll av vem anroparen är. **Vem som helst som når servern kan promota
   valfri karantänpost till permanent CAS-lagring genom att POST:a `{"approvedBy": "vem som
   helst", "governanceRelease": "vad som helst"}`.**

3. **`packages/mps-lu/src/loke/QuarantinePromoter.ts`** — en fjärde variant, ännu enklare:
   `promote()` har inget godkännande-koncept alls, bara en hash-integritetskontroll
   (rad 22-26) innan direkt promotion till CAS.

**Svar på frågan, konkret:** Ja — och det gäller inte bara ett hypotetiskt scenario där
någon konstruerar en JSON-fil med rätt fält. Det finns en oautentiserad, monterad,
produktionsnående HTTP-endpoint som kringgår rollfrågan helt, med en icke-kryptografisk
pseudo-signatur, i en helt annan del av kodbasen än `mps-data-governance`.

### CONTAINMENT APPLIED 2026-08-10

`server/routes/governance.routes.ts`: `POST /quarantine/:id/promote` och
`POST /quarantine/:id/reject` kräver nu `requireAuth` (existerande JWT-bearer-middleware,
`server/security/auth.ts`) + `role === 'ADMIN'` (fail closed, 403 annars) +
`rateLimitByUser`. `approvedBy` läses inte längre från `req.body` — den härleds nu från
`req.authUser.id` (den autentiserade principalens id). Detta stänger den oautentiserade
skrivvägen. Det löste vid skrivtillfället INTE C (SHA-256-as-signature i
`QuarantinePromoter.promote()`) eller D (promotion bunden till ett verifierat
approval-artifact-kontrakt) — de var då kvarstående, separat governance-remediation, per
beslut. **Uppdatering 2026-08-11: C och D är nu åtgärdade av Level 2 (se "LEVEL 2
IMPLEMENTERAD" nedan), PROVEN på Windows.** Övriga routes i denna fil
(`/session/*`, `/quarantine/candidates`, `/stats`, `/cas/artifact/:hash`) är fortfarande
oautentiserade — medvetet utanför scope för denna minimala containment-PR; `candidates`/
`stats`/`cas/artifact` är läsvägar (informationsläckage, inte skrivvägen som var fyndet),
men bör bedömas separat.

**Per din egen beslutsregel:** PR 3 ska alltså inte vara `validateRegistry.ts`. Men detta
fynd är dessutom **inte samma sak som "signer-to-authority binding i mps-data-governance"**
— det är en separat, redan-live sårbarhet i en annan (fjärde!) governance-implementation.
`mps-data-governance`s orkestrerare är enligt tidigare avsnitt i denna rapport bevisligen
**inte** kopplad till produktion; `mimers-brunn-core`s `QuarantinePromoter` **är** det, via
en oskyddad HTTP-route med skrivrätt till permanent lagring. Detta bör troligen behandlas
som en egen, mer akut fråga snarare än att bara skjutas in som "PR 3" i samma sekvens som
PR 1/PR 2 — ingen kodändring gjord här, detta är enbart research/rapportering.

## READ-ONLY INVESTIGATION 2026-08-10 — minimal trust-chain-remediation för C/D

Uppdrag: hitta exakt minsta ändring som binder `QuarantinePromoter.promote()`s "approval"
kryptografiskt till en auktoriserad principal, utan att uppfinna en ny mekanism. Ingen kod
ändrad i detta avsnitt.

**Vad som redan finns och är riktigt (återanvändbart):**

- `packages/mimers-brunn-core/src/signing/SigningProvider.ts` — `LocalPemSigningKeyProvider`:
  **verklig** Ed25519 sign/verify via node:crypto (`generateKeyPairSync('ed25519')`, `sign`/
  `verify`). Inte en stub. Kommentaren säger uttryckligen "Production: GCP KMS / HSM bakom
  samma interface" — produktionsvägen är redan skisserad, bara inte kopplad hit.
- `packages/mimers-brunn-core/src/signing/attestation.ts` — `createArtifactAttestation()` /
  `verifyArtifactAttestation()`: en färdig, "SLSA-inspired" attestation över en
  subject-digest + predicate, domänseparerad (`ATTESTATION_DOMAIN`), matchar ADR-042:s eget
  P1E-leveransmål exakt.
- **Detta är redan i produktion**, om än inte för denna route: `server/artifact/
  signingKeyProvider.ts` re-exporterar `LocalPemSigningKeyProvider` med kommentaren "Prefer
  @miljobeslut/mimers-brunn-core LocalPemSigningKeyProvider for new code", och
  `server/mimers/migrateArtifactStoreToCas.ts` använder attestation-modulen på riktigt.
- `server/artifact/ApprovalRecord.ts` — `ApprovalRecord` (ADR-042 "locked" WORM-kontrakt):
  strukturerad, content-hash-identifierad post. **Men `decidedBy: string` är fortfarande
  bara ett strängfält här också** — samma mönster som `approvedBy` var innan
  containment-PR:n. Denna fil löser inte autenticitetsfrågan ensam; den behöver kombineras
  med ett redan-autentiserat anrop (exakt som containment-PR:n redan gör för HTTP-lagret).
- `req.authUser` (`server/security/auth.ts`) är redan en verklig trust-rot: HMAC-signerad
  JWT, revocation-kontrollerad, med `role`. Detta är inte en ny mekanism att bygga — det är
  redan där och redan verifierat innan `governance.routes.ts` når `promoter.promote()`.

**Vad som INTE ska användas för detta ännu (separat fynd, inte en lösning):**

`packages/mps-governance/src/**` — ett helt, ambitiöst ramverk med `ActorArtifact`,
`TrustAnchorArtifact`, `TrustDelegationArtifact`, `TrustDomainArtifact`,
`CapabilityGrantArtifact`, `GovernanceEngine`, `GovernancePolicyEngine` m.fl. — ser ut som
exakt det "signer_key_id -> actor identity -> authorized role"-registret som efterfrågas.
**Men repo-brett grep visar att paketet bara importeras av `packages/mps-compliance`s egna
tester/validators — aldrig av `server/` eller någon live route.** Samma mönster som
`mps-data-governance`: välbyggt, testat i isolering, inte kopplat till produktion. Att
basera remediationen på detta paket nu vore att upprepa exakt det ursprungliga misstaget —
det kräver sin egen läsbara granskning (motsvarande denna rapport) innan det kan lita på.
Flaggas som eget spår under "Arkitekturkonvergens", inte en byggsten för denna fix.

**Föreslagen exakt minimal remediation (INTE implementerad — väntar på godkännande):**

1. En (1) server-hållen `LocalPemSigningKeyProvider`-instans, nyckelmaterial från env
   (motsvarande hur `JWT_ACCESS_SECRET` redan hanteras) — inte per-reviewer-nycklar, inte
   ett nytt register. Trust anchor = "servern har den enda giltiga privata nyckeln",
   samma förtroendemodell som redan gäller för JWT-signering idag.
2. Inne i `governance.routes.ts`s redan `requireAuth`+`ADMIN`-skyddade promote-handler:
   bygg en `ArtifactAttestation` via `createArtifactAttestation()` **server-side, efter**
   rollkontrollen — `predicate` innehåller `{ quarantine_id, decided_by: req.authUser.id,
   role: req.authUser.role, governance_release }`. Klienten skickar aldrig attestationen;
   servern konstruerar och signerar den.
3. `QuarantinePromoter.promote()` byter signatur: från `(quarantineId, approvedBy: string,
   governanceRelease: string)` till `(quarantineId, attestation: ArtifactAttestation,
   governanceRelease: string)`. Första raden i `promote()`: `if (!(await
   verifyArtifactAttestation(attestation, signingProvider))) throw ...`. Ingen sträng
   accepteras längre som bevis.
4. Detta stänger exakt den lucka du pekade på: `promoter.promote(id, "jimmy",
   governanceRelease)` blir en typfel OCH, även om någon konstruerar ett objekt som
   *ser ut* som en `ArtifactAttestation`, misslyckas `verifyArtifactAttestation()`
   kryptografiskt utan tillgång till serverns privata nyckel. Direktanrop förbi HTTP-lagret
   (ditt test #4) klarar sig inte längre bara genom att ha rätt formklass.

**Vad detta INTE löser** (medvetet, för att hålla remediationen minimal): per-reviewer-
individuella nycklar/non-repudiation (idag är "servern" signeraren, inte den enskilda
ADMIN-användaren personligen — starkare men dyrare version = koppla varje `AuthUser` till
sin egen nyckel, vilket är vad `mps-governance`s `ActorArtifact`/`TrustAnchorArtifact`
*skulle* kunna ge efter egen granskning), samt nyckelrotation/KMS (kommentaren i
`SigningProvider.ts` pekar redan mot GCP KMS/HSM för produktion, inte gjort här).

### SPEC TIGHTENED 2026-08-10 — godkänd design, EJ implementerad, väntar på Windows-grind

Föregående förslag godkänt i princip, med skärpning: en attestation som bara intygar
"servern säger att Jimmy var ADMIN" räcker inte — den måste kryptografiskt binda den
*exakta* operationen, annars kan en giltig signatur återanvändas i fel sammanhang
(replay/confused-deputy). Nedan är den skärpta specen. **Fortfarande ingen kod ändrad.**
Implementation väntar på att PR 1/2/containment verifieras gröna på Windows — se
`Task #9`/`#10`-status i konversationen, inte i denna fil.

**Tre separata nivåer, för att hålla scope disciplinerat:**

| Nivå | Vad | Status |
|---|---|---|
| 1 | Route containment (JWT + ADMIN + server-derived principal) | ✅ **PROVEN** — Windows: 8/8 (PR 1) |
| 2 | Kryptografisk promotion-authority (denna spec) | ✅ **PROVEN 2026-08-11** — Windows: 7/7 (`governanceRoutes.test.ts`) + 14/14 (`approval.test.ts` + `tv-l1-e2e.test.ts` + `quarantinePromotionAttestation.test.ts`) |
| 3 | Individuell governance-authority (`ActorArtifact`/`TrustAnchor`/`CapabilityGrant`/delegation) | Hör till arkitekturkonvergens-spåret — rörs inte förrän `mps-governance` är auditerat separat |

Baseline vid start av Level 2 (frusen, 2026-08-11, Windows-bevisad): PR 1 (`ImportGate` roll-kontroll) 8/8, PR 2 (signaturverifiering) 5/5, Containment PR (route-auth) 6/6 — samtliga körda och gröna på Windows innan Level 2-koden skrevs.

### LEVEL 2 IMPLEMENTERAD 2026-08-11 — väntar på Windows-bevis (samma disciplin som PR 1/2/containment)

Implementerad exakt enligt specen ovan, ingen avvikelse i sak:

- `packages/mimers-brunn-core/src/governance/DatasetApproval.ts` — `QuarantinePromoter` tar nu
  en tredje constructor-parameter (`SigningKeyProvider`). `promote()`s signatur är
  `(quarantineId, attestation: ArtifactAttestation, governanceRelease)` — `approvedBy: string`
  finns inte längre. Alla 7 bindningskontroller (signatur, signer_key_id, action,
  quarantine_artifact_id, quarantine_content_hash, governance_release, approver-fält närvaro)
  samlas i en array och körs till fullo *innan* en enda gate-kontroll (`checks.find`) — ingen
  CAS-skrivning kan ske efter en delvis lyckad verifiering (explicit acceptanskriterium
  uppfyllt). Ny exporterad `GovernanceAttestationError` för att skilja bindningsfel från övriga
  fel. `DatasetApprovalMetadata.approval_signature` (den missvisande hash-som-signatur) är
  borttaget; ersatt av `attestation: ArtifactAttestation` (den verkliga, verifierade
  kryptografiska bevisningen) + `approver_role`.
- `server/security/governanceSigningKey.ts` (ny fil) — lat, cachead
  `LocalPemSigningKeyProvider` från `GOVERNANCE_SIGNING_PRIVATE_KEY_PEM` /
  `GOVERNANCE_SIGNING_PUBLIC_KEY_PEM` / `GOVERNANCE_SIGNING_KEY_ID`. Separat env-konfiguration
  från `JWT_ACCESS_SECRET`, per den skärpta trust-modell-språket ovan. Fail-closed med tydligt
  felmeddelande om nyckeln saknas — men lat (inte modul-load-tid), så att övriga routes i
  `governance.routes.ts` (`session/*`, `stats`, `cas/artifact`, `quarantine/candidates`) inte
  kraschar om nyckeln inte är konfigurerad.
- `server/routes/governance.routes.ts` — promote-handlern bygger nu `PromotionAttestationPredicate`
  server-side (efter ADMIN-kontrollen), hämtar karantänpostens `content_hash` via
  `quarantineStorage.getMetadata(id)` (ny 404 om posten saknas), signerar via
  `createArtifactAttestation()`, och skickar den signerade attestationen (inte en sträng) till
  `QuarantinePromoter.promote()`. `QuarantinePromoter` konstrueras nu lat (`getPromoter()`) —
  inte som modul-nivå-konstant — eftersom den kräver signeringsnyckeln, som är separat
  env-konfiguration från allt annat denna modul behöver.
- Testtäckning: `tests/unit/mimers/quarantinePromotionAttestation.test.ts` (ny, 9 tester —
  direktanrop förbi HTTP-lagret med saknad/ogiltig attestation, alla 4 begärda negativa
  bindningstester namngivna i specen, replay/determinism-test, plus två extra
  bindningskontroller specens 8-stegslista nämner explicit men som inte var bland de "fyra
  nya": fel signeringsnyckel, saknat approver-fält). `tests/unit/mimers/approval.test.ts` och
  `tests/unit/mimers/tv-l1-e2e.test.ts` uppdaterade till den nya signaturen (samma
  testtäckning som innan, ingen förlust). `tests/unit/governanceRoutes.test.ts` utökad med ett
  404-test och omskriven assertion för att verifiera att routen bygger predikatet server-side
  bundet till den autentiserade principalen, inte request-body.
- Sandbox kan inte köra `vitest` här (samma `@rollup/rollup-linux-x64-gnu`-native-binary-problem
  som tidigare blockerade `npx tsx`/esbuild — inte löst, inte relaterat till denna kod). Kunde
  dock köra en ad hoc `tsc --noEmit` mot exakt de ändrade/nya filerna (root-`tsconfig.json`
  exkluderar annars `server/` och `tests/` helt, så detta har aldrig körts i den vanliga
  `npm run typecheck`): noll nya typfel i någon av de sju berörda filerna. Två typfel fångades
  och fixades under denna verifiering (inte buggar i logiken, men skulle ha blockerat en
  riktig typecheck): `PromotionAttestationPredicate` saknar indexsignatur och är inte
  strukturellt en `Record<string, unknown>` (cast vid alla 4 anropsställen till
  `createArtifactAttestation`), samt en redan existerande (inte av mig introducerad, men nu för
  första gången synlig) `req.params.id: string | string[]`-typning i samma route-fil — fixad
  lokalt i promote-handlern, lämnad orörd i reject-handlern (samma mönster, oförändrad kod,
  utanför scope för denna ändring).
- **PROVEN 2026-08-11 (Windows):** `npx vitest run tests/unit/governanceRoutes.test.ts` → 7/7.
  `npx vitest run tests/unit/mimers/approval.test.ts tests/unit/mimers/tv-l1-e2e.test.ts
  tests/unit/mimers/quarantinePromotionAttestation.test.ts` → 14/14. Testräkningen matchar
  exakt antalet `it(...)`-block skrivna i respektive fil (7 i `governanceRoutes.test.ts`; 3 +
  1 + 10 = 14 i de tre mimers-testfilerna) — inget dolt skip eller tyst no-op.

**Attestationens payload måste minst binda (inte bara "vem"):**

```
action = "quarantine.promote"
quarantine_artifact_id
quarantine_content_hash
approver_actor_id
approver_role
governance_release
attestation_schema_version
signer_key_id
```

Policy/version som stabil identifierare inkluderas om en sådan redan existerar som
verifierbart fält (inte uppfinna en ny bara för detta).

**`QuarantinePromoter.promote()` ska INTE bara anropa `verifyArtifactAttestation()`.**
Ordningen måste vara (varje steg fail-closed, ingen CAS-skrivning förrän alla passerat):

1. Kryptografisk signatur giltig?
2. `signer_key_id` är den förväntade server-/governance-nyckeln (inte vilken giltig nyckel som helst)?
3. `action === "quarantine.promote"` (inte t.ex. en attestation skapad för `reject`)?
4. `quarantine_artifact_id` matchar objektet som faktiskt ska promoveras (inte artifact B med attestation avsedd för artifact A)?
5. `quarantine_content_hash` matchar bytesen som faktiskt promoveras just nu (inte innehåll som ändrats sedan attestationen skapades)?
6. `governance_release` matchar anropets värde?
7. `approver_actor_id`/`approver_role` finns i den *signerade* payloaden (inte tillagt efteråt)?
8. Först därefter: CAS-skrivning.

Skillnaden är avgörande: "den här blobben är korrekt signerad" ≠ "den här signaturen
auktoriserar just den här promotionen". Steg 2–7 är bindningskontroller, inte bara
kryptoverifiering.

**Trust-modell-språket i förra utkastet var för löst och rättas här:** Ed25519-nyckeln för
governance-signering ska INTE beskrivas som "samma förtroendemodell som JWT_ACCESS_SECRET".
Mekaniskt är båda serverhållna hemligheter, men säkerhetssemantiskt skiljer de sig:
JWT-hemligheten autentiserar sessioner/tokens (kortlivat, roterar via omlogin);
Ed25519-nyckeln blir en **governance signing authority** med direkt betydelse för
audit/replay av permanenta CAS-skrivningar. Den ska ha: eget `key_id` (redan ett fält i
`SignatureEnvelope`), separat env-konfiguration (inte återanvänd `JWT_ACCESS_SECRET`), och
ett dokumenterat rotationskontrakt även om rotation inte implementeras i denna omgång.

**Minimal målarkitektur:**

```
Authenticated ADMIN
        │
        ▼
governance route (requireAuth + role check — redan på plats)
        │
        ├── läser quarantine-artefakt + dess content hash
        │
        └── skapar signerad PromotionAttestation (server-side, binder alla fält ovan)
                     │
                     ▼
             QuarantinePromoter.promote(quarantineId, attestation, governanceRelease)
                     │
          verify signature + full bindning (steg 1–7 ovan)
                     │
                     ▼
                 CAS write (steg 8)
```

**Promotern ska vara säker även utan routen.** Ett direkt internt anrop —
`promoter.promote(quarantineId, attestation, governanceRelease)` från valfri annan kod i
repot, förbi Express helt — måste misslyckas utan en giltig, korrekt bunden attestation.
Detta flyttar trust boundary från Express-routen till governance-domänen själv
(`QuarantinePromoter`), vilket är rätt: routen är en väg in, inte förtroenderoten.

**Testplan när implementation godkänns** (utöver de tre redan skisserade i förra utkastet):

Fyra nya negativa tester:
- Giltigt signerad attestation för artifact A används mot artifact B → fail (steg 4).
- Giltigt signerad attestation skapad för `reject` används för `promote` → fail (steg 3).
- Giltig signatur men `governance_release` ändrad efter signering → fail (steg 6).
- Giltig attestation men quarantine-innehållets hash skiljer sig från attestationens
  `quarantine_content_hash` → fail (steg 5).

Ett positivt replay-test:
- Samma quarantine-bytes + samma signerade attestation + samma `governance_release` →
  samma promotion-identitet/resultat. **Om attestationsformatet innehåller
  tidsstämpel/nonce** (t.ex. `SignatureEnvelope.timestamp` som redan finns i typen) ska
  själva godkännande-eventet vara immutable och replay ska verifiera det *existerande*
  eventet snarare än skapa en ny signatur — annars blir "samma attestation" omöjlig att
  definiera meningsfullt.

Kritiskt: det direkta anropstestet (`promoter.promote()` utan att gå via routen, med en
självkonstruerad men saknad/ogiltig attestation) måste också finnas — det är beviset att
trust boundary faktiskt flyttat till domänen, inte bara till Express-lagret.

**Explicit acceptanskriterium (tillagt 2026-08-10, innan kodning påbörjas):** ingen
CAS-skrivning får vara möjlig efter en *partiellt* lyckad verifiering. All åtta
verifieringssteg ska köras och passera innan den första mutationen/sidoeffekten (CAS `put`,
statusuppdatering på karantänposten, etc.). Om steg 1–7 delvis passerar men steg N
misslyckas ska inget tillstånd redan ha muterats — funktionen ska vara ren fram till dess
sista giltighetskontroll är klar. Detta gör fail-closed-egenskapen transaktionellt tydlig,
inte bara logiskt sann. Implementation bör strukturera `promote()` som: samla alla
verifieringsresultat → en enda gate-kontroll → först därefter side effects, snarare än
tidiga returns blandade med skrivningar på vägen.

**Separat, registrerad som teknisk skuld (inte en del av denna remediation):**
`server/routes/governance.routes.ts` konstruerar sina samarbetspartners
(`FileCASRepository`, `DiskQuarantineStorage`, `QuarantinePromoter`, `DefaultCanonicalPipeline`)
som modul-nivå-konstanter med två top-level `await`, upptäckt när
`tests/unit/governanceRoutes.test.ts` skrevs — filen saknar en riktig
dependency-injection-seam, vilket gjorde att collaborators fick mockas på paketgränsen
istället för att injiceras. Inte samma säkerhetsfynd som ovan; separat refaktoreringsfråga.

## READ-ONLY REGISTRY-CONVERGENCE-GRANSKNING 2026-08-11 — live-kedjan `SOURCE_REGISTRY → executeLokeHarvestForSource → adapter → isUrlAllowedForSource → fetch() → quarantine`

**Uppdrag:** Innan något "Registry Gate"-kontrakt fryses — svara på om
`server/modules/harvest/source-registry/registry.ts` ska vara den kanoniska Source
Registry-modellen framåt, eller reduceras till en materialiserad/runtime-projektion av ett
governance-godkänt `SourceRegistryArtifact`. Ingen kod ändrad i detta avsnitt.

**Föregående fynd bekräftat och skärpt:** `national-registry.json` läses av exakt två skript
(`packages/mps-data-governance/scripts/{validateRegistry,loke-harvest}.ts`), båda enbart
kopplade som den paketets egna `npm run`-kommandon — inte i root `package.json`, inte i någon
av de 14 GitHub Actions-workflow-filerna. Källfilernas riktiga sökväg är alltså
`packages/mps-data-governance/scripts/loke-harvest.ts`, inte `scripts/loke-harvest.ts` (den
filen finns inte) — tidigare rapporttext som skrev "scripts/loke-harvest.ts" syftade,
paket-relativt, på denna fil, vilket är lätt att läsa som repo-rot. **Detta system är dött ur
CI/produktionssynpunkt**, oavsett vad som händer med dess governance-innehåll.

### 1. Vilka fält den live-exekverande vägen faktiskt läser

`SourceDefinition` (`registry.ts:8-18`): `sourceId, authority{name,type}, adapter, frequency,
allowedDomains[], artifactTypes[]`. Faktisk konsumtion:

- `lokeRuntime.ts` (`executeLokeHarvestForSource`): `sourceDef.adapter` (väljer
  Mmd/Mpd/ModAdapter via strängmatchning, rad 42-49), `allowedDomains` (indirekt, via
  `isUrlAllowedForSource`, rad 133 — enda faktiska grinden före `fetch()`).
- `harvestPlan.ts`: hela objektet (canonicaliseras + hashas + djupkopieras till
  `source_snapshot`), samt `adapter` (för att gissa `capabilities`) och `frequency`
  (cooldown).
- `lokeScheduler.ts`: `frequency` (due-beräkning), `sourceId`, `authority.name` (filter).
- **`artifactTypes` konsumeras aldrig i någon exekverande logik** — rent deskriptivt idag.
- **Adaptrarna (`mmdAdapter.ts` m.fl.) tar bara emot `sourceId` i sin konstruktor — aldrig
  `sourceDef`.** De har sina EGNA hårdkodade `allowedDomains`/`artifactTypes`-fält
  (`mmdAdapter.ts:14-15`) som en andra, oberoende kopia av samma information som redan finns
  i `registry.ts` — och dessa fält läses aldrig av adapterns egen `fetch()`/`validateContract()`
  (bekräftat: ingen referens till `this.allowedDomains` i `mmdAdapter.ts`s metodkroppar). Två
  källor till samma sanning, varav bara en (`registry.ts`, via `isUrlAllowedForSource`) faktiskt
  är den grind som körs.
- Live-modellen saknar helt `policy`/rate-limit/politeness-fält — `SourceDefinition` har
  ingenting motsvarande `SourceEndpoint.policy`. Skörderaten styrs inte alls på
  registernivå idag i den live vägen (separat, mindre fynd — inte del av
  auktoriseringsfrågan, men relevant för `SourceDefinition`s framtida form).

### 2. Var registerdefinitionen skapas/laddas idag

Ingenstans, i betydelsen "laddas". `SOURCE_REGISTRY` (`registry.ts:20-124`) är en
hårdkodad TypeScript-literal i källkoden. Att ändra en källa kräver en kodändring + deploy,
inte en datauppdatering. Det finns idag ingen loader, ingen fil, ingen databas — koden ÄR
registret.

### 3. Används `SOURCE_REGISTRY` någon annanstans än Loke?

Nej. Importeras endast av `lokeRuntime.ts`, `harvestPlan.ts`, `lokeScheduler.ts`, och en
testfil (`tests/unit/import/sourceRegistry.test.ts`). Allt innanför Loke-delsystemet. Inget i
`server/`-routes eller andra paket refererar det.

### 4. Kan `SourceRegistryArtifact` redan representera de ~12 live-källorna utan kontraktsförlust?

**Nej — konkret, dubbelriktad förlust:**

- `SourceRegistryArtifact`/`SourceEndpoint` (mps-data-governance) saknar helt `adapter`
  (vilken adapterklass som ska köras — det här är inte kosmetiskt, det är exekveringsvalet),
  `artifactTypes`, och `authority.type` (court/county_board/municipality — används av
  schemaläggarens filter).
- Omvänt har `SourceEndpoint` fält live-modellen inte har: `source_type`
  (WMS/WFS/API/WEBSITE/FTP/DATASET_PORTAL — ingen motsvarighet till "vilken adapter"), och ett
  helt `policy`-objekt (rate_limit/concurrency/politeness) som live-vägen saknar helt (se §1).

En riktig schemaförsoning krävs — inte ett enkelt "återanvänd typen som den är".

### 5. Vad krävs för att materialisera en verifierad artifact till runtime-registret?

Ingenting av detta finns idag. Skulle kräva: (a) ett `SourceRegistryArtifact`-efterföljande
schema utökat med `adapter`/`artifactTypes`/`authority.type` (eller en explicit
adapter-upplösningstabell separat från själva godkännande-artefakten), (b) en loader som
läser governance-godkända poster och verifierar VARJE post innan den materialiseras till en
in-memory `SourceDefinition`-karta, (c) `getSourceDefinition`/`getAllSources`/
`isUrlAllowedForSource` omskrivna till att läsa den materialiserade, verifierade kartan
istället för den hårdkodade konstanten, (d) beslut om vilken nyckel som signerar — att
återanvända `createArtifactAttestation`/`verifyArtifactAttestation`/
`LocalPemSigningKeyProvider` (samma mekanism som Level 2-remediationen redan bygger på, se
ovan) är den konsekventa vägen snarare än att uppfinna ett fjärde signeringssystem, (e) ett
uttryckligt beslut om `national-registry.json`s tre poster (INVALID/LEGACY-klassning, inte
tyst reparation, per tidigare instruktion) — eller ett beslut att hela filen avvecklas till
förmån för en ny, korrekt formad artefaktlagring, givet att den strukturellt inte ens täcker
live-modellens behov (§4).

**Viktigt fynd som direkt informerar riktningen:** `harvestPlan.ts`/`lokeScheduler.ts`
implementerar redan nästan exakt formen av "verifiera en gång / materialisera" — men bakvänt
och med en falsk signatur:

- `harvestPlan.ts:63`: `registry_hash = SHA256(canonicalizeStrict(sourceDef))` — en hash av
  vad den *hårdkodade, muterbara* konstanten råkar innehålla just nu, inte av en
  governance-godkänd artefakt.
- `harvestPlan.ts:82-85`: signaturen är `createHmac('sha256', 'mimer-secret-harvest-key')` —
  **en bokstavlig, hårdkodad hemlighet i klartext i källkoden.** Det är inte en hemlighet;
  vem som helst med läsbehörighet till repot (dvs. alla) kan reproducera en "giltig" HMAC för
  vilken plan som helst.
- **Signaturen verifieras aldrig, någonstans.** Grep av hela `scripts/import/loke/` för
  `plan.signature`/`verifySignature` gav noll träffar utanför skapandet självt.
  `harvestLedger.ts:43` sparar bara `plan_hash = plan.content_hash` som en
  lineage-referens (vilken plan en ledger hör till) — ingen verifieringslogik.
  `harvestLedger.ts:36`s loggmeddelande skriver uttryckligen **"laddat och verifierat"** om
  planen — utan att någon verifiering faktiskt sker. Samma mönster som den tidigare
  missvisande `approval_signature`-namngivningen, nu i loggtext istället för ett fältnamn.
- **`executeLokeHarvestForSource` tar aldrig emot ett `HarvestPlan`-objekt.** Den tar bara
  `sourceId: string`, och läser `getSourceDefinition(sourceId)` fräscht, direkt, ignorerandes
  planen helt. Detta bryter uttryckligen mot `contract.ts`s egna, dokumenterat frysta
  SHALL-regler: *"HarvestPlan SHALL be the sole executable description of a harvest run"* —
  planen är bevisligen inte det; den skapas, hashas, "signeras" och loggas, men konsumeras
  aldrig av exekveringen.

Detta är samma mönster som `HarvestOrchestrator`/`ImportGate` och den ursprungliga
`approval_signature`-hashen — **fjärde gången i denna granskning** att en governance-formad
mekanism finns kodad men inte är den som faktiskt körs eller kontrolleras.

### 6. Kan någon startväg nå `fetch()` utan registerresolution?

Nej, inte inom `scripts/import/loke/`: `executeLokeHarvestForSource` slår alltid upp
`getSourceDefinition(sourceId)` först och avbryter (`status: 'failed'`) om `null`.
`isUrlAllowedForSource`-kontrollen (rad 133) körs villkorslöst för varje kandidat, före både
dry-run-kontrollen (rad 138) och `adapter.fetch()` (rad 144) — ordningen är strukturellt
korrekt idag. **Säkerhetsytan är alltså verkligen liten**, precis som du misstänkte: en enda
funktion, ett enda gate-anrop, inga kända kringgångsvägar.

**Mindre bifynd:** `scripts/import/loke/adapters/baseAdapter.ts` definierar ett helt annat
`SourceAdapter`-interface (`id`, `title`, `fetchCases()`) än det som faktiskt implementeras
(`mmdAdapter.ts` implementerar `SourceAdapter` från `./contract`, med `sourceId`,
`discover()`, `fetch()`, `validateContract()`). `baseAdapter.ts` är föräldralös/oanvänd kod —
femte instansen i denna granskning av "två versioner av samma koncept, bara en kopplad".

### Slutsats och rekommenderad riktning (ej implementerad)

Din preliminära riktning stöds av fynden: `registry.ts` bör **inte** bli den kanoniska
modellen genom att bara få attestation-fält tillagda in-place — det skulle permanenta en
fjärde parallell registerarkitektur samtidigt som det redan finns en nästan-rätt, men
kryptografiskt låtsad, "verifiera/materialisera"-mekanism i `harvestPlan.ts` som pekar åt
rätt håll men aldrig kopplades in. Rätt form är: ett governance-godkänt
`SourceRegistryArtifact`-efterföljande schema (utökat per §4) som den enda auktoritativa
källan, en explicit materialiseringsfunktion som verifierar signaturen **innan** en
`SourceDefinition` skapas, och `executeLokeHarvestForSource` (eller ett tunt lager runt den)
som vägrar köra mot en källa som inte kom från en verifierad materialisering — fail-closed,
före `discover()`/`fetch()`, inte efter. Detta är litet att bygga givet att säkerhetsytan
(§6) redan är smal, men kräver en genomtänkt schemaförsoning (§4) och ett beslut om
`national-registry.json`s öde innan kod skrivs. Ingen kod skriven i detta avsnitt, per
instruktion.

## SCHEMA-CONVERGENCE-SPEC 2026-08-11 — `SourceRegistryArtifact ↔ SourceDefinition ↔ HarvestPlan`

**Status: DESIGN SPEC — väntar på fryst godkännande. Ingen kod skriven.** Målet är en enda
kanonisk auktoritet (governance-godkänd artefakt) som materialiseras till en verifierad
runtime-projektion, och ett `HarvestPlan` som är den enda exekverbara beskrivningen på
riktigt — inte bara till namnet. Bygger direkt på fynden i
"READ-ONLY REGISTRY-CONVERGENCE-GRANSKNING" ovan; se den för bevis per påstående nedan.

### 1. Kanonisk Source Registry-kontrakt (ersätter `SourceRegistryArtifact` v1)

Utökar governance-artefakten (inte `registry.ts`s runtime-typ) med execution-dispatch-fälten
den saknar idag, plus riktig attestation istället för `approved_by`/`approved_at` som fri
text:

```
SourceRegistryArtifactV2 extends CanonicalArtifact {
  artifact_type: "SOURCE_REGISTRY_ENTRY_V2"
  source_id: string                    // ersätter endpoint_id, stabil nyckel
  producer: {
    producer_id: string
    name: string
    type: "court" | "county_board" | "municipality" | "other"   // f.d. authority.type
  }
  adapter: string                      // KRITISKT — execution dispatch, inte UI-metadata
  artifact_types: string[]             // f.d. artifactTypes
  allowed_domains: string[]            // f.d. allowedDomains — den faktiska säkerhetsgrinden
  endpoint_url?: string                // valfri — finns för WMS/WFS/API/DATASET_PORTAL,
                                        // saknas för adaptrar som crawlar en domän (t.ex. MMD)
  source_type: "WMS"|"WFS"|"API"|"WEBSITE"|"FTP"|"DATASET_PORTAL"
  collection_frequency: "HOURLY"|"DAILY"|"WEEKLY"|"MONTHLY"|"YEARLY"|"ON_DEMAND"
  policy: {                            // KRITISKT — live-vägen saknar detta helt idag (se §1
    rate_limit_requests_per_second: number   // i convergence-granskningen)
    concurrency_limit: number
    politeness_delay_ms?: number
    max_object_size_bytes?: number
  }
  geographic_scope?: string
  approval_attestation: ArtifactAttestation   // ersätter approved_by/approved_at helt
}
```

`approval_attestation` återanvänder exakt samma mekanism som Level 2-remediationen
(`createArtifactAttestation`/`verifyArtifactAttestation`/`LocalPemSigningKeyProvider` från
`mimers-brunn-core`) — inget femte signeringssystem. Ny `predicateType`:
`"mimers-brunn/source-registry-approval/v1"`. Signerad predikat (alla fält i den signerade
payloaden, samma bindningsdisciplin som `PromotionAttestationPredicate`):

```
SourceApprovalAttestationPredicate {
  action: "source.approve"             // domänseparerar från promotion-attestationer
  source_id: string
  source_content_hash: string          // hash av { producer, adapter, artifact_types,
                                        // allowed_domains, endpoint_url, source_type,
                                        // collection_frequency, policy, geographic_scope }
  approver_actor_id: string
  approver_role: "GOVERNANCE_REVIEWER" // enda giltiga rollen — inte "GOVERNOR"
  attestation_schema_version: number
  signer_key_id: string
}
```

`subjectDigest = sha256:<source_content_hash>` — samma mönster som promotion-attestationen.

### 2. `national-registry.json`s öde

**Rekommendation: deprecieras, ersätts av en ny fil under det nya schemat.** De tre
befintliga posterna kan inte migreras genom tyst reparation (§4 i granskningen ovan visade
strukturell kontraktsförlust åt båda hållen — `adapter`/`artifact_types` saknas helt i v1).
Konkret:

- Ny fil (t.ex. `source-registry/canonical-registry.v2.json`) innehåller SGU/NV/SMHI **plus**
  de ~12 käll-definitioner som idag bara finns hårdkodade i `registry.ts` — alla omgjorda
  till `SourceRegistryArtifactV2` med riktig `approval_attestation`.
- `source-registry/national-registry.json` (v1) märks `DEPRECATED` (topplevel-fält eller
  README i samma mapp) och slutar vara skriv-/läsmål för ny kod. Radering kräver ditt
  godkännande (samma mönster som redan använts i sessionen) — föreslås INTE här.
- `packages/mps-data-governance/scripts/{loke-harvest,validateRegistry}.ts` — redan döda ur
  CI-synpunkt (se granskningen ovan). Föreslås märkas `DEPRECATED` i sina filhuvuden i samma
  ändring, inte tas bort utan separat godkännande.

### 3. `HarvestPlan` blir normativ på riktigt

`createHarvestPlan()` tar inte längre en bar `sourceId: string`. Den kräver en redan
**materialiserad och verifierad** `VerifiedSourceDefinition` (produkten av att läsa en
`SourceRegistryArtifactV2`, verifiera dess `approval_attestation`, och först då projicera
den till runtime-formen `registry.ts` redan använder). `source_snapshot` i planen blir en
kopia av DEN verifierade projektionen — inte av den nuvarande muterbara `SOURCE_REGISTRY`
-konstanten.

`executeLokeHarvestForSource()` byter signatur från `(sourceId: string, options)` till
`(plan: HarvestPlan, options)`. Den läser aldrig `getSourceDefinition()` internt längre —
adapter-valet (`createAdapterForSource`) sker mot `plan.source_snapshot.adapter`, inte mot en
fräsch registry-uppslagning. Detta är den konkreta ändringen som gör kontraktets egen
SHALL-regel (`contract.ts`: *"HarvestPlan SHALL be the sole executable description of a
harvest run"*) sann istället för bruten.

### 4. Riktig signering istället för falsk

`createHmac('sha256', 'mimer-secret-harvest-key')` (`harvestPlan.ts:82-85`) tas bort helt.
Planens attestation byggs med samma `createArtifactAttestation()`-mekanism, ny
`predicateType: "mimers-brunn/harvest-plan/v1"`, predikat binder minst: `action:
"harvest.plan.create"`, `source_id`, `source_content_hash` (måste matcha den verifierade
`VerifiedSourceDefinition`s hash — binder planen till en specifik godkänd källversion),
`registry_artifact_id` (vilken `SourceRegistryArtifactV2` som godkände källan),
`plan_payload_hash` (budgets/capabilities/constraints), `signer_key_id`.

Signeringsnyckeln: separat `key_id`/env-block från Level 2s promotion-nyckel (egen blast
radius — en komprometterad harvest-plan-nyckel ska inte kunna förfalska CAS-promotions och
vice versa), men samma `LocalPemSigningKeyProvider`-mekanism/mönster
(`server/security/governanceSigningKey.ts` blir en generaliserad modul med flera namngivna
nycklar, eller en syskonmodul med identisk struktur — implementationsdetalj, inte en ny
uppfinning).

`harvestLedger.ts:36`s loggrad **"HarvestPlan ... laddat och verifierat"** får inte skrivas
förrän en faktisk `verifyArtifactAttestation()`-kontroll har körts och passerat — antingen
flyttas verifieringen hit (i `startHarvestRun`, innan ledgern öppnas) eller loggtexten ändras
till att inte påstå verifiering som inte skett på den platsen. Verifieringen måste under alla
omständigheter ha skett **innan** `executeLokeHarvestForSource` gör sitt första
`adapter.discover()`-anrop — se enforcement-kedjan nedan.

### 5. Enforcement-invarianten (brutal, enkel, per instruktion)

```
Ingen verifierad SourceRegistryArtifactV2 (giltig approval_attestation)
        │  fail-closed vid materialisering
        ▼
Ingen VerifiedSourceDefinition
        │  createHarvestPlan() kan typmässigt inte anropas utan denna
        ▼
Inget HarvestPlan (eller ett HarvestPlan vars egen attestation inte verifierar)
        │  executeLokeHarvestForSource() vägrar köra — fail-closed vid funktionens start,
        │  innan adapter-instansiering
        ▼
Ingen adapter-dispatch
        │
        ▼
Ingen nätverks-I/O (inget adapter.discover()/fetch())
        │
        ▼
Ingen quarantine-write
```

Varje pil ovan motsvarar en konkret, testbar kontrollpunkt i koden — inte bara ett
designdiagram. `policy`-blocket (rate limit/concurrency/politeness) flödar med genom hela
kedjan (governance-artefakt → materialiserad `SourceDefinition.policy` → planens budgets
härledda från `policy`, inte bara `priority`-heuristik som idag → faktiskt tillämpad
`politeness_delay_ms`-paus mellan `fetch()`-anrop i `lokeRuntime.ts`, som idag helt saknar
paus mellan kandidater — till skillnad från den döda `mps-data-governance/scripts/
loke-harvest.ts` som redan respekterar den, se granskningen ovan).

### Två arkitekturtester som krävs innan implementationen anses klar

1. **Snapshot-immutabilitet:** skapa ett `HarvestPlan` från en verifierad källa, ändra
   därefter den underliggande registerposten (eller dess materialiserade projektion), kör
   det redan skapade planet — resultatet ska reflektera den ursprungliga, bundna snapshoten,
   inte den nya. Bevisar att `source_snapshot` verkligen är immutabelt bindande, inte bara en
   ytlig kopia som råkar stämma vid skapandetillfället.
2. **Tamper-before-network:** konstruera ett plan/snapshot/signatur där något fält ändrats
   efter signering (t.ex. `adapter` eller `allowed_domains` muterat post-signering).
   Anropa `executeLokeHarvestForSource(tamperedPlan)`. Assertion: `fetch` (spionerad/mockad)
   anropas **noll gånger**, och funktionen misslyckas synligt före första
   `adapter.discover()`. Detta är samma disciplin som redan bevisades för
   `QuarantinePromoter.promote()` i Level 2 — verifiering före första sidoeffekt, inte
   blandat med den.

### Explicit, INTE del av denna spec

Per samma scope-disciplin som Level 2: enskilda per-reviewer-nycklar/non-repudiation för
källgodkännanden (samma "server är signeraren" trust-modell som redan gäller), nyckelrotation
(dokumenterat kontrakt räcker, ingen implementation), och `packages/mps-governance`s
`ActorArtifact`/`TrustAnchor`-ramverk (separat, oauditerat arkitekturkonvergens-spår).

## Sammanfattning

Arkitekturen för godkänd harvesting **finns redan, till stor del**, och är bättre
genomtänkt än vad fem nya script någonsin skulle bli. Men den är: (a) inte kopplad till
något som faktiskt körs, (b) testad på tillståndslogik men inte på behörighetskontroll,
och (c) själva de tre "godkända" registerposterna som redan finns bryter mot dess egna
typer. Nästa steg är reparation av tre konkreta kodställen (§7, punkt 1–3) plus ett
formellt beslut (ADR, Accepted) om att denna kedja — inte `loke-harvest.ts` direkt, inte
nya script — är den enda vägen in. Ingen kod har ändrats för att skriva denna rapport.
