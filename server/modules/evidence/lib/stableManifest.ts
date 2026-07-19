import crypto from 'node:crypto';

/** Manifest v2: fixed key order + deterministic JSON for verification. */
export const EVIDENCE_EXPORT_MANIFEST_VERSION = 2 as const;

function stableStringify(value: unknown): string {
  const sort = (v: any): any => {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map(sort);
    if (typeof v === 'object' && v.constructor === Object) {
      return Object.keys(v)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function manifestContentHash(manifest: Record<string, unknown>): string {
  const { manifestContentHash: _ignored, ...rest } = manifest;
  return crypto.createHash('sha256').update(stableStringify(rest)).digest('hex');
}

/**
 * v2 shape — keep keys stable; bump EVIDENCE_EXPORT_MANIFEST_VERSION when changing.
 */
export function buildExportManifestV2(input: {
  exportId: string | null;
  requirementCaseId: string;
  projectId: string;
  organisationId: string;
  snapshotId: string;
  snapshotType: string;
  snapshotVersion: number;
  caseReviewStatusAtExport?: string | null;
  exportCreatedAt: string;
  exportCreatedBy: string;
  format: string;
  auditAnchorHash: string;
  auditAnchorId: string | null;
  auditAnchorAt: string | null;
  auditTrailRowCountAtSnapshot: number | null;
  contentHash: string;
}): Record<string, unknown> {
  return {
    auditAnchorAt: input.auditAnchorAt,
    auditAnchorHash: input.auditAnchorHash,
    auditAnchorId: input.auditAnchorId,
    auditTrailRowCountAtSnapshot: input.auditTrailRowCountAtSnapshot,
    caseReviewStatusAtExport: input.caseReviewStatusAtExport ?? null,
    contentHash: input.contentHash,
    exportCreatedAt: input.exportCreatedAt,
    exportCreatedBy: input.exportCreatedBy,
    exportId: input.exportId,
    format: input.format,
    label: 'EVIDENCE_EXPORT_READ_ONLY',
    manifestVersion: EVIDENCE_EXPORT_MANIFEST_VERSION,
    organisationId: input.organisationId,
    projectId: input.projectId,
    requirementCaseId: input.requirementCaseId,
    snapshotId: input.snapshotId,
    snapshotType: input.snapshotType,
    snapshotVersion: input.snapshotVersion,
  };
}
