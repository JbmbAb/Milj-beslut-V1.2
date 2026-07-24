import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { upsertLegalSourceRecordMock, upsertJudgmentMock, legalCorpusUpsertMock } = vi.hoisted(() => ({
  upsertLegalSourceRecordMock: vi.fn(async (input: { externalId: string }) => ({
    id: `ls-${input.externalId}`,
  })),
  upsertJudgmentMock: vi.fn(async (input: { guid: string }) => ({
    id: `j-${input.guid}`,
  })),
  legalCorpusUpsertMock: vi.fn(async (input: unknown) => input),
}));

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceRecord: upsertLegalSourceRecordMock,
}));

vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: upsertJudgmentMock,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    legalCorpusRecord: {
      upsert: legalCorpusUpsertMock,
    },
  },
}));

import {
  collectDownloadedLegalCorpus,
  importDownloadedLegalCorpus,
} from '../../server/modules/legal/services/legalCorpusImportService';

describe('legalCorpusImportService', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-corpus-import-'));
    await seedKnowledgeBase(rootDir);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('collects and imports a structured corpus across all downloaded source families', async () => {
    const records = await collectDownloadedLegalCorpus({
      rootDir,
      extractPdfText: false,
    });

    expect(records).toHaveLength(15);
    expect(records.some((record) => record.sourceFamily === 'JUDGMENT')).toBe(true);
    expect(records.some((record) => record.sourceFamily === 'BOVERKET')).toBe(true);
    expect(records.find((record) => record.sourceType === 'WFS_CAPABILITIES')?.postgisSchemaOverride).toBe(
      'env',
    );

    const result = await importDownloadedLegalCorpus({
      rootDir,
      extractPdfText: false,
    });

    expect(result.processed).toBe(15);
    expect(result.legalSourceRecordsUpserted).toBe(15);
    expect(result.judgmentRecordsUpserted).toBe(1);
    expect(legalCorpusUpsertMock).toHaveBeenCalledTimes(15);
    expect(legalCorpusUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordKey: expect.stringContaining('domstol-rss'),
        }),
        create: expect.objectContaining({
          court: 'Mark- och miljööverdomstolen',
          sourceFamily: 'JUDGMENT',
        }),
      }),
    );
  });
});

