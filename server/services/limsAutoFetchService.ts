import { logger } from '../logger';
import { createLimsReport } from './limsService';
import { appendDomainAudit } from '../security/auditTrail';
import type { LimsReport } from '../../types';

export interface LimsLabResult {
  sampleId: string;
  labName: string;
  measuredAt: Date;
  substance: string;
  value: number;
  unit: string;
  thresholdMax?: number;
}

export interface LimsIngestResult {
  ok: boolean;
  imported: number;
  warnings: number;
  errors: string[];
}

/**
 * LIMS (Laboratory Information Management System) Integration Service.
 * 
 * Automatically fetches or receives lab analysis results from partners like Eurofins/ALS
 * and maps them against MPF thresholds and environmental standards.
 */
export async function triggerLimsAutoFetch(): Promise<LimsIngestResult> {
  logger.info('LIMS: Starting auto-fetch cycle');
  
  // Implementation Note: In a production environment, this would call 
  // an external API or fetch from a secure SFTP/S3 bucket.
  
  const results: LimsLabResult[] = [
    // Mock data for initial implementation
    { 
      sampleId: 'S-2026-001', 
      labName: 'Eurofins Environment', 
      measuredAt: new Date(), 
      substance: 'Bly (Pb)', 
      value: 85, 
      unit: 'mg/kg TS' 
    },
    { 
      sampleId: 'S-2026-002', 
      labName: 'Eurofins Environment', 
      measuredAt: new Date(), 
      substance: 'Kvicksilver (Hg)', 
      value: 0.12, 
      unit: 'mg/kg TS' 
    }
  ];

  let imported = 0;
  let warnings = 0;

  for (const res of results) {
    try {
      // 1. Log to database
      // await prisma.labAnalysis.create({ data: res });

      // 2. Cross-reference with MPF requirements
      // If Pb > threshold, we might need a specific permit or classification.
      if (res.substance === 'Bly (Pb)' && res.value > 80) {
        warnings++;
        logger.warn('LIMS: High concentration detected', { sample: res.sampleId, val: res.value });
      }

      imported++;
    } catch (err) {
      logger.error('LIMS: Failed to process sample', { sample: res.sampleId, error: String(err) });
    }
  }

  return {
    ok: true,
    imported,
    warnings,
    errors: []
  };
}

/**
 * Endpoint for partner webhooks (Eurofins/ALS).
 */
export async function handleLimsWebhook(_payload: any): Promise<{ ok: boolean }> {
  logger.info('LIMS: Received webhook payload');
  // Logic to parse standard formats (XML/JSON) and trigger ingest
  return { ok: true };
}

export interface AutoFetchLimsReportsParams {
  projectId: string;
  actingUserId: string;
  since?: string;
}

export interface AutoFetchLimsReportsResult {
  status: 'NOT_CONFIGURED' | 'SUCCESS' | 'NO_NEW_REPORTS' | 'FAILED' | 'PARTIAL';
  reportsImported: number;
  reports: LimsReport[];
  errorMessages: string[];
  projectId: string;
  auditId: string;
}

export async function autoFetchLimsReports(
  params: AutoFetchLimsReportsParams
): Promise<AutoFetchLimsReportsResult> {
  const { projectId, actingUserId, since } = params;

  // Append audit trail first
  const auditRecord = await appendDomainAudit({
    entityType: 'LIMS_AUTO_FETCH',
    entityId: projectId,
    action: 'LIMS_AUTO_FETCH',
    userId: actingUserId,
    payload: { since: since || null },
  });
  const auditId = auditRecord.id;

  const endpoint = process.env.LIMS_API_ENDPOINT;
  if (!endpoint) {
    return {
      status: 'NOT_CONFIGURED',
      reportsImported: 0,
      reports: [],
      errorMessages: [],
      projectId,
      auditId,
    };
  }

  let url = endpoint;
  if (since) {
    const separator = url.includes('?') ? '&' : '?';
    const sinceDate = since.split('T')[0];
    url += `${separator}since=${sinceDate}`;
  }

  const headers: Record<string, string> = {};
  if (process.env.LIMS_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.LIMS_API_KEY}`;
  }

  let reportsData: any[];
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return {
        status: 'FAILED',
        reportsImported: 0,
        reports: [],
        errorMessages: [`LIMS API returnerade HTTP ${response.status}`],
        projectId,
        auditId,
      };
    }
    const data = await response.json() as any;
    reportsData = data.reports || [];
  } catch (err: any) {
    logger.warn('lims-auto-fetch: API call failed', { err: String(err.message || err) });
    return {
      status: 'FAILED',
      reportsImported: 0,
      reports: [],
      errorMessages: [`API-anslutning misslyckades: ${String(err.message || err)}`],
      projectId,
      auditId,
    };
  }

  if (reportsData.length === 0) {
    return {
      status: 'NO_NEW_REPORTS',
      reportsImported: 0,
      reports: [],
      errorMessages: [],
      projectId,
      auditId,
    };
  }

  const reports: LimsReport[] = [];
  const errorMessages: string[] = [];

  for (const report of reportsData) {
    try {
      const created = await createLimsReport({
        ...report,
        source: 'API',
      });
      reports.push(created);
    } catch (err: any) {
      errorMessages.push(`Misslyckades att spara rapport för sampleId ${report?.sampleId || 'okänd'}: ${err.message || err}`);
    }
  }

  let status: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'SUCCESS';
  if (reports.length > 0 && errorMessages.length > 0) {
    status = 'SUCCESS';
  } else if (reports.length === 0 && errorMessages.length > 0) {
    status = 'FAILED';
  }

  return {
    status,
    reportsImported: reports.length,
    reports,
    errorMessages,
    projectId,
    auditId,
  };
}
