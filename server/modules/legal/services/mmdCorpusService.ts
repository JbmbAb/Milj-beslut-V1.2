import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

const DOMSTOL_BASE_URL = 'https://www.domstol.se';
const COURTS_OVERVIEW_URL =
  'https://www.domstol.se/amnen/mark-och-miljo/introduktion-till-mark--och-miljodomstolen/har-finns-vi/';

const MMD_COURTS = [
  {
    id: 'umea-tingsratt',
    title: 'Mark- och miljödomstolen vid Umeå tingsrätt',
    url: 'https://www.domstol.se/umea-tingsratt/',
  },
  {
    id: 'ostersunds-tingsratt',
    title: 'Mark- och miljödomstolen vid Östersunds tingsrätt',
    url: 'https://www.domstol.se/ostersunds-tingsratt/',
  },
  {
    id: 'nacka-tingsratt',
    title: 'Mark- och miljödomstolen vid Nacka tingsrätt',
    url: 'https://www.domstol.se/nacka-tingsratt/',
  },
  {
    id: 'vanersborgs-tingsratt',
    title: 'Mark- och miljödomstolen vid Vänersborgs tingsrätt',
    url: 'https://www.domstol.se/vanersborgs-tingsratt/',
  },
  {
    id: 'vaxjo-tingsratt',
    title: 'Mark- och miljödomstolen vid Växjö tingsrätt',
    url: 'https://www.domstol.se/vaxjo-tingsratt/',
  },
] as const;

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface MmdCorpusResult {
  outputDir: string;
  manifestPath: string;
  processed: number;
}

interface MmdCorpusOptions {
  outputDir?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export async function buildMmdCorpus(options: MmdCorpusOptions = {}): Promise<MmdCorpusResult> {
  const outputDir = options.outputDir ?? resolveMmdCorpusDirectory();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const pagesDir = path.join(outputDir, 'pages');

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(pagesDir, { recursive: true });

  const overview = await fetchPage(fetchImpl, COURTS_OVERVIEW_URL);
  await fs.writeFile(path.join(outputDir, 'overview.html'), overview, 'utf8');

  for (const court of MMD_COURTS) {
    const html = await fetchPage(fetchImpl, court.url);
    await fs.writeFile(path.join(pagesDir, `${court.id}.html`), html, 'utf8');
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        extractedAt: now().toISOString(),
        baseUrl: DOMSTOL_BASE_URL,
        overviewUrl: COURTS_OVERVIEW_URL,
        processed: MMD_COURTS.length,
        courts: MMD_COURTS.map((court) => ({
          ...court,
          savedAs: `pages/${court.id}.html`,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    outputDir,
    manifestPath,
    processed: MMD_COURTS.length,
  };
}

export function resolveMmdCorpusDirectory(): string {
  return resolveKnowledgeBasePath('legal', 'mmd-corpus');
}

async function fetchPage(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'User-Agent': 'Miljobeslut MMD Corpus Builder/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Kunde inte hämta ${url} (${response.status} ${response.statusText})`);
  }

  return response.text();
}
