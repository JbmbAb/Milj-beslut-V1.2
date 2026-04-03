# Legacy Code Archive

Detta katalog innehåller kod som inte längre är en del av produktions-kodbas men bevaras för referens.

## Struktur

### mvp-demo/
MVP_WORKFLOW-läget - en tidig prototyp som sedan implementerades ordentligt i tillståndsportalen.

**Innehåll:**
- `MvpDemoInterface.tsx` och hela `mvp/`-katalogen
- `mvpApiClient.ts` - API-klient med DEMO_TOKEN
- Alla relaterade tester

**Beslut:** Arkiverat 2026-04-03
**Skäl:** Duplicerad funktionalitet - samma features finns nu i PERMIT_PORTAL-läget med bättre implementation.

### demos/
Fristående demo- och test-scripts.

**Innehåll:**
- `demo-rag-checklist.ts` - Demo av RAG-baserad kravlista
- `test-demo-search.ts` - Testscript för sökmotorn

**Beslut:** Arkiverat 2026-04-03
**Skäl:** Demo-kod, ej produktionskod.

### experimental/
Experimentella moduler som aldrig integrerades i produktion.

**Innehåll:**
- `gpsTrackingService.ts` - GPS-spårning för logistik (backend fanns, inget UI)
- `marketIntelService.ts` - Marknadsdata-integration (backend fanns, inget UI)
- `bankComplianceProfileService.ts` - ESG-scoring för banker (förberedd men aldrig använd)
- `complianceRulesEngine_old.ts` - Gammal version, konsoliderad till server/services/complianceRuleEngine.ts

**Beslut:** Arkiverat 2026-04-02
**Skäl:** Backend-implementation utan frontend-integration i 60+ dagar. Oklart affärscase.

### remix-poc/
Proof-of-concept Remix routing som aldrig togs i drift.

**Innehåll:**
- Hela `/app/routes/` katalogen (11 Remix route-filer)

**Beslut:** Kasserat 2026-04-02
**Skäl:** Parallell arkitektur till Express routes som aldrig användes i produktion.

---

## Ändringar i huvudkodbasen (2026-04-03)

**Borttaget från produktion:**
- `'MVP_WORKFLOW'` från `InterfaceMode` i `types.ts`
- MVP_WORKFLOW-hantering från `StandaloneWorkspace.tsx`
- MVP-preloads från `workspacePreload.ts`
- MVP_WORKFLOW från `workspaceModes.ts` MODE_CARDS

**Uppdaterad konfiguration:**
- `tsconfig.json` - exkluderar `legacy/**/*` från TypeScript-kompilering

---

## Om du behöver något från legacy/

1. **Kontrollera först** om funktionalitet redan finns i produktions-kod
2. **För MVP-funktionalitet:** Använd PERMIT_PORTAL-läget istället
3. **Extrahera konceptet**, inte koden direkt
4. **Skriv om** med nuvarande arkitektur
5. **Lägg till tester** från början
6. **Dokumentera** i modulregistret

---

**Skapad:** 2026-04-02
**Uppdaterad:** 2026-04-03
**Syfte:** Förhindra att experimentell kod blandas med produktion
