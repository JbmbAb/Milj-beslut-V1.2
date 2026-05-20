import { prisma } from '../db/prisma';
import {
  inferMatrixProjection,
  normalizeLegalSource,
  type LegalSourceSeedInput,
} from '../services/legalSourceIngestService';

const db = prisma as any;

export async function upsertLegalSourceRecord(input: LegalSourceSeedInput, judgmentId?: string) {
  if (!input) return null;
  const normalized = normalizeLegalSource(input);
  if (!normalized) return null;

  return db.legalSourceRecord.upsert({
    where: {
      sourceSystem_externalId: {
        sourceSystem: normalized.sourceSystem,
        externalId: normalized.externalId,
      },
    },
    create: {
      ...normalized,
      judgmentId: judgmentId || null,
    },
    update: {
      title: normalized.title,
      summary: normalized.summary,
      sourceUrl: normalized.sourceUrl,
      normalizedUrl: normalized.normalizedUrl,
      providerId: normalized.providerId,
      providerLabel: normalized.providerLabel,
      authorityName: normalized.authorityName,
      authorityType: normalized.authorityType,
      municipality: normalized.municipality,
      diarienummer: normalized.diarienummer,
      legalArea: normalized.legalArea,
      mimeType: normalized.mimeType,
      formatHint: normalized.formatHint,
      decisionDate: normalized.decisionDate,
      publishedAt: normalized.publishedAt,
      storageTarget: normalized.storageTarget,
      postgisSchema: normalized.postgisSchema,
      postgisTable: normalized.postgisTable,
      matrixCategory: normalized.matrixCategory,
      matrixSuggested: normalized.matrixSuggested,
      payload: normalized.payload,
      judgmentId: judgmentId || undefined,
    },
  });
}

export async function upsertRequirementMatrixRowFromLegalSource(
  legalSourceId: string,
  input: LegalSourceSeedInput,
) {
  const matrix = inferMatrixProjection(input);
  if (!matrix.shouldProject || !matrix.category || !matrix.ruleText) {
    return null;
  }

  return db.requirementMatrixRow.upsert({
    where: {
      legalSourceId,
    },
    create: {
      legalSourceId,
      category: matrix.category,
      ruleText: matrix.ruleText,
      sourceText: matrix.sourceText || null,
      comments: matrix.comments || null,
      isAutoSuggested: true,
      reviewStatus: 'AUTO',
    },
    update: {
      category: matrix.category,
      ruleText: matrix.ruleText,
      sourceText: matrix.sourceText || null,
      comments: matrix.comments || null,
      isAutoSuggested: true,
    },
  });
}

export async function upsertLegalSourceWithMatrix(input: LegalSourceSeedInput, judgmentId?: string) {
  const record = await upsertLegalSourceRecord(input, judgmentId);
  const matrixRow = await upsertRequirementMatrixRowFromLegalSource(record.id, input);
  return { record, matrixRow };
}
