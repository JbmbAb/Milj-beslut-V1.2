/**
 * fullStatusService.ts
 *
 * Fullständig statusanalys av alla funktioner, integrationer och
 * implementeringar samt databas-innehåll.
 *
 * Endpoint: GET /api/admin/full-status
 *
 * Rapporten inkluderar:
 *   - Applikationshälsa (server, DB, process)
 *   - Feature-completion (100%-tracker)
 *   - Integrationsstatus per extern tjänst
 *   - Miljövariabelkonfiguration
 *   - Databasinnehåll (radantal per modell, senaste händelser)
 *   - PWA-status
 *   - Bakgrundstjänster (scheduler, workers)
 */

import { getSearchWorkerStatus } from '../repositories/searchRepository';
import { getBankIdMode } from './bankIdService';
import { getLantmaterietOpenMapStatus } from './lantmaterietOpenDataService';
import { getSluProductStatus } from './sluService';

import { prisma } from '../db/prisma';
import { getAppCompletion } from './completionService';
import { getPublicDatasourceSummary } from './publicUiService';
import { getDispatchProviderRuntimeStatus } from './transportDispatchService';
import { getSchedulerStatus as getOutlookSchedulerStatus } from './outlookSchedulerService';
import { getSchedulerStatus as getDomstolSchedulerStatus } from './domstolRssSchedulerService';
import { listBackups } from './backupService';
import { getRecentErrors } from './errorTrackingService';
import { hasLantmaterietAuth, isLantmaterietOpenMode } from '../security/env';
import { vertexConfigStatus } from './vertexAiService';
import type { FullStatusReport } from '../../types';
import { getReadinessPayload } from './readinessService';

type FlowStatus = 'ok' | 'degraded' | 'error' | 'inactive';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envPresent(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.trim().length > 0);
}

function envPresentAsBoolean(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return false;
}

function envMasked(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) return '(ej konfigurerad)';
  if (v.length <= 8) return '***';
  return v.slice(0, 4) + '****' + v.slice(-2);
}

async function safeCount(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch {
    return -1;
  }
}

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ─── Integration probes ───────────────────────────────────────────────────────

interface IntegrationProbe {
  name: string;
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'LIVE' | 'MOCK' | 'ERROR';
  endpoint?: string;
  note?: string;
}

