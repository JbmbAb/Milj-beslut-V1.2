import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  judgmentRecordUpsert: vi.fn(),
  judgmentRecordFindUnique: vi.fn(),
  judgmentRecordFindMany: vi.fn(),
  legalSourceRecordFindFirst: vi.fn(),
  legalSourceRecordFindMany: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    judgmentRecord: {
      upsert: mocks.judgmentRecordUpsert,
      findUnique: mocks.judgmentRecordFindUnique,
      findMany: mocks.judgmentRecordFindMany,
    },
    legalSourceRecord: {
      findFirst: mocks.legalSourceRecordFindFirst,
      findMany: mocks.legalSourceRecordFindMany,
    },
  },
}));

import {
  getJudgmentByGuid,
  listJudgments,
  upsertJudgment,
} from '../../server/repositories/judgmentRepository';

describe('judgmentRepository', () => {
  beforeEach(() => vi.resetAllMocks());

  it('upserts judgments into judgmentRecord', async () => {
    const pubDate = new Date('2026-03-01T00:00:00.000Z');
    mocks.judgmentRecordUpsert.mockResolvedValue({ guid: 'guid-1' });

    await upsertJudgment({
      guid: 'guid-1',
      title: 'Mark- och miljödom',
      link: 'https://example.test/judgment',
      description: 'Kort referat',
      pubDate,
    });

    expect(mocks.judgmentRecordUpsert).toHaveBeenCalledWith({
      where: { guid: 'guid-1' },
      create: {
        guid: 'guid-1',
        title: 'Mark- och miljödom',
        link: 'https://example.test/judgment',
        description: 'Kort referat',
        pubDate,
      },
      update: {
        title: 'Mark- och miljödom',
        link: 'https://example.test/judgment',
        description: 'Kort referat',
        pubDate,
      },
    });
  });

  it('falls back to legalSourceRecord when judgmentRecord is missing', async () => {
    mocks.judgmentRecordFindUnique.mockResolvedValue(null);
    mocks.legalSourceRecordFindFirst.mockResolvedValue({
      id: 'legal-1',
      externalId: 'guid-2',
      title: 'MÖD 2026:1',
      sourceUrl: 'https://example.test/mod-2026-1',
      summary: 'Referat',
      publishedAt: new Date('2026-03-02T00:00:00.000Z'),
      decisionDate: new Date('2026-03-01T00:00:00.000Z'),
      sourceSystem: 'DOMSTOL_RSS',
      legalArea: 'Miljörätt',
      authorityName: 'Mark- och miljööverdomstolen',
      authorityType: 'COURT',
      createdAt: new Date('2026-03-02T00:00:00.000Z'),
      updatedAt: new Date('2026-03-03T00:00:00.000Z'),
    });

    const judgment = await getJudgmentByGuid('guid-2');

    expect(judgment).toMatchObject({
      id: 'legal-1',
      guid: 'guid-2',
      title: 'MÖD 2026:1',
      link: 'https://example.test/mod-2026-1',
      description: 'Referat',
      sourceFeed: 'DOMSTOL_RSS',
      legalArea: 'Miljörätt',
      authorityName: 'Mark- och miljööverdomstolen',
      authorityType: 'COURT',
    });
  });

  it('merges direct and legacy judgments without duplicate guids', async () => {
    mocks.judgmentRecordFindMany.mockResolvedValue([
      {
        id: 'judgment-1',
        guid: 'guid-1',
        title: 'Dom 1',
        link: 'https://example.test/dom-1',
        description: null,
        pubDate: new Date('2026-03-05T00:00:00.000Z'),
      },
    ]);
    mocks.legalSourceRecordFindMany.mockResolvedValue([
      {
        id: 'legal-1',
        externalId: 'guid-2',
        title: 'Dom 2',
        sourceUrl: 'https://example.test/dom-2',
        summary: null,
        publishedAt: new Date('2026-03-06T00:00:00.000Z'),
        decisionDate: null,
        sourceSystem: 'DOMSTOL_RSS',
        legalArea: null,
        authorityName: null,
        authorityType: null,
        createdAt: new Date('2026-03-06T00:00:00.000Z'),
        updatedAt: new Date('2026-03-06T00:00:00.000Z'),
      },
      {
        id: 'legal-dup',
        externalId: 'guid-1',
        title: 'Dom 1 dublett',
        sourceUrl: 'https://example.test/dom-1-dup',
        summary: null,
        publishedAt: new Date('2026-03-04T00:00:00.000Z'),
        decisionDate: null,
        sourceSystem: 'DOMSTOL_RSS',
        legalArea: null,
        authorityName: null,
        authorityType: null,
        createdAt: new Date('2026-03-04T00:00:00.000Z'),
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
    ]);

    const judgments = await listJudgments(10, 0);

    expect(judgments).toHaveLength(2);
    expect(judgments.map((row) => row.guid)).toEqual(['guid-2', 'guid-1']);
    expect(judgments[1]).toMatchObject({
      guid: 'guid-1',
      title: 'Dom 1 dublett',
      link: 'https://example.test/dom-1-dup',
    });
  });

  it('handles database errors during upsert', async () => {
    mocks.judgmentRecordUpsert.mockRejectedValue(new Error('unique constraint violation'));

    await expect(
      upsertJudgment({
        guid: 'guid-error',
        title: 'Test',
        link: 'https://example.test/error',
        description: 'Error test',
        pubDate: new Date(),
      }),
    ).rejects.toThrow('unique constraint violation');
  });

  it('handles null descriptions in judgments', async () => {
    mocks.judgmentRecordUpsert.mockResolvedValue({
      guid: 'guid-null-desc',
      title: 'Dom utan beskrivning',
      link: 'https://example.test/no-desc',
      description: null,
    });

    const result = await upsertJudgment({
      guid: 'guid-null-desc',
      title: 'Dom utan beskrivning',
      link: 'https://example.test/no-desc',
      description: null,
      pubDate: new Date(),
    });

    expect(result.description).toBeNull();
  });

  it('handles very long judgment titles and descriptions', async () => {
    const longTitle = 'A'.repeat(5000);
    const longDesc = 'B'.repeat(10000);

    mocks.judgmentRecordUpsert.mockResolvedValue({
      guid: 'guid-long',
      title: longTitle,
      link: 'https://example.test/long',
      description: longDesc,
    });

    await upsertJudgment({
      guid: 'guid-long',
      title: longTitle,
      link: 'https://example.test/long',
      description: longDesc,
      pubDate: new Date(),
    });

    expect(mocks.judgmentRecordUpsert).toHaveBeenCalled();
  });

  it('handles database errors when fetching judgment by guid', async () => {
    mocks.judgmentRecordFindUnique.mockRejectedValue(new Error('query error'));

    await expect(getJudgmentByGuid('guid-fail')).rejects.toThrow('query error');
  });

  it('handles database errors when listing judgments', async () => {
    mocks.judgmentRecordFindMany.mockRejectedValue(new Error('list error'));

    await expect(listJudgments(10, 0)).rejects.toThrow('list error');
  });

  it('handles Swedish legal areas and authority types', async () => {
    mocks.legalSourceRecordFindFirst.mockResolvedValue({
      id: 'legal-swedish',
      externalId: 'guid-swedish',
      title: 'Miljödom',
      sourceUrl: 'https://example.test/miljö',
      summary: 'Miljöärende',
      publishedAt: new Date(),
      decisionDate: new Date(),
      sourceSystem: 'DOMSTOL_RSS',
      legalArea: 'Miljörätt',
      authorityName: 'Högsta domstolen',
      authorityType: 'COURT',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const judgment = await getJudgmentByGuid('guid-swedish');

    expect(judgment.legalArea).toBe('Miljörätt');
    expect(judgment.authorityName).toBe('Högsta domstolen');
  });

  it('handles pagination parameters correctly', async () => {
    mocks.judgmentRecordFindMany.mockResolvedValue([]);
    mocks.legalSourceRecordFindMany.mockResolvedValue([]);

    await listJudgments(50, 100);

    expect(mocks.judgmentRecordFindMany).toHaveBeenCalled();
    expect(mocks.legalSourceRecordFindMany).toHaveBeenCalled();
  });

  it('handles zero pagination parameters', async () => {
    mocks.judgmentRecordFindMany.mockResolvedValue([]);
    mocks.legalSourceRecordFindMany.mockResolvedValue([]);

    const result = await listJudgments(0, 0);

    expect(result).toBeDefined();
  });

  it('handles very large pagination results', async () => {
    const largeList = Array.from({ length: 10000 }, (_, i) => ({
      id: `judgment-${i}`,
      guid: `guid-${i}`,
      title: `Dom ${i}`,
      link: `https://example.test/dom-${i}`,
      description: `Description ${i}`,
      pubDate: new Date(),
    }));

    mocks.judgmentRecordFindMany.mockResolvedValue(largeList);
    mocks.legalSourceRecordFindMany.mockResolvedValue([]);

    const result = await listJudgments(10000, 0);

    expect(result.length).toBeGreaterThan(0);
  });

  it('handles special characters and unicode in titles', async () => {
    mocks.judgmentRecordUpsert.mockResolvedValue({
      guid: 'guid-unicode',
      title: 'Miljödom: © 2026 ñ å ä ö',
      link: 'https://example.test/unicode',
      description: null,
    });

    await upsertJudgment({
      guid: 'guid-unicode',
      title: 'Miljödom: © 2026 ñ å ä ö',
      link: 'https://example.test/unicode',
      description: null,
      pubDate: new Date(),
    });

    expect(mocks.judgmentRecordUpsert).toHaveBeenCalled();
  });
});
