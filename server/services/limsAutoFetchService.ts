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
import { createLimsReport } from './limsService';
import { appendDomainAudit } from '../security/auditTrail';
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
  } else if (process.env.LIMS_SFTP_HOST && process.env.LIMS_SFTP_PATH) {
    // SFTP-gren: kräver `ssh2-sftp-client` installerad som runtime-beroende.
    // Detta är en optional dependency — om paketet saknas markeras statusen
    // FAILED med tydligt felmeddelande istället för att krascha.
    try {
      const host = process.env.LIMS_SFTP_HOST;
      const portRaw = Number(process.env.LIMS_SFTP_PORT ?? 22);
      const port = Number.isFinite(portRaw) ? portRaw : 22;
      const username = process.env.LIMS_SFTP_USER;
      const password = process.env.LIMS_SFTP_PASSWORD;
      const privateKeyPath = process.env.LIMS_SFTP_PRIVATE_KEY_PATH;
      const remotePath = process.env.LIMS_SFTP_PATH;
      if (!username || (!password && !privateKeyPath)) {
        throw new Error('LIMS_SFTP_USER samt LIMS_SFTP_PASSWORD eller LIMS_SFTP_PRIVATE_KEY_PATH krävs');
      }

      // Dynamic import för att inte hårdkräva paketet i byggmiljöer som
      // inte använder SFTP. Modulnamnet byggs via variabel för att undvika
      // att TypeScript försöker statiskt upplösa det.
      const sftpModuleName = 'ssh2-sftp-client';
      const mod = await import(/* @vite-ignore */ sftpModuleName).catch((err) => {
        throw new Error(
          `ssh2-sftp-client saknas — kör \`npm install ssh2-sftp-client\` (${err instanceof Error ? err.message : String(err)})`,
        );
      });
      const SftpCtor = (mod as unknown as { default: new () => unknown }).default;
      const sftp = new SftpCtor() as {
        connect: (opts: Record<string, unknown>) => Promise<void>;
        list: (p: string) => Promise<Array<{ name: string; type: string }>>;
        get: (p: string) => Promise<Buffer>;
        end: () => Promise<void>;
      };

      const privateKey = privateKeyPath
        ? await (await import('node:fs/promises')).readFile(privateKeyPath)
        : undefined;

      await sftp.connect({
        host,
        port,
        username,
        ...(privateKey ? { privateKey } : {}),
        ...(password ? { password } : {}),
        readyTimeout: 20_000,
      });
      try {
        const listing = await sftp.list(remotePath);
        const sinceTs = params.since ? Date.parse(params.since) : 0;
        for (const entry of listing) {
          if (entry.type !== '-') continue;
          if (!/\.(json|csv|xml)$/i.test(entry.name)) continue;
          const buf = await sftp.get(`${remotePath.replace(/\/$/, '')}/${entry.name}`);
          const text = buf.toString('utf8');
          void sinceTs; // filterlogik kan utökas per filens ctime
          try {
            const parsed = JSON.parse(text) as {
              sampleId: string;
              labName: string;
              analyzedAt?: string;
              rawReference: string;
              metrics: Array<{ key: string; value: number; unit: string; maxAllowed?: number }>;
            };
            const report = await createLimsReport({
              bookingId: null,
              sampleId: parsed.sampleId,
              labName: parsed.labName,
              source: 'API',
              analyzedAt: parsed.analyzedAt,
              rawReference: parsed.rawReference ?? entry.name,
              metrics: parsed.metrics,
            });
            reports.push(report);
          } catch (e) {
            errorMessages.push(`Fel vid parsing av SFTP-fil ${entry.name}: ${String(e)}`);
          }
        }
        status = reports.length > 0 ? 'SUCCESS' : 'NO_NEW_REPORTS';
      } finally {
        await sftp.end().catch(() => undefined);
      }
    } catch (err) {
      errorMessages.push(`SFTP-anslutning misslyckades: ${String(err)}`);
      status = 'FAILED';
      logger.warn('lims-auto-fetch: SFTP call failed', { err: String(err) });
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
