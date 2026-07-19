/**
 * Operativ täckning — mäter vad som faktiskt fungerar i drift (integrationer,
 * datakällor, kommundata), skilt från feature-manifestets kod-/implementeringsgrad.
 */

import { prisma } from '../db/prisma';
import { hasLantmaterietAuth } from '../security/env';
import { getPublicDatasourceSummary } from './publicUiService';
import { vertexConfigStatus } from './vertexAiService';

const SWEDISH_MUNICIPALITY_TARGET = 290;
const PRODUCTION_MUNICIPALITY_TARGET = 260;

export interface OperationalCoverageSnapshot {
  /** Sammansatt 0–100: genomsnitt av integrationer, datakällor, kommuner, kravtäckning */
  percent: number;
  integrations: {
    configured: number;
    total: number;
    percent: number;
  };
  datasources: {
    connected: number;
    total: number;
    percent: number;
  };
  municipalities: {
    covered: number;
    target: number;
    productionTarget: number;
    percent: number;
  };
  /** Andel dokument med minst ett krav (null om analys misslyckades) */
  documentRequirementCoveragePct: number | null;
  sguCoverageMode: 'sample' | 'complete';
  notes: string[];
}

function envPresent(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.trim().length > 0);
}

function integrationConfiguredChecks(): boolean[] {
  return [
    envPresent('BANKID_BASE_URL') &&
      (envPresent('BANKID_PFX_PATH') ||
        (envPresent('BANKID_CERT_PATH') && envPresent('BANKID_KEY_PATH'))),
    hasLantmaterietAuth(),
    vertexConfigStatus().configured,
    envPresent('AUTHORITY_SUBMIT_ENDPOINT') || envPresentAsTrue('AUTHORITY_MOCK_MODE'),
    envPresent('EIDAS_QTSP_ENDPOINT') && envPresent('EIDAS_QTSP_API_KEY'),
    envPresent('TERRAIN_ENDPOINT'),
    envPresent('OUTLOOK_GRAPH_TENANT_ID') &&
      envPresent('OUTLOOK_GRAPH_CLIENT_ID') &&
      envPresent('OUTLOOK_GRAPH_CLIENT_SECRET'),
    envPresent('LIMS_API_ENDPOINT') || envPresent('LIMS_SFTP_HOST'),
    envPresent('DATABASE_URL'),
  ];
}

function envPresentAsTrue(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function getSguCoverageMode(): 'sample' | 'complete' {
  return String(process.env.SGU_DB_COVERAGE_MODE || 'complete')
    .trim()
    .toLowerCase() === 'sample'
    ? 'sample'
    : 'complete';
}

async function countMunicipalitiesInDb(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(DISTINCT municipality)::int AS count
      FROM "DocumentRecord"
      WHERE municipality IS NOT NULL AND TRIM(municipality) <> ''
    `;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function documentRequirementCoveragePct(): Promise<number | null> {
  try {
    const [withReqs, totalDocs] = await Promise.all([
      prisma.documentRecord.count({ where: { requirements: { some: {} } } }),
      prisma.documentRecord.count(),
    ]);
    if (totalDocs === 0) return null;
    return Math.round((withReqs / totalDocs) * 100);
  } catch {
    return null;
  }
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Beräknar operativ täckning för aktuell miljö och databas.
 */
export async function getOperationalCoverage(): Promise<OperationalCoverageSnapshot> {
  const notes: string[] = [];
  const integrationFlags = integrationConfiguredChecks();
  const integrationsConfigured = integrationFlags.filter(Boolean).length;
  const integrationsTotal = integrationFlags.length;
  const integrationsPercent = pct(integrationsConfigured, integrationsTotal);

  let datasourcesConnected = 0;
  let datasourcesTotal = 0;
  try {
    const summary = await getPublicDatasourceSummary(false);
    const cards = summary?.cards ?? [];
    datasourcesTotal = cards.length;
    datasourcesConnected = cards.filter((c) => c.status === 'CONNECTED').length;
  } catch {
    notes.push('Kunde inte hämta datakällstatus.');
  }
  const datasourcesPercent = pct(datasourcesConnected, datasourcesTotal);

  const municipalitiesCovered = await countMunicipalitiesInDb();
  const municipalitiesPercent = pct(municipalitiesCovered, PRODUCTION_MUNICIPALITY_TARGET);
  if (municipalitiesCovered < PRODUCTION_MUNICIPALITY_TARGET) {
    notes.push(
      `Kommundata: ${municipalitiesCovered}/${PRODUCTION_MUNICIPALITY_TARGET} krävs för produktion (${SWEDISH_MUNICIPALITY_TARGET} totalt i Sverige).`,
    );
  }

  const docReqPct = await documentRequirementCoveragePct();
  if (docReqPct != null && docReqPct < 50) {
    notes.push(`Kravtäckning i dokument: ${docReqPct}% har kopplade krav.`);
  }

  const sguCoverageMode = getSguCoverageMode();
  if (sguCoverageMode === 'sample') {
    notes.push('SGU körs i sample-läge (SGU_DB_COVERAGE_MODE=sample) — inte full geotäckning.');
  }

  const components = [
    integrationsPercent,
    datasourcesTotal > 0 ? datasourcesPercent : integrationsPercent,
    municipalitiesPercent,
    docReqPct ?? municipalitiesPercent,
  ];
  const percent = Math.round(components.reduce((sum, v) => sum + v, 0) / components.length);

  return {
    percent,
    integrations: {
      configured: integrationsConfigured,
      total: integrationsTotal,
      percent: integrationsPercent,
    },
    datasources: {
      connected: datasourcesConnected,
      total: datasourcesTotal,
      percent: datasourcesPercent,
    },
    municipalities: {
      covered: municipalitiesCovered,
      target: SWEDISH_MUNICIPALITY_TARGET,
      productionTarget: PRODUCTION_MUNICIPALITY_TARGET,
      percent: municipalitiesPercent,
    },
    documentRequirementCoveragePct: docReqPct,
    sguCoverageMode,
    notes,
  };
}
