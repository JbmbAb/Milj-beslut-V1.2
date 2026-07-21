/**
 * Mimers Brunn document manifest — v2 canonical contract.
 * Used to secure and version-control external authority documents with rich metadata.
 */

export const DOCUMENT_MANIFEST_SCHEMA_V2 = '2.0' as const;

export interface ValidityPeriod {
  from: string; // ISO date string (YYYY-MM-DD)
  to: string | null; // ISO date string or null if currently valid
}

export interface DocumentManifestV2 {
  schema_version: typeof DOCUMENT_MANIFEST_SCHEMA_V2;
  document_id: string;      // Stable document ID (e.g., 'doc-viss-gv-2026-v1.4')
  provider: string;         // Authority/Source (e.g., 'VISS', 'SGU')
  dataset: string;          // Dataset name (e.g., 'Grundvattenutredningar')
  filename: string;         // Local filename (e.g., 'VISS_Guide_2026.pdf')
  source_url: string;       // Original source URL
  version: string;          // Document version (e.g., '1.4')
  publish_date: string;     // Date published by authority (YYYY-MM-DD)
  validity_period: ValidityPeriod;
  downloaded_at: string;    // ISO timestamp of download
  sha256: string;           // SHA-256 checksum of the file
  superseded_by: string | null; // ID of the document that supersedes this one, or null
}

export interface DocumentManifestV1 {
  schema_version?: undefined;
  document_id?: string;
  provider: string;
  dataset?: string;
  filename: string;
  source_url?: string;
  version?: string;
  [key: string]: unknown;
}

export type DocumentManifest = DocumentManifestV1 | DocumentManifestV2;

export function isDocumentManifestV2(m: DocumentManifest): m is DocumentManifestV2 {
  return m.schema_version === DOCUMENT_MANIFEST_SCHEMA_V2;
}

export function validateDocumentManifest(
  m: unknown,
): { ok: true; manifest: DocumentManifestV2 } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!m || typeof m !== 'object') {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  const o = m as Record<string, unknown>;

  const stringFields = [
    'document_id',
    'provider',
    'dataset',
    'filename',
    'source_url',
    'version',
    'publish_date',
    'downloaded_at',
    'sha256',
  ];
  for (const field of stringFields) {
    if (typeof o[field] !== 'string' || o[field].length === 0) {
      errors.push(`missing or invalid ${field}`);
    }
  }

  if (!o.validity_period || typeof o.validity_period !== 'object') {
    errors.push('missing or invalid validity_period');
  } else {
    const vp = o.validity_period as Record<string, unknown>;
    if (typeof vp.from !== 'string' || vp.from.length === 0) {
      errors.push('validity_period.from must be a non-empty string');
    }
    if (vp.to !== null && typeof vp.to !== 'string') {
      errors.push('validity_period.to must be a string or null');
    }
  }

  if (o.superseded_by !== undefined && o.superseded_by !== null && typeof o.superseded_by !== 'string') {
    errors.push('superseded_by must be a string or null');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Ensure superseded_by is present (and default to null if missing but rest is valid)
  const completeManifest: DocumentManifestV2 = {
    schema_version: DOCUMENT_MANIFEST_SCHEMA_V2,
    document_id: o.document_id as string,
    provider: o.provider as string,
    dataset: o.dataset as string,
    filename: o.filename as string,
    source_url: o.source_url as string,
    version: o.version as string,
    publish_date: o.publish_date as string,
    validity_period: o.validity_period as ValidityPeriod,
    downloaded_at: o.downloaded_at as string,
    sha256: o.sha256 as string,
    superseded_by: (o.superseded_by as string | null) ?? null,
  };

  return { ok: true, manifest: completeManifest };
}

/** Upgrade a legacy v1 document manifest to v2. */
export function ensureDocumentManifestV2(m: DocumentManifest): DocumentManifestV2 {
  if (isDocumentManifestV2(m)) {
    return m;
  }

  const legacy = m as DocumentManifestV1;
  const now = new Date().toISOString();

  const provider = legacy.provider || 'unknown';
  const filename = legacy.filename || 'unknown';

  return {
    schema_version: DOCUMENT_MANIFEST_SCHEMA_V2,
    document_id: legacy.document_id ?? `doc-${provider.toLowerCase()}-${filename.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    provider,
    dataset: legacy.dataset ?? 'Legacy_Documents',
    filename,
    source_url: legacy.source_url ?? 'unknown',
    version: legacy.version ?? '1.0',
    publish_date: typeof legacy.publish_date === 'string' ? legacy.publish_date : now.substring(0, 10),
    validity_period: {
      from: typeof legacy.validity_from === 'string' ? legacy.validity_from : now.substring(0, 10),
      to: typeof legacy.validity_to === 'string' ? legacy.validity_to : null,
    },
    downloaded_at: typeof legacy.downloaded_at === 'string' ? legacy.downloaded_at : now,
    sha256: typeof legacy.sha256 === 'string' ? legacy.sha256 : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // Default to empty SHA
    superseded_by: typeof legacy.superseded_by === 'string' ? legacy.superseded_by : null,
  };
}

/** Mark a document as superseded by another document. */
export function supersedeDocument(
  manifest: DocumentManifestV2,
  supersededByDocumentId: string,
): DocumentManifestV2 {
  return {
    ...manifest,
    superseded_by: supersededByDocumentId,
    validity_period: {
      ...manifest.validity_period,
      to: new Date().toISOString().substring(0, 10), // Set end date to today
    },
  };
}
