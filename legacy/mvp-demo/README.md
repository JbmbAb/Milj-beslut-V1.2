# MVP Demo - Arkiverad 2026-04-03

## Skäl till arkivering

MVP_WORKFLOW-läget var en tidig prototyp av funktionalitet som sedan implementerades ordentligt i tillståndsportalen (PERMIT_PORTAL).

Eftersom samma funktionalitet nu finns tillgänglig i produktionskoden via PERMIT_PORTAL-läget, har MVP_WORKFLOW-läget tagits bort för att undvika parallella implementationer och förvirring.

## Arkiverade filer

### Komponenter (från /components/)
- `MvpDemoInterface.tsx` - Huvudgränssnittet för MVP-läget
- `MvpWorkflowView.tsx` - MVP workflow-vy
- `GeminiClientExample.tsx` - Exempel på Gemini-integration
- `mvp/` - Hela MVP-komponent-katalogen
  - `MvpProjectDashboardView.tsx`
  - `MvpDocumentSearchView.tsx`
  - `MvpClassificationPanelView.tsx`
  - `MvpPermitGeneratorView.tsx`
  - `MvpMunicipalityInsightPanel.tsx`
  - `mvpDemoModel.ts`
  - `mvpDemoShared.tsx`

### Services (från /services/)
- `mvpApiClient.ts` - API-klient med DEMO_TOKEN

### Tester
- `mvpDemoInterface.test.tsx`
- `mvpWorkflowView.test.tsx`
- `mvpClassificationPanelView.test.tsx`
- `mvpProjectDashboardView.test.tsx`
- `mvpPermitGeneratorView.test.tsx`
- `mvpApiClient.test.ts`

## Ändringar i huvudkodbasen

- Tog bort `'MVP_WORKFLOW'` från `InterfaceMode` i `types.ts`
- Tog bort MVP_WORKFLOW-hantering från `StandaloneWorkspace.tsx`
- Tog bort MVP-preloads från `workspacePreload.ts`

## Om du behöver MVP-funktionalitet

Använd istället **PERMIT_PORTAL-läget** som innehåller samma funktionalitet i en mer robust och underhållbar implementation.

---

**Arkiverad:** 2026-04-03
**Beslutad av:** JbmbAb
**Anledning:** Duplicerad funktionalitet, redan implementerad i tillståndsportalen
