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
    status: 'DONE',
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
    status: 'PARTIAL',
    note: 'Datamodell finns. Inbjudningsflöde och UI-vy saknas.',
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
    status: 'PARTIAL',
    note: 'Komponent finns men kopplas inte till live projektdata.',
  },
  {
    id: 'project-member-roles',
    label: 'Projektmedlemmar och rollbehörigheter',
    category: 'Projekthantering',
    status: 'PARTIAL',
    note: 'Datamodell finns. UI och API för redigering saknas.',
  },
  {
    id: 'project-notifications',
    label: 'E-postaviseringar vid stagegatebyte',
    category: 'Projekthantering',
    status: 'PENDING',
    note: 'Ej implementerat.',
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
    status: 'PARTIAL',
    note: 'Flödet finns men skickar inte till myndighet.',
  },
  {
    id: 'permit-authority-submit',
    label: 'Digital inlämning till länsstyrelse/kommunen',
    category: 'Tillståndsportalen',
    status: 'PENDING',
    note: 'API-integration mot myndighetsystemet saknas.',
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
    status: 'PARTIAL',
    note: 'UI finns. Realtidsprisdata och utbudslistor saknas.',
  },
  {
    id: 'logistics-gps-tracking',
    label: 'GPS-spårning av transporter',
    category: 'Logistik & Transport',
    status: 'PENDING',
    note: 'gpsTrackHash-fält finns i schema. Integrering mot extern spårningstjänst saknas.',
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
    status: 'PARTIAL',
    note: 'Vy finns. AI-generering är synkron; asynkron köhantering saknas.',
  },
  {
    id: 'compliance-digital-signature',
    label: 'Kvalificerade e-signaturer (EU eIDAS)',
    category: 'Compliance & Revision',
    status: 'PENDING',
    note: 'BankID-signatur fungerar. eIDAS-kvalificerad nivå ej implementerad.',
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
    status: 'DONE',
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
    status: 'PARTIAL',
    note: 'Route finns. Extern LULC-datakälla inte konfigurerad.',
  },
  {
    id: 'geo-3d-terrain',
    label: '3D-terrängvisualisering',
    category: 'Geodata & Kartfunktioner',
    status: 'PENDING',
    note: 'Ej planlagd i nuvarande sprint.',
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
    note: 'Service och schema finns. Produktionsschedulering och webhook-trigger saknas.',
  },
  {
    id: 'search-ocr',
    label: 'OCR för skannade PDF-bilagor',
    category: 'Sökning & Dokumenthantering',
    status: 'PENDING',
    note: 'Ej implementerat.',
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
    status: 'PARTIAL',
    note: 'Datamodell och service finns. UI-visualisering och grafsökning saknas.',
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
    status: 'PARTIAL',
    note: 'Checklistverifiering fungerar. Generell RAG-sökning för slutanvändare saknas.',
  },

  // ── Fältprovtagning ────────────────────────────────────────────────────────
  {
    id: 'field-sampling-prep',
    label: 'Protokoll och kedjespårning (CoC)',
    category: 'Fältprovtagning',
    status: 'PARTIAL',
    note: 'SamplingPreparation-datamodell klar. FieldAssistant-flödet är delvis ihopkopplat.',
  },
  {
    id: 'field-lims-integration',
    label: 'Automatisk LIMS-dataöverföring från lab',
    category: 'Fältprovtagning',
    status: 'PENDING',
    note: 'Manuell inläsning fungerar. Automatisk API-integrering mot lab-system saknas.',
  },
  {
    id: 'field-mobile-app',
    label: 'Mobil-app för fältinsamling',
    category: 'Fältprovtagning',
    status: 'PENDING',
    note: 'Ej påbörjad.',
  },

  // ── Administration & Drift ─────────────────────────────────────────────────
  {
    id: 'admin-app-status',
    label: 'Systemhälsostatus (GET /api/admin/app-status)',
    category: 'Administration & Drift',
    status: 'DONE',
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
    status: 'PENDING',
    note: 'Ej konfigurerat.',
  },
  {
    id: 'admin-error-tracking',
    label: 'Felspårning (Sentry)',
    category: 'Administration & Drift',
    status: 'PENDING',
    note: 'Ej integrerat.',
  },
  {
    id: 'admin-backup',
    label: 'Automatiserad databasbackup och återställning',
    category: 'Administration & Drift',
    status: 'PENDING',
    note: 'Ej konfigurerat i CI/CD-pipeline.',
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
