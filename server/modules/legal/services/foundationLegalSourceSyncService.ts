import type { LegalSourceRecord } from '@prisma/client';
import {
  loadVerifiedSourceRegistry,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from '../../../../packages/mps-data-governance/src/SourceRegistry';
import { upsertLegalSourceWithMatrix } from '../../../repositories/legalSourceRepository';
import type { LegalSourceSeedInput } from '../../../services/legalSourceIngestService';

interface FoundationMetadataProjection {
  readonly definitionId: string;
  readonly sourceId: string;
  readonly registryArtifactId: string;
  readonly sourceContentHash: string;
  readonly artifactType: 'LAW' | 'ORDINANCE';
  readonly externalId: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly summary: string;
  readonly legalArea: string;
  readonly keywords: readonly string[];
}

/**
 * Descriptive projection metadata, not source authority.
 *
 * Endpoint, producer and operational policy are deliberately absent. The registry identity pins
 * the exact approved source definition this projection was reviewed against; a reissued source
 * therefore requires an explicit projection review rather than silently changing the read model.
 */
export const FOUNDATION_METADATA_PROJECTIONS: readonly FoundationMetadataProjection[] = [
  {
    definitionId: 'foundation.mb',
    sourceId: 'regeringskansliet-sfs-1998-808',
    registryArtifactId: 'reg-rk-sfs-1998-808-001',
    sourceContentHash: '888c7cbafc18058a9c254901b1b09e163726e270c271122ce532123af9285b97',
    artifactType: 'LAW',
    externalId: 'SFS:1998:808',
    title: 'Miljöbalken (1998:808)',
    shortTitle: 'Miljöbalken',
    summary:
      'Grundlagstiftning för miljöskydd, hushållning med mark och vatten samt tillstånds- och tillsynsfrågor.',
    legalArea: 'Miljö',
    keywords: ['miljöbalken', 'mb', 'miljö', 'tillstånd', 'tillsyn'],
  },
  {
    definitionId: 'foundation.mpf',
    sourceId: 'regeringskansliet-sfs-2013-251',
    registryArtifactId: 'reg-rk-sfs-2013-251-001',
    sourceContentHash: '3c46a82cbc1b8ede1653df88a435b991d3d64acaf8e72ed6ec9e9a12fbf37c21',
    artifactType: 'ORDINANCE',
    externalId: 'SFS:2013:251',
    title: 'Miljöprövningsförordningen (2013:251)',
    shortTitle: 'Miljöprövningsförordningen',
    summary:
      'Förordning som anger prövningspliktiga miljöfarliga verksamheter och hur verksamheter klassificeras.',
    legalArea: 'Miljö',
    keywords: ['miljöprövningsförordningen', 'mpf', 'anmälan', 'tillstånd', 'verksamhetskod'],
  },
  {
    definitionId: 'foundation.avfallsforordningen',
    sourceId: 'regeringskansliet-sfs-2020-614',
    registryArtifactId: 'reg-rk-sfs-2020-614-001',
    sourceContentHash: '36fd0e912567b7e1bf828fa24678a5b35459c9135e04f9dd85d5417545112973',
    artifactType: 'ORDINANCE',
    externalId: 'SFS:2020:614',
    title: 'Avfallsförordningen (2020:614)',
    shortTitle: 'Avfallsförordningen',
    summary:
      'Förordning som reglerar klassificering, hantering och dokumentation för avfall och farligt avfall.',
    legalArea: 'Miljö',
    keywords: ['avfallsförordningen', 'avfall', 'farligt avfall', 'ewc', 'transportdokument'],
  },
  {
    definitionId: 'foundation.pbl',
    sourceId: 'regeringskansliet-sfs-2010-900',
    registryArtifactId: 'reg-rk-sfs-2010-900-001',
    sourceContentHash: '59161ba7d94e2391e4fff945c6f2f4572290d13e2cddef4cb8c05464ddd1be98',
    artifactType: 'LAW',
    externalId: 'SFS:2010:900',
    title: 'Plan- och bygglagen (2010:900)',
    shortTitle: 'Plan- och bygglagen',
    summary: 'Grundlagstiftning för planläggning, lov, byggande och markanvändning.',
    legalArea: 'Plan och bygg',
    keywords: ['plan- och bygglagen', 'pbl', 'bygglov', 'detaljplan', 'planläggning'],
  },
  {
    definitionId: 'foundation.pbf',
    sourceId: 'regeringskansliet-sfs-2011-338',
    registryArtifactId: 'reg-rk-sfs-2011-338-001',
    sourceContentHash: '27d279b8b9945f9101589bf0035cb1ddb816bd39338caa49396aa1ab24ff39f4',
    artifactType: 'ORDINANCE',
    externalId: 'SFS:2011:338',
    title: 'Plan- och byggförordningen (2011:338)',
    shortTitle: 'Plan- och byggförordningen',
    summary:
      'Förordning som kompletterar plan- och bygglagen med bestämmelser om lov, anmälan och tekniska krav.',
    legalArea: 'Plan och bygg',
    keywords: ['plan- och byggförordningen', 'pbf', 'anmälan', 'tekniska krav', 'byggprocess'],
  },
];

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
  registry?: VerifiedSourceRegistry,
): Promise<SyncFoundationLegalSourcesResult> {
  const verifiedRegistry = registry ?? (await loadVerifiedSourceRegistry());
  // Resolve and validate the complete projection set before the first write. A registry gap or
  // reissued identity must not leave a partially refreshed LegalSourceRecord projection.
  const seeds = FOUNDATION_METADATA_PROJECTIONS.map((projection) =>
    buildVerifiedFoundationSeed(projection, requireBoundSource(verifiedRegistry, projection)),
  );
  const records: SyncFoundationLegalSourcesResult['records'] = [];

  for (const { projection, seed } of seeds) {
    const { record } = await upsertLegalSourceWithMatrix(seed);
    records.push(mapRecord(projection, record));
  }

  return { processed: records.length, records };
}

