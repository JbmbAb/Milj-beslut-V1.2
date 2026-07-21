import { importDownloadedLegalCorpus } from '../server/modules/legal/services/legalCorpusImportService';

function readFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readStringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const raw = process.argv[index + 1];
  return raw ? raw.trim() : undefined;
}

function readNumberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const result = await importDownloadedLegalCorpus({
    extractPdfText: !readFlag('--skip-pdf-text'),
    limit: readNumberFlag('--limit'),
    rootDir: readStringFlag('--root-dir'),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('import-downloaded-legal-corpus failed:', error);
  process.exitCode = 1;
});
