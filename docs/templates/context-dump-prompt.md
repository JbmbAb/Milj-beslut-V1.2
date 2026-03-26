# Prompt-mall: Fullständig arkitektur- och täckningsanalys

Använd denna mall i **Google AI Studio med Gemini 1.5 Pro** efter att du laddat upp
`repomix-output.xml` (genererad av `npx repomix`).

---

## Prompt (klistra in direkt i AI Studio)

```
Du är en Senior Systemarkitekt och Lead Backend Developer med djup erfarenhet av
Node.js/TypeScript, PostgreSQL (PostGIS + pgvector), Prisma ORM och svenska
miljörättsliga system.

Du har fått hela kodbasen för Miljobeslut.se – ett AI-drivet handläggningsstöd
för svenska tillståndsprocesser (9 kap. MB, Natura 2000, BankID, Lantmäteriet).

## Ditt uppdrag

Gör en komplett analys i fyra delar. Svara i markdown med tydliga rubriker.

---

## Del 1 – Täckning (Vad finns?)

Identifiera alla implementerade moduler i kodbasen:
- Backend services (server/services/) – lista varje service och dess syfte
- Repositories (server/repositories/) – lista varje repo och vilka Prisma-modeller den täcker
- API-routes (server/routes/) – lista alla endpoints med HTTP-metod och autentiseringskrav
- Komponenter (components/) – lista de viktigaste UI-komponenterna och deras funktion
- Tester (tests/) – räkna antal testfiler per kategori (unit/component/integration/e2e)

Format: tabell med kolumner [Modul | Fil | Status | Testtäckning]

---

## Del 2 – Styrkor (Vad fungerar bra?)

Identifiera de 5 starkaste delarna av arkitekturen baserat på:
- Kodens tydlighet och konsekvens
- Testning och felhantering
- Säkerhetsimplementering (JWT, RBAC, audit trail)
- Skalbarhet och Cloud Run-anpassning

---

## Del 3 – Kritiska glapp (Vad saknas eller är bristfälligt?)

Jämför koden mot visionen i docs/architecture/system_architecture_blueprint.md:
- Vilka features i blueprinten är INTE implementerade i kod?
- Vilka services saknar enhetstester?
- Vilka API-endpoints saknar autentisering eller validering?
- Finns det inkonsistenser mellan Prisma-schema och faktisk databasanvändning?

Format: tabell med kolumner [Glapp | Prioritet (HÖG/MEDEL/LÅG) | Rekommenderad åtgärd]

---

## Del 4 – Nästa 3 sprints (Vad bör göras härnäst?)

Baserat på glappen i Del 3, föreslå konkreta uppgifter för de nästa 3 sprintarna.
Varje sprint = 2 veckor. Prioritera efter:
1. Juridisk risk (tillståndsprocessen måste vara korrekt)
2. Teknisk skuld (blockerar framtida features)
3. Testluckor (services utan tester)

Format: numrerad lista per sprint med [Uppgift | Fil(er) att ändra | Uppskattad tid]
```

---

## Snabbvarianter

### Variant A – Säkerhetsgranskning
```
Fokusera enbart på säkerhetsaspekter i kodbasen:
1. JWT-hantering: kontrollera att access/refresh-tokens hanteras korrekt i alla routes
2. RBAC: vilka routes saknar rollkontroll?
3. Input-validering: finns det SQL-injection eller XSS-risker?
4. Hemligheter: finns det hårdkodade hemligheter eller osäkra miljövariabelreferenser?
5. Audit trail: täcker auditRepository alla kritiska användaråtgärder?

Svara med en riskmatris: [Risk | Fil | CVSS-uppskattning | Åtgärd]
```

### Variant B – Databas- och prestandaanalys
```
Analysera Prisma-schema och migrationshistoriken:
1. Saknade index: vilka foreign keys och filtreringsfält saknar index?
2. N+1-problem: finns det queries som borde använda include/select mer effektivt?
3. pgvector-konfiguration: är HNSW-parametrarna (m, ef_construction) optimala för vår datamängd?
4. PostGIS: används ST_DWithin istället för ST_Distance där möjligt?

Svara med konkreta Prisma-migreringsförslag.
```

### Variant C – Testluckor
```
Analysera tests/-mappen mot server/-mappen:
1. Lista alla filer i server/services/ som SAKNAR motsvarande test i tests/unit/
2. Lista alla filer i server/repositories/ som SAKNAR motsvarande test
3. Föreslå de 5 viktigaste testfilerna att skriva härnäst, med motivering

Svara med en prioriterad att-göra-lista.
```

---

## Tips för Google AI Studio

1. **Modell:** Välj alltid `Gemini 1.5 Pro` (inte Flash) för fullständig kodbas
2. **Temperature:** Sätt till `0.2` för analyser (mer deterministisk)
3. **System instruction:** Lägg in rollen ("Du är Senior Systemarkitekt...") som *System Instruction*, inte i prompten
4. **Filuppladdning:** Ladda upp `repomix-output.xml` via paperclip-ikonen
5. **Iterera:** Kör Del 1 först, granska, kör sedan Del 3 separat för djupare analys
