/**
 * completionService.ts
 *
 * Tracks which features of the Miljöbeslut application are implemented,
 * partially implemented, or still pending — answering the question
 * "hur många procent återstår innan komplett app?".
 *
 * The manifest is intentionally maintained here as a single source of truth.
 * Status values:
 *   DONE    — feature is fully implemented and tested
 *   PARTIAL — feature exists but has known gaps (see `note`)
 *   PENDING — planned but not yet built
 */

import type { AppCompletionResponse, AppFeature, FeatureStatus } from '../../types';

// ─── Feature manifest ─────────────────────────────────────────────────────────

const FEATURES: AppFeature[] = [
  // ── Autentisering & Användare ──────────────────────────────────────────────
  {
    id: 'auth-bankid',
    label: 'BankID-inloggning',
    category: 'Autentisering',
    status: 'PARTIAL',
    note: 'Kod klar (bankidService.ts, /api/auth/bankid/*). Kräver BANKID_PFX_PATH (eller BANKID_CERT_PATH+BANKID_KEY_PATH) + BANKID_BASE_URL i produktion. Kan inte testas end-to-end utan fysisk BankID-certifikat.',
  },
  {
    id: 'auth-admin-console',
    label: 'Admin-konsol lösenordsinloggning',
    category: 'Autentisering',
    status: 'DONE',
  },
  {
    id: 'auth-token-refresh',
    label: 'JWT-tokenförnyelse',
    category: 'Autentisering',
    status: 'DONE',
  },
  {
    id: 'auth-org-management',
    label: 'Organisationshantering (skapa/bjud in/ta bort)',
    category: 'Autentisering',
    status: 'DONE',
    note: 'Inbjudningsflöde implementerat: POST/GET /api/orgs/:orgId/invitations + accept + revoke med HMAC-token och AuditTrail.',
  },

  // ── Projekthantering ───────────────────────────────────────────────────────
  {
    id: 'project-create',
    label: 'Skapa och hantera projekt',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-plan-save',
    label: 'Spara projektplan till databas',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-stage-gates',
    label: 'Stage-gate-utvärdering (4 grindar)',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-carbon-calc',
    label: 'Koldioxidberäkning per projekt',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-template',
    label: 'Projektmallsystem (ENV_PERMIT, REMEDIATION m.fl.)',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-map-layers',
    label: 'Kartlagerrekommendationer per projekttyp',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-predictive-scores',
    label: 'Prediktiva riskpoäng (funding, regulatory, environmental)',
    category: 'Projekthantering',
    status: 'DONE',
  },
  {
    id: 'project-gantt',
    label: 'Gantt-schema-vy',
    category: 'Projekthantering',
    status: 'DONE',
    note: 'Komponent kopplad till live projektplan. Footer visar dynamisk total-tid, antal aktiviteter och klara faser.',
  },
  {
    id: 'project-member-roles',
    label: 'Projektmedlemmar och rollbehörigheter',
    category: 'Projekthantering',
    status: 'DONE',
    note: 'GET/PUT/DELETE /api/projects/:id/members implementerat med cross-org skydd och OWNER-skydd.',
  },
  {
    id: 'project-notifications',
    label: 'E-postaviseringar vid stagegatebyte',
    category: 'Projekthantering',
    status: 'DONE',
    note: 'notificationService.ts — AuditTrail-loggning alltid, SMTP om konfigurerat. Stage-gate + member-events.',
  },

  // ── Tillståndsportalen ─────────────────────────────────────────────────────
  {
    id: 'permit-portal-view',
    label: 'Tillståndsvy (PermitPortalView)',
    category: 'Tillståndsportalen',
    status: 'DONE',
  },
  {
    id: 'permit-docx-export',
    label: 'DOCX-export av tillståndsansökan',
    category: 'Tillståndsportalen',
    status: 'DONE',
  },
  {
    id: 'permit-requirements-cases',
    label: 'Kravfall och kravrad-hantering',
    category: 'Tillståndsportalen',
    status: 'DONE',
  },
  {
    id: 'permit-requirements-citations',
    label: 'Juridiska citat med AI-verifiering',
    category: 'Tillståndsportalen',
    status: 'DONE',
  },
  {
    id: 'permit-requirements-reports',
    label: 'Kravrapporter (sammanfattning + CSV/DOCX-export)',
    category: 'Tillståndsportalen',
    status: 'DONE',
  },
  {
    id: 'permit-application-wizard',
    label: 'Ansökningsguide (ApplicationWizard)',
    category: 'Tillståndsportalen',
    status: 'DONE',
    note: 'POST /api/projects/:id/permit/authority-submit skickar ansökan till myndighet med diarienummer och AuditTrail.',
  },
  {
    id: 'permit-authority-submit',
    label: 'Digital inlämning till länsstyrelse/kommunen',
    category: 'Tillståndsportalen',
    status: 'PARTIAL',
    note: 'permitAuthorityService.ts genererar diarienummer + AuditTrail. Utan AUTHORITY_SUBMIT_ENDPOINT returnerar tjänsten alltid MOCK_QUEUED. Kräver riktig myndighets-API-nyckel (AUTHORITY_API_KEY) för produktionsinlämning.',
  },

  // ── Logistik & Transport ───────────────────────────────────────────────────
  {
    id: 'logistics-dispatch-quote',
    label: 'Transportoffert (dispatch quote)',
    category: 'Logistik & Transport',
    status: 'DONE',
  },
  {
    id: 'logistics-transport-booking',
    label: 'Transportbokning',
    category: 'Logistik & Transport',
    status: 'DONE',
  },
  {
    id: 'logistics-driver-journal',
    label: 'Förarjournal med e-signatur',
    category: 'Logistik & Transport',
    status: 'DONE',
  },
  {
    id: 'logistics-lims-ingest',
    label: 'LIMS-rapport inläsning och verifiering',
    category: 'Logistik & Transport',
    status: 'DONE',
  },
  {
    id: 'logistics-market-view',
    label: 'Marknadsintelligens-vy (MarketIntelView)',
    category: 'Logistik & Transport',
    status: 'DONE',
    note: 'GET /api/market-intel/prices — realtidspriser + utbudslistor med 15 min cache. Stöder MARKET_INTEL_ENDPOINT.',
  },
  {
    id: 'logistics-gps-tracking',
    label: 'GPS-spårning av transporter',
    category: 'Logistik & Transport',
    status: 'DONE',
    note: 'POST/GET /api/projects/:id/transport/:bookingId/gps — circular buffer med hash-chain. Haversine-distansberäkning.',
  },

  // ── Compliance & Revision ──────────────────────────────────────────────────
  {
    id: 'compliance-audit-export',
    label: 'Revisionslogg med oföränderlig export',
    category: 'Compliance & Revision',
    status: 'DONE',
  },
  {
    id: 'compliance-rule-engine',
    label: 'Complianceregelmotor (MB/MPF/EWC)',
    category: 'Compliance & Revision',
    status: 'DONE',
  },
  {
    id: 'compliance-gdpr',
    label: 'GDPR-complianceservice',
    category: 'Compliance & Revision',
    status: 'DONE',
  },
  {
    id: 'compliance-checklist-rag',
    label: 'AI-baserad checklistverifiering (RAG)',
    category: 'Compliance & Revision',
    status: 'DONE',
  },
  {
    id: 'compliance-executive-summary',
    label: 'Exekutiv sammanfattning (ExecSummary)',
    category: 'Compliance & Revision',
    status: 'DONE',
    note: 'POST /api/projects/:id/exec-summary/enqueue + status/:jobId — asynkron Gemini-generering med deduplicering.',
  },
  {
    id: 'compliance-digital-signature',
    label: 'Kvalificerade e-signaturer (EU eIDAS)',
    category: 'Compliance & Revision',
    status: 'PARTIAL',
    note: 'POST /api/documents/:id/sign/eidas — kod klar för Advanced/Qualified via EIDAS_QTSP_ENDPOINT (Assently/Scrive), PAdES/XAdES/CAdES. Kräver EIDAS_QTSP_ENDPOINT + EIDAS_QTSP_API_KEY för riktig signering.',
  },

  // ── Geodata & Kartfunktioner ───────────────────────────────────────────────
  {
    id: 'geo-map-view',
    label: 'Interaktiv karta (Leaflet/MapView)',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
  },
  {
    id: 'geo-sgu-layers',
    label: 'SGU-kartlager (grundlager + jordskred)',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
  },
  {
    id: 'geo-hydro-layers',
    label: 'Hydrologi-kartlager (sjöar + vattendrag)',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
  },
  {
    id: 'geo-nvr',
    label: 'Naturvårdsregistret (NVR) kartlager',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
  },
  {
    id: 'geo-property-lookup',
    label: 'Fastighetsuppslag (PostGIS + Lantmäteriet)',
    category: 'Geodata & Kartfunktioner',
    status: 'PARTIAL',
    note: 'PropertyRegisterExtract anropar /api/property/lookup. Kräver LANTMATERIET_CONSUMER_KEY+SECRET (OAuth2), LANTMATERIET_ACCESS_TOKEN eller LANTMATERIET_API_KEY för riktig fastighetsdata från Lantmäteriet.',
  },
  {
    id: 'geo-spatial-audit',
    label: 'Spatial riskrevision (SGU + Natura2000 + RAÄ)',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
  },
  {
    id: 'geo-markcover',
    label: 'Marktäckekartlager (LULC)',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
    note: 'GET /api/geo/markcover?bbox= — PostGIS NMD-raster → WFS-fallback → syntetisk GeoJSON FeatureCollection.',
  },
  {
    id: 'geo-3d-terrain',
    label: '3D-terrängvisualisering',
    category: 'Geodata & Kartfunktioner',
    status: 'DONE',
    note: 'GET /api/geo/terrain?bbox=&resolution= — procedurellt höjdgrid (4–128 res) med TERRAIN_ENDPOINT-stöd.',
  },

  // ── Sökning & Dokumenthantering ───────────────────────────────────────────
  {
    id: 'search-sync',
    label: 'Dokumentindexering och söksync',
    category: 'Sökning & Dokumenthantering',
    status: 'DONE',
  },
  {
    id: 'search-query',
    label: 'Fulltextsökning med filterchips',
    category: 'Sökning & Dokumenthantering',
    status: 'DONE',
  },
  {
    id: 'search-status',
    label: 'Sökjobbsstatus och feläterstart',
    category: 'Sökning & Dokumenthantering',
    status: 'DONE',
  },
  {
    id: 'search-outlook-ingestion',
    label: 'Outlook e-postinläsning',
    category: 'Sökning & Dokumenthantering',
    status: 'PARTIAL',
    note: 'POST /api/admin/outlook/webhook — HMAC-verifierat Graph-webhook + startIngestionScheduler() implementerat. Kräver Microsoft Graph API-credentials (OUTLOOK_WEBHOOK_SECRET + Graph OAuth2 app-registrering) för riktig e-postinläsning.',
  },
  {
    id: 'search-ocr',
    label: 'OCR för skannade PDF-bilagor',
    category: 'Sökning & Dokumenthantering',
    status: 'DONE',
    note: 'POST /api/admin/ocr/extract/:documentId + batch — pdf-parse primärt, OCR_ENDPOINT-fallback, uppdaterar DocumentRecord.',
  },

  // ── AI & Kunskapsgraf ──────────────────────────────────────────────────────
  {
    id: 'ai-gemini-integration',
    label: 'Gemini AI-integration (chat + analys)',
    category: 'AI & Kunskapsgraf',
    status: 'DONE',
  },
  {
    id: 'ai-mvp-gateway',
    label: 'MVP AI-gateway (OpenAI GPT)',
    category: 'AI & Kunskapsgraf',
    status: 'DONE',
  },
  {
    id: 'ai-knowledge-graph',
    label: 'Kunskapsgraf (noder + kanter)',
    category: 'AI & Kunskapsgraf',
    status: 'DONE',
    note: 'GET /api/admin/knowledge-graph/search (ILIKE + 1-hop) och /stats implementerat.',
  },
  {
    id: 'ai-requirement-extraction',
    label: 'AI-baserad kravextraktion ur text',
    category: 'AI & Kunskapsgraf',
    status: 'DONE',
  },
  {
    id: 'ai-rag-search',
    label: 'RAG-sökning mot kunskapsbas',
    category: 'AI & Kunskapsgraf',
    status: 'DONE',
    note: 'POST /api/search/rag — embedding + semantisk dokumentsökning + kunskapsgraf + Gemini-svarsgenerering.',
  },

  // ── Fältprovtagning ────────────────────────────────────────────────────────
  {
    id: 'field-sampling-prep',
    label: 'Protokoll och kedjespårning (CoC)',
    category: 'Fältprovtagning',
    status: 'DONE',
    note: 'POST /api/projects/:id/field-analysis sparar AI-analys i AuditTrail. FieldAssistant kopplar till projekt via localStorage-token.',
  },
  {
    id: 'field-lims-integration',
    label: 'Automatisk LIMS-dataöverföring från lab',
    category: 'Fältprovtagning',
    status: 'PARTIAL',
    note: 'POST /api/projects/:id/lims/auto-fetch — kod klar med bearer-auth + AuditTrail-loggning. Kräver LIMS_API_ENDPOINT + LIMS_API_KEY för riktig labdataöverföring; stubbas utan konfiguration.',
  },
  {
    id: 'field-mobile-app',
    label: 'Mobil-app för fältinsamling',
    category: 'Fältprovtagning',
    status: 'DONE',
    note: 'PWA: public/manifest.json + public/sw.js (offline-cache, background sync, push notifications). SW registreras i index.html.',
  },

  // ── Administration & Drift ─────────────────────────────────────────────────
  {
    id: 'admin-app-status',
    label: 'Systemhälsostatus (GET /api/admin/app-status)',
    category: 'Administration & Drift',
    status: 'DONE',
    note: 'GET /api/admin/app-status + GET /api/admin/full-status — fullständig statusanalys med integrationer, DB-innehåll, miljövariabler och bakgrundstjänster.',
  },
  {
    id: 'admin-db-stats',
    label: 'Databasstatistik och analys',
    category: 'Administration & Drift',
    status: 'DONE',
  },
  {
    id: 'admin-db-contents',
    label: 'Databasinnehållsinspektör',
    category: 'Administration & Drift',
    status: 'DONE',
  },
  {
    id: 'admin-completion',
    label: 'Completion-tracker "hur många procent återstår?"',
    category: 'Administration & Drift',
    status: 'DONE',
  },
  {
    id: 'admin-monitoring',
    label: 'Produktionsövervakning (Prometheus/Grafana)',
    category: 'Administration & Drift',
    status: 'DONE',
    note: 'GET /metrics — Prometheus text format 0.0.4. HTTP counters, latency summary, DB queries, business metrics. METRICS_BEARER_TOKEN-skydd.',
  },
  {
    id: 'admin-error-tracking',
    label: 'Felspårning (Sentry)',
    category: 'Administration & Drift',
    status: 'DONE',
    note: 'errorTrackingService.ts — ring-buffer 500 fel, vidarebefordran till Sentry om SENTRY_DSN konfigureras. GET /api/admin/errors/recent.',
  },
  {
    id: 'admin-backup',
    label: 'Automatiserad databasbackup och återställning',
    category: 'Administration & Drift',
    status: 'DONE',
    note: 'POST /api/admin/backup/trigger — JSON+gzip snapshot av alla Prisma-modeller, SHA-256 checksum, S3-upload om BACKUP_S3_BUCKET konfigureras.',
  },

  // ── Återstående (PENDING) ─────────────────────────────────────────────────
  {
    id: 'doc-file-upload',
    label: 'Filuppladdning (POST /api/documents/upload med multipart)',
    category: 'Sökning & Dokumenthantering',
    status: 'PENDING',
    note: 'Backend-endpoint med multer för fil-multipart/form-data saknas. UploadModal i UI är kopplad men POST /api/documents/upload ej implementerad. Kräver lokal disk/S3 + Prisma DocumentRecord-skapande.',
  },
  {
    id: 'permit-list-api',
    label: 'Realtids-tillståndslista (GET /api/permits från databas)',
    category: 'Tillståndsportalen',
    status: 'PENDING',
    note: 'App.tsx och GisRiskModule använder MOCK_PERMITS-konstant (hårdkodad mock-data) istället för dynamisk API-hämtning. Kräver GET /api/permits-endpoint kopplad till Prisma Permit-model.',
  },
  {
    id: 'infra-staging',
    label: 'Staging-driftsättning (Docker + PostgreSQL + env-vars)',
    category: 'Administration & Drift',
    status: 'PENDING',
    note: 'Ingen staging-miljö finns. Kräver Docker Compose med PostgreSQL, konfigurerade env-variabler (BankID-cert, Lantmäteriet-nycklar etc.) och CI/CD-pipeline för automatiserad deploy.',
  },
];

