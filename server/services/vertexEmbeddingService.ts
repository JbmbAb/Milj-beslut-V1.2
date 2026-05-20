/**
 * Textembeddings via Vertex AI REST `:predict` (samma molnprojekt/ADC som
 * @google-cloud/vertexai). Ersätter tidigare `generativelanguage.googleapis.com` + GEMINI_API_KEY.
 */

import { GoogleAuth } from 'google-auth-library';
import { logger } from '../logger';
import { ensureVertexCredentialsFromJsonEnv } from './vertexAiService';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

let auth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!auth) {
    ensureVertexCredentialsFromJsonEnv();
    auth = new GoogleAuth({ scopes: SCOPES });
  }
  return auth;
}

export async function getVertexAccessTokenForPredict(): Promise<string | null> {
  try {
    const client = await getAuth().getClient();
    const t = await client.getAccessToken();
    return t.token ?? null;
  } catch (err) {
    logger.warn('vertexEmbedding: access token', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function projectLocationOrNull(): { project: string; location: string } | null {
  const project = process.env.VERTEX_PROJECT_ID?.trim();
  if (!project) return null;
  return { project, location: process.env.VERTEX_LOCATION?.trim() || 'europe-west1' };
}

type PredictResponse = {
  predictions?: Array<{
    embeddings?: { values?: number[] };
  }>;
};

/**
 * Nöjer sig med första modellen som svarar (samma mönster som searchService sökte
 * igenom EMBEDDING_MODEL / fallbacks).
 */
export async function embedTextWithVertexPredict(
  text: string,
  embeddingDim: number,
): Promise<{ values: number[]; model: string } | null> {
  const pl = projectLocationOrNull();
  if (!pl) {
    return null;
  }
  const token = await getVertexAccessTokenForPredict();
  if (!token) {
    return null;
  }

  const primary = String(process.env.VERTEX_EMBEDDING_MODEL || 'text-multilingual-embedding-002').trim();
  const fallbacks = String(
    process.env.VERTEX_EMBEDDING_FALLBACK_MODELS || process.env.EMBEDDING_FALLBACK_MODELS || '',
  )
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const models = [primary, ...fallbacks].filter((m, i, a) => a.indexOf(m) === i);

  const slice = text.slice(0, 8000);
  for (const model of models) {
    const url = `https://${pl.location}-aiplatform.googleapis.com/v1/projects/${pl.project}/locations/${pl.location}/publishers/google/models/${encodeURIComponent(model)}:predict`;
    const body: Record<string, unknown> = {
      instances: [
        {
          content: slice,
          task_type: 'RETRIEVAL_DOCUMENT',
        },
      ],
      parameters: {
        autoTruncate: true,
        outputDimensionality: Math.min(3072, Math.max(1, embeddingDim)),
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          Math.max(5_000, Number(process.env.EMBEDDING_TIMEOUT_MS || 25_000)),
        ),
      });
      if (!response.ok) {
        const t = await response.text();
        logger.warn('vertexEmbedding: predict not ok', { model, status: response.status, body: t.slice(0, 200) });
        continue;
      }
      const json = (await response.json()) as PredictResponse;
      const values = json.predictions?.[0]?.embeddings?.values;
      if (!Array.isArray(values) || values.length === 0) {
        continue;
      }
      const out = values.length === embeddingDim ? values : values.slice(0, embeddingDim);
      return { values: out, model };
    } catch (err) {
      logger.warn('vertexEmbedding: predict error', { model, err: String(err) });
    }
  }

  return null;
}
