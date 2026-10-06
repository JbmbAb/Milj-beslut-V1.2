/**
 * Readiness (dependens mot DB, object storage) för /ready och lastare.
 * Liveness hanteras separat i GET /health (processen svarar).
 */

import { prisma } from '../db/prisma';
import { gcsDocumentsEnabled } from './documentObjectStorage';
import { logger } from '../logger';

export type IntegrationState = 'ok' | 'error' | 'degraded' | 'not_configured' | 'warning';

export interface ReadinessPayload {
  ok: boolean;
  database: IntegrationState;
  storage: {
    state: IntegrationState;
    backend: 'gcs' | 'local';
    bucket?: string;
    /** I produktion utan GCS bucket: varning (Cloud Run-disk är flyktig). */
    note?: string;
  };
}

/**
 * Verifierar att kritiska miljövariabler är satta.
 * Kastar ett fel med en lista över alla saknade variabler om någon saknas.
 * Anropas vid serverstart för att förhindra start med felaktig konfiguration.
 */
export function assertRequiredEnv() {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Kritiska miljövariabler saknas: ${missing.join(', ')}. Servern kan inte starta.`);
  }
}

export async function getReadinessPayload(): Promise<ReadinessPayload> {
  let database: IntegrationState = 'error';

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'ok';
  } catch (err) {
    logger.error('Readiness check: database query failed', { error: String(err) });
    database = 'error';
  }

  const gcs = gcsDocumentsEnabled();
  const storageState: IntegrationState = 'ok';
  const storageNote = 'Local filesystem storage. GCS is retired.';

  const ok = database === 'ok';

  return {
    ok,
    database,
    storage: {
      state: storageState,
      backend: gcs ? 'gcs' : 'local',
      bucket: gcs ? String(process.env.GCS_DOCUMENTS_BUCKET || '').trim() || undefined : undefined,
      note: storageNote,
    },
  };
}