async function seedKnowledgeBase(rootDir: string) {
  await writeJson(path.join(rootDir, 'legal', 'foundation-sources', 'manifest.json'), {
    downloads: [
      {
        externalId: 'SFS:1998:808',
        title: 'Miljöbalken (1998:808)',
        sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
        contentType: 'text/html',
        savedAs: 'sfs-1998-808.html',
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'legal', 'foundation-sources', 'sfs-1998-808.html'),
    '<html><title>Miljöbalken</title><body>Miljöbalken gäller miljö.</body></html>',
  );

  await writeJson(path.join(rootDir, 'legal', 'curated-downloads', 'manifest.json'), {
    downloads: [
      {
        externalIds: ['HVMFS:2016:17'],
        titles: ['HVMFS 2016:17'],
        sourceUrl:
          'https://www.havochvatten.se/vagledning-foreskrifter-och-lagar/foreskrifter/register-avlopp/sma-avloppsanordningar-for-hushallsspillvatten-hvmfs-201617.html',
        contentType: 'text/html',
        savedAs: 'hvmfs-2016-17.html',
        authorityNames: ['Havs- och vattenmyndigheten'],
        sourceSystems: ['HAV'],
        sourceTypes: ['GUIDANCE'],
        collections: ['SEWAGE_EVIDENCE'],
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'legal', 'curated-downloads', 'hvmfs-2016-17.html'),
    '<html><title>HVMFS 2016:17</title><body>Råd för avloppsanordningar.</body></html>',
  );

  await writeJson(path.join(rootDir, 'legal', 'domstol-rss', 'items.json'), {
    items: [
      {
        guid: '160013',
        title: 'Mål: M 1234-24',
        link: 'https://www.domstol.se/mark--och-miljooverdomstolen/avgoranden/2025/160013/',
        savedAs: '160013.html',
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'legal', 'domstol-rss', 'feed.xml'),
    `<?xml version="1.0" encoding="utf-8"?><rss><channel><item><guid>160013</guid><title>Mål: M 1234-24</title><link>https://www.domstol.se/mark--och-miljooverdomstolen/avgoranden/2025/160013/</link><description>Praxis om miljötillstånd</description><pubDate>Mon, 10 Mar 2025 00:00:00 +0100</pubDate></item></channel></rss>`,
  );
  await writeText(
    path.join(rootDir, 'legal', 'domstol-rss', 'pages', '160013.html'),
    '<html><title>Mål: M 1234-24</title><body>Domstolen prövade miljötillståndet.</body></html>',
  );

  await writeJson(path.join(rootDir, 'legal', 'mod-corpus', 'manifest.json'), {
    items: [
      {
        guid: '160013',
        title: 'Mål: M 1234-24',
        link: 'https://www.domstol.se/mark--och-miljooverdomstolen/avgoranden/2025/160013/',
        savedAs: '160013.html',
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'legal', 'mod-corpus', 'pages', '160013.html'),
    '<html><title>MÖD</title><body>Kopia av MÖD-domen.</body></html>',
  );

  await writeJson(path.join(rootDir, 'legal', 'mmd-corpus', 'manifest.json'), {
    courts: [
      {
        id: 'nacka-tingsratt',
        title: 'Mark- och miljödomstolen vid Nacka tingsrätt',
        url: 'https://www.domstol.se/nacka-tingsratt/',
        savedAs: 'pages/nacka-tingsratt.html',
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'legal', 'mmd-corpus', 'overview.html'),
    '<html><title>Har finns vi</title><body>Mark- och miljödomstolar.</body></html>',
  );
  await writeText(
    path.join(rootDir, 'legal', 'mmd-corpus', 'pages', 'nacka-tingsratt.html'),
    '<html><title>Nacka tingsrätt</title><body>Mark- och miljödomstolen i Nacka.</body></html>',
  );

  await writeJson(path.join(rootDir, 'lansstyrelserna', 'manifest.json'), {
    counties: [
      {
        id: 'stockholm',
        title: 'Stockholms län',
        url: 'https://www.lansstyrelsen.se/stockholm',
        savedAs: 'pages/stockholm.html',
      },
    ],
  });
  await writeText(
    path.join(rootDir, 'lansstyrelserna', 'homepage.html'),
    '<html><title>Länsstyrelserna</title><body>Startsida.</body></html>',
  );
  await writeText(
    path.join(rootDir, 'lansstyrelserna', 'pages', 'stockholm.html'),
    '<html><title>Stockholms län</title><body>Miljö och tillsyn i Stockholms län.</body></html>',
  );

  await writeJson(path.join(rootDir, 'naturvardsverket', 'manifest.json'), {
    files: ['oppnadata.html', 'geodatakatalogen.html', 'naturvardsregistret-wfs-capabilities.xml'],
  });
  await writeText(
    path.join(rootDir, 'naturvardsverket', 'oppnadata.html'),
    '<html><title>Öppna data</title><body>Naturvårdsverket öppna data.</body></html>',
  );
  await writeText(
    path.join(rootDir, 'naturvardsverket', 'geodatakatalogen.html'),
    '<html><title>Geodatakatalogen</title><body>Geodata från Naturvårdsverket.</body></html>',
  );
  await writeText(
    path.join(rootDir, 'naturvardsverket', 'naturvardsregistret-wfs-capabilities.xml'),
    '<wfs:WFS_Capabilities>naturvardsregistret</wfs:WFS_Capabilities>',
  );

  await writeJson(path.join(rootDir, 'open-source-sweep', 'manifest.json'), {
    entries: [
      {
        id: 'smhi-pmp3g-point',
        url: 'https://opendata.smhi.se/metfcst/snow1gv1/geotype/point/lon/18.0686/lat/59.3293/data.json',
        fileName: 'smhi-point-forecast.json',
      },
    ],
  });
  await writeJson(path.join(rootDir, 'open-source-sweep', 'smhi-point-forecast.json'), {
    forecast: 'klart',
    temperature: 12,
  });

  await writeJson(path.join(rootDir, 'boverket', 'forfattningar', 'metadata', 'bfs1988-11.json'), {
    id: 'BFS1988-11',
    titel: 'Boverkets föreskrifter om radon',
    forfattning: 'BFS 1988:11',
    typ: 'grundforfattning',
    beslutad: '1988-10-04',
    trycklovad: '1988-11-07',
    dokumentlank: 'https://rinfo.boverket.se/BFS1988-11/pdf/BFS1988-11.pdf',
  });
  await writeBinary(
    path.join(rootDir, 'boverket', 'forfattningar', 'dokument', 'bfs1988-11.pdf'),
    'fake pdf',
  );
  await writeBinary(
    path.join(
      rootDir,
      'boverket',
      'forfattningar',
      'ovriga-dokument',
      'bfs1988-11__01__konsekvensutredning.pdf',
    ),
    'fake attachment',
  );
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, JSON.stringify(value, null, 2));
}

async function writeBinary(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(value, 'utf8'));
}