function requireBoundSource(
  registry: VerifiedSourceRegistry,
  projection: FoundationMetadataProjection,
): VerifiedSourceDefinition {
  const source = registry.getSource(projection.sourceId);
  if (!source) {
    throw new Error(`FOUNDATION_SOURCE_REJECTED: approved source '${projection.sourceId}' is missing.`);
  }

  const failures = [
    source.registryArtifactId === projection.registryArtifactId ? null : 'registry_artifact_id',
    source.sourceContentHash === projection.sourceContentHash ? null : 'source_content_hash',
    source.adapter === 'SINGLE_ENDPOINT_V1' ? null : 'adapter',
    source.artifactTypes.length === 1 && source.artifactTypes[0] === projection.artifactType
      ? null
      : 'artifact_type',
    source.endpointUrl ? null : 'endpoint',
    source.allowedDomains.length > 0 ? null : 'allowed_domains',
  ].filter((failure): failure is string => failure !== null);

  if (failures.length > 0) {
    throw new Error(
      `FOUNDATION_SOURCE_REJECTED: '${projection.sourceId}' failed registry binding checks: ${failures.join(', ')}.`,
    );
  }
  return source;
}

function buildVerifiedFoundationSeed(
  projection: FoundationMetadataProjection,
  source: VerifiedSourceDefinition,
): { projection: FoundationMetadataProjection; seed: LegalSourceSeedInput } {
  return {
    projection,
    seed: {
      sourceSystem: 'SFS',
      sourceType: projection.artifactType === 'LAW' ? 'FOUNDATION_LAW' : 'FOUNDATION_ORDINANCE',
      externalId: projection.externalId,
      title: projection.title,
      summary: projection.summary,
      sourceUrl: source.endpointUrl!,
      normalizedUrl: source.endpointUrl!,
      providerId: source.sourceId,
      providerLabel: source.authority.name,
      authorityName: source.authority.name,
      authorityType: source.authority.type,
      legalArea: projection.legalArea,
      storageTargetOverride: 'PRISMA',
      payload: {
        projection: 'FOUNDATION_METADATA_V1',
        source_id: source.sourceId,
        registry_artifact_id: source.registryArtifactId,
        source_content_hash: source.sourceContentHash,
        artifact_type: projection.artifactType,
        catalog_id: projection.definitionId,
        short_title: projection.shortTitle,
        keywords: [...projection.keywords],
        corpus_admitted: false,
      },
    },
  };
}

function mapRecord(projection: FoundationMetadataProjection, record: LegalSourceRecord) {
  return {
    definitionId: projection.definitionId,
    externalId: projection.externalId,
    legalSourceId: record.id,
    title: record.title,
  };
}
