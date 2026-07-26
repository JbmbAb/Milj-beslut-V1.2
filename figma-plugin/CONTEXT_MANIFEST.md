# Figma Make Context Manifest (Import Order)

Use this order when feeding files into Figma Make so the AI gets architecture first, then views, then backend/API constraints.

## Fokuspaket: Enskilt avlopp + C-anmälan + Lokaliseringsutredning + Admin

When the design task is specifically these four areas, use this compact order first:

1. `types.ts`
2. `tokens.json`
3. `tokens.css`
4. `components/AppContentRouter.tsx`
5. `components/admin/modules/sewage-portal/SewagePortalView.tsx`
6. `components/admin/modules/sewage-portal/SewageSystemSelector.tsx`
7. `components/admin/modules/sewage-portal/SewageRequirementChecklist.tsx`
8. `components/admin/modules/sewage-portal/SewageMapView.tsx`
9. `components/admin/modules/c-notification-mass/CNotificationMassUI.tsx`
10. `components/admin/modules/c-notification-mass/MassMapView.tsx`
11. `components/LocalizationStudyUI.tsx`
12. `components/admin/AdminContainer.tsx`
13. `components/admin/AdminShell.tsx`
14. `components/admin/AdminNav.tsx`
15. `components/admin/AdminHeader.tsx`
16. `components/admin/ModuleRouter.tsx`
17. `components/admin/admin-tokens.css`
18. `components/admin/admin-shell.css`
19. `components/admin/admin-nav.css`
20. `components/admin/admin-header.css`

## 1) Core app shell and contracts

1. `types.ts`
2. `constants.ts`
3. `index.tsx`
4. `components/App.tsx`
5. `tokens.json`
6. `tokens.css`
7. `index.html`
8. `vite.config.ts`
9. `README.md`

## 2) Global project state and plan engine

1. `components/ProjectStructureContext.tsx`
2. `services/projectStructure.ts`
3. `components/ProjectPlanStructurePanel.tsx`

## 3) Main experience modules (UI)

1. `components/ExecutiveSummary.tsx`
2. `components/ProjectManagerView.tsx`
3. `components/ApplicationWizard.tsx`
4. `components/PermitPortalView.tsx`
5. `components/MarketIntelView.tsx`
6. `components/AdminSearchConsole.tsx`
7. `components/IntegrationsDashboard.tsx`
8. `components/DossierDashboard.tsx`
9. `components/Guide.tsx`

## 4) Supporting feature components

1. `components/GisRiskModule.tsx`
2. `components/SluExpert.tsx`
3. `components/FormManager.tsx`
4. `components/FieldAssistant.tsx`
5. `components/AssetTriage.tsx`
6. `components/GanttChart.tsx`
7. `components/ProjectOrgChart.tsx`
8. `components/MapView.tsx`
9. `components/WeatherRisk.tsx`
10. `components/PermitTable.tsx`
11. `components/DetailModal.tsx`
12. `components/ChatBot.tsx`
13. `components/StatsOverview.tsx`
14. `components/UploadModal.tsx`
15. `components/MunicipalityAvatar.tsx`
16. `components/MarketingHub.tsx`
17. `components/BankIDLogin.tsx`
18. `components/GeminiClientExample.tsx`
19. `app/components/MapComponent.tsx`

## 5) Client-side AI/service dependencies

1. `services/geminiService.ts`

## 6) API routes and backend entry points (for realistic UI constraints)

1. `server/index.ts`
2. `server/secureApi.express.ts`
3. `server/geminiApi.express.ts`
4. `app/routes/api/gemini.ts`
5. `app/routes/api.dossier.$propertyId.tsx`

## 7) Domain services used by UI/data flows

1. `server/services/projectPlanService.ts`
2. `server/services/searchService.ts`
3. `server/services/searchWorker.ts`
4. `server/services/openDataSourceService.ts`
5. `server/services/lantmaterietService.ts`
6. `server/services/sluService.ts`
7. `server/services/bankIdService.ts`

## 8) Persistence layer and schema

1. `server/db/prisma.ts`
2. `server/repositories/projectPlanRepository.ts`
3. `server/repositories/searchRepository.ts`
4. `server/repositories/adminReportRepository.ts`
5. `server/repositories/auditRepository.ts`
6. `server/repositories/projectAccessRepository.ts`
7. `server/repositories/userRepository.ts`
8. `prisma/schema.prisma`

## 9) Security and governance

1. `server/security/auth.ts`
2. `server/security/env.ts`
3. `server/security/projectAccess.ts`
4. `server/security/rateLimit.ts`
5. `server/security/requestLogging.ts`
6. `server/security/auditTrail.ts`
7. `server/security/types.ts`
8. `server/compliance/retention.ts`

## 10) Data catalog and snapshots (to guide realistic UI text/state)

1. `server/datasources/catalog.ts`
2. `server/data/snapshots/summary.json`
3. `server/data/snapshots/smhi.json`
4. `server/data/snapshots/sgu.json`
5. `server/data/snapshots/scb.json`
6. `server/data/snapshots/naturvardsverket.json`
7. `server/data/snapshots/msb.json`

## 11) Figma plugin side (if Make output should match plugin flow)

1. `figma-plugin/manifest.json`
2. `figma-plugin/code.js`
3. `figma-plugin/ui.html`
4. `figma-plugin/STRUCTURE_PROMPT.md`
5. `figma-plugin/README.md`

## 12) Domain docs for language/tone/context

1. `docs/google-ai/SETUP.md`
2. `server/services/vertexAiService.ts`
3. `SECURITY_BACKEND_README.md`
4. `LANTMATERIET_APPLICATION_SUMMARY.md`

## Files to skip in Figma context ingestion

1. `dist/**`
2. `node_modules/**`
3. `tmp_*`
4. `package-lock.json`
5. `docker-compose.yml` (only include if deployment constraints are needed)
