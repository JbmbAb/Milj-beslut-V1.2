# Legacy Code Archive

Kod som **inte** ingår i produktions-API men bevaras för referens och enstaka enhetstester.

## Aktiv produktionskod (flyttad)

GPS-spårning och marknadsintelligens för logistik ligger numera under modulen:

- `server/modules/logistics/services/gpsTrackingService.ts`
- `server/modules/logistics/services/marketIntelService.ts`

Routes: `server/routes/logistics.routes.ts` via `server/modules/logistics/public.ts`.

## experimental/

| Fil | Status |
| --- | --- |
| `bankComplianceProfileService.ts` | Endast testreferens; logik återimplementerad i `src/application/compute-compliance-profile.usecase.ts` |

Borttaget 2026-07-26: `gpsTrackingService.ts`, `marketIntelService.ts` (flyttade till logistics-modulen), `complianceRulesEngine_old.ts` (odead kod).

## remix-poc/

Proof-of-concept Remix-routing som aldrig togs i drift.

- Hela `legacy/remix-poc/routes/` (11 filer)
- Importeras endast från enhetstester (`tests/unit/remixGeminiRoute.test.ts`, `caseNotesRoute.test.ts`)

**Beslut:** Kasserat 2026-04-02 — parallell arkitektur till Express som aldrig användes i produktion.

---

## Om du behöver något från legacy/

1. Kontrollera om funktionalitet redan finns i `server/modules/*` eller `src/`
2. Extrahera konceptet, skriv om med nuvarande arkitektur
3. Lägg till tester från början
4. Uppdatera [modulregister_ombyggnad.md](../docs/architecture/modulregister_ombyggnad.md)

**Skapad:** 2026-04-02 · **Senast sanerad:** 2026-07-26