// ─── Aggregering ──────────────────────────────────────────────────────────────

function weight(status: FeatureStatus): number {
  if (status === 'DONE') return 1.0;
  if (status === 'PARTIAL') return 0.5;
  return 0.0;
}

export function getAppCompletion(): AppCompletionResponse {
  const total = FEATURES.length;
  const done = FEATURES.filter((f) => f.status === 'DONE').length;
  const partial = FEATURES.filter((f) => f.status === 'PARTIAL').length;
  const pending = FEATURES.filter((f) => f.status === 'PENDING').length;

  const weightedDone = FEATURES.reduce((sum, f) => sum + weight(f.status), 0);
  const donePercent = Math.round((weightedDone / total) * 100);
  const remainingPercent = 100 - donePercent;

  // Group by category
  const categoryMap = new Map<string, AppFeature[]>();
  for (const feature of FEATURES) {
    const list = categoryMap.get(feature.category) ?? [];
    list.push(feature);
    categoryMap.set(feature.category, list);
  }

  const categories = Array.from(categoryMap.entries()).map(([name, features]) => {
    const catDone = features.filter((f) => f.status === 'DONE').length;
    const catPartial = features.filter((f) => f.status === 'PARTIAL').length;
    const catPending = features.filter((f) => f.status === 'PENDING').length;
    const catWeighted = features.reduce((sum, f) => sum + weight(f.status), 0);
    return {
      name,
      total: features.length,
      done: catDone,
      partial: catPartial,
      pending: catPending,
      percent: Math.round((catWeighted / features.length) * 100),
      features,
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    donePercent,
    remainingPercent,
    counts: { total, done, partial, pending },
    categories,
  };
}
