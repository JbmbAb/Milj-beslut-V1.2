import type { LegalSourceRecord } from '@prisma/client';
import { upsertLegalSourceWithMatrix } from '../../../repositories/legalSourceRepository';
import { buildFoundationLegalSourceSeed } from '../../../services/legalSourceIngestService';
import {
  FOUNDATION_LEGAL_SOURCES,
  type FoundationLegalSourceDefinition,
} from '../catalogs/foundationLegalSources';

export interface SyncFoundationLegalSourcesResult {
  processed: number;
  records: Array<{
    definitionId: string;
    externalId: string;
    legalSourceId: string;
    title: string;
  }>;
}

export async function syncFoundationLegalSources(
  definitions: readonly FoundationLegalSourceDefinition[] = FOUNDATION_LEGAL_SOURCES,
): Promise<SyncFoundationLegalSourcesResult> {
  const records: SyncFoundationLegalSourcesResult['records'] = [];

  for (const definition of definitions) {
    const { record } = await upsertLegalSourceWithMatrix(buildFoundationLegalSourceSeed(definition));
    records.push(mapRecord(definition, record));
  }

  return {
    processed: records.length,
    records,
  };
}

function mapRecord(definition: FoundationLegalSourceDefinition, record: LegalSourceRecord) {
  return {
    definitionId: definition.id,
    externalId: definition.externalId,
    legalSourceId: record.id,
    title: record.title,
  };
}
