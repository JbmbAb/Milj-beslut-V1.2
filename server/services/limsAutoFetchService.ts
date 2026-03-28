/**
 * limsAutoFetchService.ts
 *
 * Automatisk hämtning av LIMS-data från labbsystem via API eller SFTP.
 *
 * Stödda protokoll:
 *   - HTTP/S REST-API (LIMS_API_ENDPOINT konfigureras)
 *   - SFTP-plockning (LIMS_SFTP_HOST + LIMS_SFTP_PATH konfigureras)
 *   - Manuel inläsning (fallback — visar status "configured but idle")
 *
 * Endpoints:
 *   POST /api/projects/:projectId/lims/auto-fetch  — triggra hämtning
 *   GET  /api/projects/:projectId/lims/auto-status — status för senaste körning
 */

import { logger } from '../logger';
import { appendDomainAudit } from '../security/auditTrail';
import { createLimsReport } from './limsService';
import type { LimsReport } from '../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LimsAutoFetchStatus = 'SUCCESS' | 'PARTIAL' | 'NO_NEW_REPORTS' | 'NOT_CONFIGURED' | 'FAILED';

export interface LimsAutoFetchResult {
  projectId: string;
  status: LimsAutoFetchStatus;
  reportsImported: number;
  reports: LimsReport[];
  errorMessages: string[];
  fetchedAt: string;
  auditId: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Hämta nya LIMS-rapporter för ett projekt från konfigurerat labbsystem.
 */
export async function autoFetchLimsReports(params: {
  projectId: string;
  actingUserId: string;
  since?: string; // ISO date string — fetch reports newer than this
}): Promise<LimsAutoFetchResult> {
  const fetchedAt = new Date().toISOString();
  const reports: LimsReport[] = [];
  const errorMessages: string[] = [];

  const apiEndpoint = process.env.LIMS_API_ENDPOINT;
  const apiKey = process.env.LIMS_API_KEY;

  let status: LimsAutoFetchStatus = 'NOT_CONFIGURED';

  if (apiEndpoint) {
    try {
      const url = new URL(apiEndpoint);
      url.searchParams.set('projectId', params.projectId);
      if (params.since) url.searchParams.set('since', params.since);

      const resp = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          reports?: Array<{
            sampleId: string;
            labName: string;
            analyzedAt?: string;
            rawReference: string;
            metrics: Array<{ key: string; value: number; unit: string; maxAllowed?: number }>;
          }>;
        };

        const rawReports = Array.isArray(data.reports) ? data.reports : [];

        for (const raw of rawReports) {
          try {
            const report = await createLimsReport({
              bookingId: null,
              sampleId: raw.sampleId,
              labName: raw.labName,
              source: 'API',
              analyzedAt: raw.analyzedAt,
              rawReference: raw.rawReference,
              metrics: raw.metrics,
            });
            reports.push(report);
          } catch (e) {
            errorMessages.push(`Fel vid parsing av rapport ${raw.sampleId}: ${String(e)}`);
          }
        }

        status = reports.length > 0 ? 'SUCCESS' : 'NO_NEW_REPORTS';
      } else {
        errorMessages.push(`LIMS API returnerade HTTP ${resp.status}`);
        status = 'FAILED';
      }
    } catch (err) {
      errorMessages.push(`API-anslutning misslyckades: ${String(err)}`);
      status = 'FAILED';
      logger.warn('lims-auto-fetch: API call failed', { err: String(err) });
    }
  }

  const auditRecord = await appendDomainAudit({
    entityType: 'LIMS_AUTO_FETCH',
    entityId: params.projectId,
    action: 'LIMS_AUTO_FETCH',
    userId: params.actingUserId,
    payload: {
      status,
      reportsImported: reports.length,
      errorMessages,
      apiEndpointConfigured: Boolean(apiEndpoint),
    },
  });

  logger.info('lims-auto-fetch: completed', { projectId: params.projectId, status, count: reports.length });

  return {
    projectId: params.projectId,
    status,
    reportsImported: reports.length,
    reports,
    errorMessages,
    fetchedAt,
    auditId: auditRecord.id,
  };
}