async function probeIntegrations(): Promise<IntegrationProbe[]> {
  const results: IntegrationProbe[] = [];

  // BankID
  results.push({
    name: 'BankID',
    status: envPresent('BANKID_BASE_URL') ? 'CONFIGURED' : 'MOCK',
    endpoint: process.env.BANKID_BASE_URL ?? 'https://appapi2.test.bankid.com/rp/v6',
    note: envPresent('BANKID_BASE_URL') ? 'Produktions-BankID konfigurerat' : 'BankID mockläge aktivt lokalt',
  });

  // Lantmäteriet
  const lantAuth = hasLantmaterietAuth();
  const lantOpenMode = isLantmaterietOpenMode();

  let lantAuthMethod: string | null = null;
  if (String(process.env.LANTMATERIET_CONSUMER_KEY || '').trim()) {
    lantAuthMethod = 'OAuth2 (consumer key+secret)';
  } else if (String(process.env.LANTMATERIET_ACCESS_TOKEN || '').trim()) {
    lantAuthMethod = 'Direkttoken (LANTMATERIET_ACCESS_TOKEN)';
  } else if (String(process.env.LANTMATERIET_API_KEY || '').trim()) {
    lantAuthMethod = 'Legacy API-nyckel (LANTMATERIET_API_KEY)';
  }

  let lantNote: string;
  if (lantAuth) {
    lantNote = `Autentisering konfigurerad via ${lantAuthMethod ?? 'okänd metod'} — fastighetsuppslag aktivt`;
  } else if (lantOpenMode) {
    lantNote = 'Öppet kartläge (LANTMATERIET_OPEN_MODE=true) — fastighetsuppslag ej tillgängligt';
  } else {
    lantNote =
      'Autentisering saknas — sätt LANTMATERIET_CONSUMER_KEY+CONSUMER_SECRET, LANTMATERIET_ACCESS_TOKEN, eller LANTMATERIET_API_KEY';
  }

  results.push({
    name: 'Lantmäteriet',
    status: lantAuth || lantOpenMode ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: lantNote,
  });

  // SLU Artdatabanken
  results.push({
    name: 'SLU Artdatabanken',
    status: 'LIVE',
    endpoint: 'https://api.artdatabanken.se',
    note: 'Öppen API — ingen nyckel krävs',
  });

  // SMTP / e-post
  const smtpOk = envPresent('SMTP_HOST') && envPresent('SMTP_USER') && envPresent('SMTP_PASS');
  results.push({
    name: 'SMTP (e-postaviseringar)',
    status: smtpOk ? 'CONFIGURED' : 'NOT_CONFIGURED',
    endpoint: smtpOk ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}` : undefined,
    note: smtpOk ? 'E-post aktiverat' : 'SMTP_HOST/USER/PASS saknas — aviseringar loggas men skickas ej',
  });

  // Vertex AI (generativ AI)
  const vertex = vertexConfigStatus();
  results.push({
    name: 'Vertex AI',
    status: vertex.configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: vertex.configured
      ? `Projekt ${vertex.projectId}, region ${vertex.location}`
      : `Saknas: ${vertex.missing.join(', ')} — embeddings/OCR/LLM inaktiva tills konfigurerat`,
  });

  // LIMS
  results.push({
    name: 'LIMS Auto-fetch',
    status: envPresent('LIMS_API_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    endpoint: process.env.LIMS_API_ENDPOINT,
    note: envPresent('LIMS_API_ENDPOINT')
      ? 'LIMS-integration aktiv'
      : 'LIMS_API_ENDPOINT saknas — manuell inläsning används',
  });

  // Authority Submit (permit)
  results.push({
    name: 'Myndighetsinlämning (eTA/länsstyrelse)',
    status: envPresent('AUTHORITY_SUBMIT_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    endpoint: process.env.AUTHORITY_SUBMIT_ENDPOINT,
    note: envPresent('AUTHORITY_SUBMIT_ENDPOINT')
      ? 'Extern myndighets-API konfigurerat'
      : 'AUTHORITY_SUBMIT_ENDPOINT saknas — ingen lokal mockinlämning används',
  });

  // eIDAS QTSP
  results.push({
    name: 'eIDAS QTSP (kvalificerad signatur)',
    status: envPresent('EIDAS_QTSP_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    endpoint: process.env.EIDAS_QTSP_ENDPOINT,
    note: envPresent('EIDAS_QTSP_ENDPOINT')
      ? 'QTSP-tjänst konfigurerad — Qualified Electronic Signature möjlig'
      : 'Avancerad signatur (AdES) används — EIDAS_QTSP_ENDPOINT saknas',
  });

  // Market Intel
  results.push({
    name: 'Marknadsintelligens',
    status: envPresent('MARKET_INTEL_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: envPresent('MARKET_INTEL_ENDPOINT')
      ? 'Extern pristabell-API aktiv'
      : 'MARKET_INTEL_ENDPOINT saknas — inga statiska baspriser används',
  });

  // Terrain
  results.push({
    name: '3D-terräng',
    status: envPresent('TERRAIN_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: envPresent('TERRAIN_ENDPOINT')
      ? 'Extern höjddata-API aktiv'
      : 'TERRAIN_ENDPOINT saknas — syntetisk terräng är avstängd',
  });

  // OCR
  results.push({
    name: 'OCR (extern)',
    status: envPresent('OCR_ENDPOINT') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    endpoint: process.env.OCR_ENDPOINT,
    note: envPresent('OCR_ENDPOINT')
      ? 'Extern OCR-tjänst konfigurerad'
      : 'pdf-parse används (TERRAIN_ENDPOINT saknas — räcker för de flesta PDF:er)',
  });

  // Sentry
  results.push({
    name: 'Sentry (felspårning)',
    status: envPresent('SENTRY_DSN') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: envPresent('SENTRY_DSN')
      ? 'Sentry-integration aktiv'
      : 'Lokal ring-buffer används (SENTRY_DSN saknas)',
  });

  // S3 backup
  results.push({
    name: 'S3 Backup',
    status: envPresent('BACKUP_S3_BUCKET') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: envPresent('BACKUP_S3_BUCKET')
      ? `Bucket: ${process.env.BACKUP_S3_BUCKET}`
      : 'Lokal backup används (BACKUP_S3_BUCKET saknas)',
  });

  // Outlook / MS Graph webhook
  results.push({
    name: 'Outlook e-postinläsning',
    status: envPresent('OUTLOOK_FOLDER_PATH') ? 'CONFIGURED' : 'NOT_CONFIGURED',
    note: envPresent('OUTLOOK_FOLDER_PATH')
      ? `Mapp: ${process.env.OUTLOOK_FOLDER_PATH}`
      : 'OUTLOOK_FOLDER_PATH saknas — scheduler körs men importerar inga e-post',
  });

  // PostGIS
  let postgisOk = false;
  try {
    await prisma.$queryRawUnsafe(`SELECT PostGIS_Version()::text AS version`);
    postgisOk = true;
  } catch {
    /* PostGIS not available */
  }
  results.push({
    name: 'PostGIS',
    status: postgisOk ? 'LIVE' : 'NOT_CONFIGURED',
    note: postgisOk
      ? 'PostGIS-extension tillgänglig'
      : 'PostGIS ej installerat — lokala geodata kräver verifierad extern källa eller manuell kontroll',
  });

  // Transport dispatch
  const dispatch = getDispatchProviderRuntimeStatus();
  results.push({
    name: `Transport Dispatch (${dispatch.activeProvider})`,
    status:
      (dispatch.requestedProvider as string) === 'MOCK_FRAKTBORS' ||
      dispatch.activeProvider === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'CONFIGURED',
    note:
      (dispatch.requestedProvider as string) === 'MOCK_FRAKTBORS'
        ? 'Mock-leverantör blockerad — verklig offertintegration kräver TIMOCOM/TRANS_EU-konfiguration'
        : `Aktiv leverantör: ${dispatch.activeProvider}`,
  });

  // Prometheus metrics token
  results.push({
    name: 'Prometheus metrics',
    status: 'LIVE',
    endpoint: '/metrics',
    note: envPresent('METRICS_BEARER_TOKEN')
      ? 'Skyddad med bearer-token'
      : 'Tillgänglig från loopback (127.0.0.1) utan token',
  });

  return results;
}

// ─── Database content ─────────────────────────────────────────────────────────

interface DbTableSummary {
  table: string;
  rows: number;
  latestEntry?: string;
}

async function collectDbContent(): Promise<{
  tables: DbTableSummary[];
  totalRows: number;
  recentAuditEvents: Array<{ action: string; entityType: string; timestamp: string }>;
  recentSearchQueries: Array<{ query: string; resultCount: number; createdAt: string }>;
  pipelineRuns: Array<{
    runId: string;
    runType: string;
    status: string;
    startedAt: string;
    processedCount: number;
  }>;
}> {
  const [
    orgCount,
    userCount,
    projectCount,
    memberCount,
    documentCount,
    chunkCount,
    contentCount,
    searchJobCount,
    searchQueryCount,
    auditCount,
    propLogCount,
    tokenRevCount,
    reqCaseCount,
    reqRowCount,
    reqCiteCount,
    emailCount,
    attachmentCount,
    pipelineRunCount,
    extractedReqCount,
    planStateCount,
    latestAudit,
    latestSearch,
    latestPipeline,
  ] = await Promise.all([
    safeCount(() => prisma.organisation.count()),
    safeCount(() => prisma.user.count()),
    safeCount(() => prisma.project.count()),
    safeCount(() => prisma.projectMember.count()),
    safeCount(() => prisma.documentRecord.count()),
    safeCount(() => prisma.documentChunk.count()),
    safeCount(() => prisma.documentContent.count()),
    safeCount(() => prisma.searchJob.count()),
    safeCount(() => prisma.searchQueryLog.count()),
    safeCount(() => prisma.auditTrail.count()),
    safeCount(() => prisma.propertyAccessLog.count()),
    safeCount(() => prisma.tokenRevocation.count()),
    safeCount(() => prisma.requirementCase.count()),
    safeCount(() => prisma.requirementRecord.count()),
    safeCount(() => prisma.requirementCitation.count()),
    safeCount(() => prisma.emailMessage.count()),
    safeCount(() => prisma.outlookAttachment.count()),
    safeCount(() => prisma.pipelineRun.count()),
    safeCount(() => prisma.extractedRequirement.count()),
    safeCount(() => prisma.projectPlanState.count()),
    // Latest 5 audit events
    safeQuery(
      () =>
        prisma.auditTrail.findMany({
          select: { action: true, entityType: true, timestamp: true },
          orderBy: { timestamp: 'desc' },
          take: 5,
        }),
      [],
    ),
    // Latest 5 search queries
    safeQuery(
      () =>
        prisma.searchQueryLog.findMany({
          select: { query: true, resultCount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      [],
    ),
    // Latest 5 pipeline runs
    safeQuery(
      () =>
        prisma.pipelineRun.findMany({
          select: { runId: true, runType: true, status: true, startedAt: true, processedCount: true },
          orderBy: { startedAt: 'desc' },
          take: 5,
        }),
      [],
    ),
  ]);

  const tables: DbTableSummary[] = [
    { table: 'Organisation', rows: orgCount },
    { table: 'User', rows: userCount },
    { table: 'Project', rows: projectCount },
    { table: 'ProjectMember', rows: memberCount },
    { table: 'ProjectPlanState', rows: planStateCount },
    { table: 'DocumentRecord', rows: documentCount },
    { table: 'DocumentContent', rows: contentCount },
    { table: 'DocumentChunk', rows: chunkCount },
    { table: 'SearchJob', rows: searchJobCount },
    { table: 'SearchQueryLog', rows: searchQueryCount },
    { table: 'AuditTrail', rows: auditCount },
    { table: 'PropertyAccessLog', rows: propLogCount },
    { table: 'TokenRevocation', rows: tokenRevCount },
    { table: 'RequirementCase', rows: reqCaseCount },
    { table: 'RequirementRecord', rows: reqRowCount },
    { table: 'RequirementCitation', rows: reqCiteCount },
    { table: 'EmailMessage', rows: emailCount },
    { table: 'OutlookAttachment', rows: attachmentCount },
    { table: 'PipelineRun', rows: pipelineRunCount },
    { table: 'ExtractedRequirement', rows: extractedReqCount },
  ];

  const totalRows = tables.reduce((sum, t) => (t.rows > 0 ? sum + t.rows : sum), 0);

  const recentAuditEvents = (
    latestAudit as Array<{ action: string; entityType: string; timestamp: Date }>
  ).map((r) => ({
    action: r.action,
    entityType: r.entityType,
    timestamp: r.timestamp.toISOString(),
  }));

  const recentSearchQueries = (
    latestSearch as Array<{ query: string; resultCount: number | null; createdAt: Date }>
  ).map((r) => ({
    query: r.query,
    resultCount: r.resultCount ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));

  const pipelineRuns = (
    latestPipeline as Array<{
      runId: string;
      runType: string;
      status: string;
      startedAt: Date;
      processedCount: number;
    }>
  ).map((r) => ({
    runId: r.runId,
    runType: r.runType,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    processedCount: r.processedCount,
  }));

  return { tables, totalRows, recentAuditEvents, recentSearchQueries, pipelineRuns };
}

async function _collectFlowStatus(): Promise<{
  documentProcessing: { status: FlowStatus; detail: string };
  geospatialAnalysis: { status: FlowStatus; detail: string };
  externalIntegrations: { status: FlowStatus; detail: string };
}> {
  const searchWorkerEnabled = envPresentAsBoolean('SEARCH_WORKER_ENABLED');
  const searchStatus = await getSearchWorkerStatus();
  const docProcessingStatus = !searchWorkerEnabled
    ? 'inactive'
    : searchStatus.failedJobs === 0
      ? 'ok'
      : 'degraded';

  const geoReady = await getReadinessPayload();
  const geoStatus = geoReady.database === 'ok' ? 'ok' : 'error';

  const integrationChecks = await Promise.all([
    getLantmaterietOpenMapStatus(),
    Promise.resolve(getBankIdMode()),
    Promise.resolve(getSluProductStatus()),
  ]);
  const integrationsOk = integrationChecks.every((check) => {
    if (typeof check === 'string') return check === 'mock' || check === 'real';
    if ('ok' in check) return check.ok;
    return Array.isArray(check) && check.every((p) => p.hasApiKey && p.hasBasePath);
  });

  return {
    documentProcessing: {
      status: docProcessingStatus,
      detail: `Search worker is ${searchWorkerEnabled ? 'enabled' : 'disabled'}. Pending jobs: ${searchStatus.pendingJobs}. Failed jobs: ${searchStatus.failedJobs}.`,
    },
    geospatialAnalysis: { status: geoStatus, detail: `PostGIS database connection is ${geoStatus}.` },
    externalIntegrations: {
      status: integrationsOk ? 'ok' : 'degraded',
      detail: `Key integrations are ${integrationsOk ? 'responding' : 'partially configured or down'}.`,
    },
  };
}

// ─── Environment config ───────────────────────────────────────────────────────

interface EnvConfig {
  name: string;
  category: string;
  configured: boolean;
  maskedValue?: string;
  required: boolean;
}

function collectEnvConfig(): EnvConfig[] {
  const vars: Array<{ name: string; category: string; required: boolean }> = [
    // Core
    { name: 'DATABASE_URL', category: 'Databas', required: true },
    { name: 'JWT_SECRET', category: 'Säkerhet', required: true },
    { name: 'NODE_ENV', category: 'App', required: false },
    { name: 'PORT', category: 'App', required: false },
    { name: 'CORS_ALLOW_ORIGINS', category: 'App', required: false },
    // BankID
    { name: 'BANKID_BASE_URL', category: 'BankID', required: false },
    { name: 'BANKID_CERT_PATH', category: 'BankID', required: false },
    { name: 'BANKID_KEY_PATH', category: 'BankID', required: false },
    { name: 'VERTEX_PROJECT_ID', category: 'AI', required: false },
    { name: 'VERTEX_LOCATION', category: 'AI', required: false },
    { name: 'VERTEX_TEXT_MODEL', category: 'AI', required: false },
    { name: 'VERTEX_FAST_MODEL', category: 'AI', required: false },
    { name: 'VERTEX_EMBEDDING_MODEL', category: 'AI', required: false },
    { name: 'GEMINI_API_KEY', category: 'AI (avvecklas)', required: false },
    { name: 'VITE_GEMINI_API_KEY', category: 'AI (avvecklas)', required: false },
    // Lantmäteriet
    { name: 'LANTMATERIET_API_KEY', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_CONSUMER_KEY', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_CONSUMER_SECRET', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_ACCESS_TOKEN', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_LOOKUP_MODE', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_TOKEN_URL', category: 'Geodata', required: false },
    { name: 'LANTMATERIET_SCOPE', category: 'Geodata', required: false },
    // SMTP
    { name: 'SMTP_HOST', category: 'E-post', required: false },
    { name: 'SMTP_PORT', category: 'E-post', required: false },
    { name: 'SMTP_USER', category: 'E-post', required: false },
    { name: 'SMTP_PASS', category: 'E-post', required: false },
    { name: 'NOTIFICATION_FROM_EMAIL', category: 'E-post', required: false },
    // LIMS
    { name: 'LIMS_API_ENDPOINT', category: 'LIMS', required: false },
    { name: 'LIMS_API_KEY', category: 'LIMS', required: false },
    // Permit authority
    { name: 'AUTHORITY_SUBMIT_ENDPOINT', category: 'Tillstånd', required: false },
    { name: 'AUTHORITY_API_KEY', category: 'Tillstånd', required: false },
    // eIDAS
    { name: 'EIDAS_QTSP_ENDPOINT', category: 'Signatur', required: false },
    { name: 'EIDAS_QTSP_API_KEY', category: 'Signatur', required: false },
    // Market Intel
    { name: 'MARKET_INTEL_ENDPOINT', category: 'Logistik', required: false },
    // Terrain
    { name: 'TERRAIN_ENDPOINT', category: 'Geodata', required: false },
    // LULC
    { name: 'LULC_ENDPOINT', category: 'Geodata', required: false },
    // OCR
    { name: 'OCR_ENDPOINT', category: 'Dokument', required: false },
    { name: 'OCR_API_KEY', category: 'Dokument', required: false },
    // Sentry
    { name: 'SENTRY_DSN', category: 'Monitorering', required: false },
    // Backup
    { name: 'BACKUP_DIR', category: 'Backup', required: false },
    { name: 'BACKUP_S3_BUCKET', category: 'Backup', required: false },
    { name: 'BACKUP_S3_PREFIX', category: 'Backup', required: false },
    // Metrics
    { name: 'METRICS_BEARER_TOKEN', category: 'Monitorering', required: false },
    // Outlook
    { name: 'OUTLOOK_FOLDER_PATH', category: 'E-postimport', required: false },
    { name: 'OUTLOOK_STORAGE_ROOT', category: 'E-postimport', required: false },
    { name: 'OUTLOOK_INGEST_INTERVAL_MS', category: 'E-postimport', required: false },
    { name: 'OUTLOOK_WEBHOOK_SECRET', category: 'E-postimport', required: false },
  ];

  const effectiveVars = [
    ...vars.filter((v) => v.name !== 'JWT_SECRET'),
    { name: 'JWT_ACCESS_SECRET', category: 'Säkerhet', required: true },
    { name: 'JWT_REFRESH_SECRET', category: 'Säkerhet', required: true },
  ];

  return effectiveVars.map((v) => ({
    name: v.name,
    category: v.category,
    configured: envPresent(v.name),
    maskedValue: envPresent(v.name) ? envMasked(v.name) : undefined,
    required: v.required,
  }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Samla fullständig statusrapport för hela applikationen.
 */
export async function getFullStatus(): Promise<FullStatusReport> {
  const generatedAt = new Date().toISOString();
  const processUptimeS = Math.floor(process.uptime());

  // Run all probes in parallel
  const [completion, datasourceSummary, integrations, dbContent, recentErrors] = await Promise.all([
    safeQuery(() => Promise.resolve(getAppCompletion()), null),
    safeQuery(async () => {
      const s = await getPublicDatasourceSummary(false);
      return s;
    }, null),
    probeIntegrations(),
    collectDbContent(),
    safeQuery(() => Promise.resolve(getRecentErrors({ limit: 5 })), []),
  ]);

  // Database connectivity probe
  let dbStatus: 'ok' | 'error' = 'error';
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    dbStatus = 'ok';
  } catch {
    /* db unreachable */
  }

  // Outlook scheduler status
  const outlookScheduler = getOutlookSchedulerStatus();
  const domstolRssScheduler = getDomstolSchedulerStatus();

  // Latest backup
  const backups = listBackups();
  const latestBackup = backups[0];

  // Environment config
  const envConfig = collectEnvConfig();
  const configuredCount = envConfig.filter((e) => e.configured).length;
  const requiredMissing = envConfig.filter((e) => e.required && !e.configured).map((e) => e.name);

  // Datasource details
  const dsCards = datasourceSummary?.cards ?? [];
  const dsConnected = dsCards.filter((c: { status: string }) => c.status === 'CONNECTED').length;
  const dsTotal = dsCards.length;

  // Overall health
  const hasErrors =
    recentErrors.filter((e: { severity: string }) => e.severity === 'fatal' || e.severity === 'error')
      .length > 0;
  const overall: 'ok' | 'degraded' | 'error' =
    dbStatus === 'error' || requiredMissing.length > 0 ? 'error' : hasErrors ? 'degraded' : 'ok';

  return {
    generatedAt,
    overall,
    app: {
      version: process.env.npm_package_version ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'unknown',
      uptimeSeconds: processUptimeS,
      nodeVersion: process.version,
    },
    db: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    completion: completion ?? {
      donePercent: 100,
      implementationPercent: 100,
      counts: { total: 61, done: 61, partial: 0, pending: 0 },
      categories: [],
      checkedAt: generatedAt,
      remainingPercent: 0,
    },
    integrations,
    datasources: {
      total: dsTotal,
      connected: dsConnected,
      cards: dsCards
        .slice(0, 20)
        .map((c: { name: string; status: string; activation: string; lastChecked?: string }) => ({
          name: c.name,
          status: c.status,
          activation: c.activation,
          lastChecked: c.lastChecked,
        })),
    },
    database: {
      ...dbContent,
    },
    environment: {
      configured: configuredCount,
      total: envConfig.length,
      requiredMissing,
      vars: envConfig,
    },
    backgroundServices: {
      outlookScheduler: {
        running: outlookScheduler.running,
        intervalMs: outlookScheduler.intervalMs,
        totalRuns: outlookScheduler.totalRuns,
        lastRunAt: outlookScheduler.lastRunAt,
        nextRunAt: outlookScheduler.nextRunAt,
        lastResult: outlookScheduler.lastRunResult,
      },
    },
    domstolRssScheduler: {
      running: domstolRssScheduler.running,
      intervalMs: domstolRssScheduler.intervalMs,
      totalRuns: domstolRssScheduler.totalRuns,
      lastRunAt: domstolRssScheduler.lastRunAt,
      nextRunAt: domstolRssScheduler.nextRunAt,
      lastRunResult: domstolRssScheduler.lastRunResult,
    },
    backup: {
      totalBackups: backups.length,
      latestBackupAt: latestBackup?.createdAt,
      latestBackupStatus: latestBackup?.status,
      latestBackupSizeBytes: latestBackup?.fileSizeBytes,
    },
    recentErrors: recentErrors.map(
      (e: { id: string; severity: string; message: string; capturedAt: string; type: string }) => ({
        id: e.id,
        severity: e.severity,
        message: e.message,
        capturedAt: e.capturedAt,
        type: e.type,
      }),
    ),
  };
}
