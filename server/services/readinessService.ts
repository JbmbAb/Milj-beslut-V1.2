/**
 * Readiness (dependens mot DB, Vertex, object storage) för /ready och lastare.
 * Liveness hanteras separat i GET /health (processen svarar).
 */

import { prisma } from '../db/prisma';
import { gcsDocumentsEnabled } from './documentObjectStorage';
import { vertexConfigStatus } from './vertexAiService';

export type IntegrationState = 'ok' | 'error' | 'degraded' | 'not_configured' | 'warning';

export interface ReadinessPayload {
  ok: boolean;
  database: IntegrationState;
  vertex: {
    state: IntegrationState;
    projectId: string | null;
    location: string;
    missing: string[];
  };
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
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'VERTEX_PROJECT_ID',
  ];

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
  } catch {
    database = 'error';
  }

  const vs = vertexConfigStatus();
  let vertexState: IntegrationState;
  if (vs.configured) {
    vertexState = 'ok';
  } else {
    vertexState = 'degraded';
  }

  const gcs = gcsDocumentsEnabled();
  let storageState: IntegrationState;
  let storageNote: string | undefined;
  if (gcs) {
    storageState = 'ok';
  } else if (process.env.NODE_ENV === 'production') {
    storageState = 'warning';
    storageNote =
      'GCS_DOCUMENTS_BUCKET saknas — uppladdade filer lagras på lokalt filsystem (ephemeral på Cloud Run).';
  } else {
    storageState = 'ok';
  }

  const ok = database === 'ok' && vertexState === 'ok';

  return {
    ok,
    database,
    vertex: {
      state: vertexState,
      projectId: vs.projectId,
      location: vs.location,
      missing: vs.missing,
    },
    storage: {
      state: storageState,
      backend: gcs ? 'gcs' : 'local',
      bucket: gcs ? String(process.env.GCS_DOCUMENTS_BUCKET || '').trim() || undefined : undefined,
      note: storageNote,
    },
  };
}
