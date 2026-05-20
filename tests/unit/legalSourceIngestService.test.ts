import { describe, expect, it } from 'vitest';

import {
  buildDataportalLegalSourceSeed,
  buildFoundationLegalSourceSeed,
  buildJudgmentLegalSourceSeed,
  buildMunicipalDiaryLegalSourceSeed,
  inferMatrixProjection,
  normalizeLegalSource,
} from '../../server/services/legalSourceIngestService';
import { FOUNDATION_LEGAL_SOURCES } from '../../server/modules/legal/catalogs/foundationLegalSources';

describe('legalSourceIngestService', () => {
  it('routes spatial dataportal datasets to PostGIS', () => {
    const normalized = normalizeLegalSource(
      buildDataportalLegalSourceSeed({
        distributionKey: 'raa-1',
        datasetTitle: 'Kulturhistoriska lämningar',
        datasetDescription: 'Geopackage med lämningar',
        sourceUrl:
          'https://pub.raa.se/nedladdning/datauttag/lamningar_v1/kommun/lamningar_kommun_stockholm.gpkg',
        providerId: 'raa',
        providerLabel: 'RAÄ',
        formatHint: 'application/geopackage+sqlite3',
      }),
    );

    expect(normalized.storageTarget).toBe('POSTGIS');
    expect(normalized.postgisSchema).toBe('culture');
    expect(normalized.postgisTable).toContain('kulturhistoriska_lamningar');
  });

  it('honors explicit PostGIS overrides for local dataportal raster datasets', () => {
    const normalized = normalizeLegalSource(
      buildDataportalLegalSourceSeed({
        sourceSystem: 'DATAPORTAL_PORTFOLIO_LOCAL',
        sourceType: 'SPATIAL_DATASET_LOCAL',
        distributionKey: '635:455909',
        datasetTitle: 'Nationella marktackedata, tillaggsskikt objekthojd och objekttackning',
        datasetDescription: 'Rasterskikt for objekthojd och objekttackning i 10 m upplosning.',
        sourceUrl: 'https://admin.dataportal.se/store/635/metadata/455909?recursive=dcat',
        providerId: 'naturvardsverket',
        providerLabel: 'Naturvardsverket',
        formatHint: 'POSTGIS_RASTER;local-download',
        storageTargetOverride: 'POSTGIS',
        postgisSchemaOverride: 'env',
        postgisTableOverride: 'nmd_object_height_coverage',
      }),
    );

    expect(normalized.storageTarget).toBe('POSTGIS');
    expect(normalized.postgisSchema).toBe('env');
    expect(normalized.postgisTable).toBe('nmd_object_height_coverage');
  });

  it('routes municipal diary index rows to review queue instead of matrix', () => {
    const normalized = normalizeLegalSource(
      buildMunicipalDiaryLegalSourceSeed({
        kommun: 'MalmÃ¶',
        kommunWebb: 'https://malmo.se',
        sourceUrl: 'https://skr.se/kommunerochregioner/kommunerlista.8288.html',
      }),
    );

    expect(normalized.title).toBe('Malmö diarier');
    expect(normalized.storageTarget).toBe('REVIEW_QUEUE');
    expect(normalized.matrixSuggested).toBe(false);
  });

  it('routes judgments into Beslut category when no dom/praxis keyword found', () => {
    const seed = buildJudgmentLegalSourceSeed({
      guid: '9999',
      title: 'Beslut om tillstånd för vindkraft',
      link: 'https://www.domstol.se/example-beslut',
      description: 'Tillstånd beviljat för vindkraftpark.',
      pubDate: new Date('2025-06-01T00:00:00.000Z'),
    });

    const matrix = inferMatrixProjection(seed);
    expect(matrix.shouldProject).toBe(true);
    // "tillstand" matches matrixKeywords → should project into Beslut och diarier
    expect(matrix.category).toBe('Praxis och domar'); // 'JUDGMENT' type forces this
  });

  it('routes non-keyword content to shouldProject=false', () => {
    const matrix = inferMatrixProjection({
      sourceSystem: 'RSS',
      sourceType: 'GENERAL_NEWS',
      externalId: 'news-1',
      title: 'Nyheter om klimat',
      sourceUrl: 'https://example.com/news/1',
    });

    expect(matrix.shouldProject).toBe(false);
  });

  it('FILESYSTEM storage for PDF sources', () => {
    const seed = buildDataportalLegalSourceSeed({
      distributionKey: 'pdf-1',
      datasetTitle: 'Rapportdokument',
      datasetDescription: 'En PDF-rapport',
      sourceUrl: 'https://example.com/rapport.pdf',
      providerId: 'generic',
      providerLabel: 'Generic',
      formatHint: 'application/pdf',
    });
    const normalized = normalizeLegalSource(seed);
    expect(normalized.storageTarget).toBe('FILESYSTEM');
  });

  it('PRISMA storage for plain text content without spatial signals', () => {
    const seed = buildJudgmentLegalSourceSeed({
      guid: 'abc-123',
      title: 'Handläggningsbeslut',
      link: 'https://www.domstol.se/abc-123',
      description: 'Ett beslut om handläggning.',
      pubDate: new Date('2025-01-01T00:00:00.000Z'),
    });
    // Overwrite formatHint to avoid spatial detection
    (seed as any).formatHint = null;
    (seed as any).sourceType = 'JUDGMENT_PLAIN';

    // "beslut" in title should still project
    const matrix = inferMatrixProjection(seed);
    expect(matrix.shouldProject).toBe(true);
  });

  it('builds foundation legal sources as curated Prisma metadata', () => {
    const seed = buildFoundationLegalSourceSeed(FOUNDATION_LEGAL_SOURCES[0]);
    const normalized = normalizeLegalSource(seed);

    expect(seed.sourceSystem).toBe('SFS');
    expect(seed.sourceType).toBe('FOUNDATION_LAW');
    expect(normalized.storageTarget).toBe('PRISMA');
    expect(normalized.providerLabel).toBe('Svensk författningssamling');
    expect(normalized.payload).toMatchObject({
      catalogId: 'foundation.mb',
      readyForImport: true,
    });
  });

  it('does not project foundation metadata into the requirement matrix', () => {
    const seed = buildFoundationLegalSourceSeed(FOUNDATION_LEGAL_SOURCES[0]);
    const matrix = inferMatrixProjection(seed);

    expect(matrix).toEqual({ shouldProject: false });
  });
});
