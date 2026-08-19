/**
 * Seed core Swedish environmental law texts into LegalCorpusRecord, then ready for rechunk.
 *
 * Usage:
 *   npx tsx scripts/import/seed-core-legal-sfs.ts
 */
import { loadEnvFile } from '../../server/loadEnv';
loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../server/db/prisma';

const LAWS = [
  {
    id: '1998:808',
    title: 'Miljöbalken',
    url: 'https://data.riksdagen.se/dokument/sfs-1998-808.text',
  },
  {
    id: '2013:251',
    title: 'Miljöprövningsförordningen',
    url: 'https://data.riksdagen.se/dokument/sfs-2013-251.text',
  },
  {
    id: '2020:614',
    title: 'Avfallsförordningen',
    url: 'https://data.riksdagen.se/dokument/sfs-2020-614.text',
  },
  {
    id: '1998:899',
    title: 'Förordningen om miljöfarlig verksamhet och hälsoskydd',
    url: 'https://data.riksdagen.se/dokument/sfs-1998-899.text',
  },
  {
    id: '2006:412',
    title: 'Lagen om allmänna vattentjänster',
    url: 'https://data.riksdagen.se/dokument/sfs-2006-412.text',
  },
  {
    id: '2010:900',
    title: 'Plan- och bygglagen',
    url: 'https://data.riksdagen.se/dokument/sfs-2010-900.text',
  },
];

function rejectNonCanonicalLegalCorpusSeed(): never {
  throw new Error(
    'P2-AUTH-02 QUARANTINED: use verified SourceRegistry acquisition and the canonical corpus import gate',
  );
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MiljobeslutLegalBot/1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

async function main() {
  rejectNonCanonicalLegalCorpusSeed();

  let ok = 0;
  let fail = 0;

  for (const law of LAWS) {
    try {
      console.error(`Hämtar ${law.title} (${law.id})...`);
      const documentText = await fetchText(law.url);
      if (documentText.trim().length < 200) {
        throw new Error(`För kort text (${documentText.length} tecken)`);
      }

      const contentHash = createHash('sha256').update(documentText).digest('hex');
      const recordKey = `foundation:sfs-${law.id.replace(':', '-')}`;
      const canonicalKey = `sfs:${law.id}`;
      const searchText = `${law.title}\n${documentText}`.slice(0, 500_000);

      // Guarded behavior: by default perform archive-first (download + manifest) and do NOT write to DB.
      // To allow live seeding (dangerous, breaks archive-first policy), set environment variable ALLOW_LIVE_SEED='true'.
      if (process.env.ALLOW_LIVE_SEED === 'true') {
        await prisma.legalCorpusRecord.upsert({
          where: { recordKey },
          create: {
            recordKey,
            canonicalKey,
            sourceFamily: 'FOUNDATION',
            sourceType: 'statute',
            sourceSystem: 'SFS',
            externalId: law.id,
            title: law.title,
            summary: law.title,
            authorityName: 'Riksdagen',
            authorityType: 'LEGISLATURE',
            legalArea: 'miljo',
            language: 'sv',
            mimeType: 'text/plain',
            formatHint: 'sfs-text',
            sourceUrl: law.url,
            normalizedUrl: law.url,
            sourcePath: `legal/foundation-sources/sfs-${law.id.replace(':', '-')}.text`,
            documentText,
            searchText,
            metadata: { seededBy: 'seed-core-legal-sfs', lawId: law.id },
            tags: ['foundation', 'sfs', 'miljo'],
            contentHash,
            byteSize: Buffer.byteLength(documentText, 'utf8'),
          },
          update: {
            title: law.title,
            documentText,
            searchText,
            contentHash,
            byteSize: Buffer.byteLength(documentText, 'utf8'),
            sourceUrl: law.url,
            normalizedUrl: law.url,
            updatedAt: new Date(),
          },
        });
        console.error(`  LIVE-UPSERT OK ${law.title}: ${documentText.length} tecken`);
      } else {
        // Archive-first: save raw text and create manifest for later ingestion.
        const archiveDir = path.resolve(process.cwd(), 'archives', 'raw');
        fs.mkdirSync(archiveDir, { recursive: true });
        const archivePath = path.join(archiveDir, `sfs-${law.id.replace(':', '-')}.text`);
        fs.writeFileSync(archivePath, documentText, 'utf8');

        const manifestDir = path.resolve(process.cwd(), 'scripts', 'import', 'manifests');
        fs.mkdirSync(manifestDir, { recursive: true });
        const manifest = {
          recordKey,
          canonicalKey,
          lawId: law.id,
          title: law.title,
          sourceUrl: law.url,
          sourcePath: archivePath,
          metadata: { seededBy: 'seed-core-legal-sfs' },
          contentHash,
          byteSize: Buffer.byteLength(documentText, 'utf8'),
          disposition: 'downloaded-only',
          createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(manifestDir, `sfs-${law.id.replace(':', '-')}.json`), JSON.stringify(manifest, null, 2), 'utf8');
        console.error(`  SAVED ${law.title} -> ${archivePath} (manifest created)`);
      }

      console.error(`  OK ${law.title}: ${documentText.length} tecken`);
      ok += 1;
      await new Promise((r) => setTimeout(r, 400));
    } catch (err: any) {
      fail += 1;
      console.error(`  FEL ${law.title}: ${err.message}`);
    }
  }

  const total = await prisma.legalCorpusRecord.count();
  console.log(JSON.stringify({ seededOk: ok, seededFail: fail, legalRecordsTotal: total }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
