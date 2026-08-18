import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from '../../../services/importPathService';

const BASE_URL = 'https://www.lansstyrelsen.se';

const LANSSTYRELSER = [
  { id: 'stockholm', title: 'Stockholms län', url: `${BASE_URL}/stockholm` },
  { id: 'uppsala', title: 'Uppsala län', url: `${BASE_URL}/uppsala` },
  { id: 'sodermanland', title: 'Södermanlands län', url: `${BASE_URL}/sodermanland` },
  { id: 'ostergotland', title: 'Östergötlands län', url: `${BASE_URL}/ostergotland` },
  { id: 'jonkoping', title: 'Jönköpings län', url: `${BASE_URL}/jonkoping` },
  { id: 'kronoberg', title: 'Kronobergs län', url: `${BASE_URL}/kronoberg` },
  { id: 'kalmar', title: 'Kalmar län', url: `${BASE_URL}/kalmar` },
  { id: 'gotland', title: 'Gotlands län', url: `${BASE_URL}/gotland` },
  { id: 'blekinge', title: 'Blekinge län', url: `${BASE_URL}/blekinge` },
  { id: 'skane', title: 'Skåne län', url: `${BASE_URL}/skane` },
  { id: 'halland', title: 'Hallands län', url: `${BASE_URL}/halland` },
  { id: 'vastra-gotaland', title: 'Västra Götalands län', url: `${BASE_URL}/vastra-gotaland` },
  { id: 'varmland', title: 'Värmlands län', url: `${BASE_URL}/varmland` },
  { id: 'orebro', title: 'Örebro län', url: `${BASE_URL}/orebro` },
  { id: 'vastmanland', title: 'Västmanlands län', url: `${BASE_URL}/vastmanland` },
  { id: 'dalarna', title: 'Dalarnas län', url: `${BASE_URL}/dalarna` },
  { id: 'gavleborg', title: 'Gävleborgs län', url: `${BASE_URL}/gavleborg` },
  { id: 'vasternorrland', title: 'Västernorrlands län', url: `${BASE_URL}/vasternorrland` },
  { id: 'jamtland', title: 'Jämtlands län', url: `${BASE_URL}/jamtland` },
  { id: 'vasterbotten', title: 'Västerbottens län', url: `${BASE_URL}/vasterbotten` },
  { id: 'norrbotten', title: 'Norrbottens län', url: `${BASE_URL}/norrbotten` },
] as const;

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface LansstyrelserCorpusResult {
  outputDir: string;
  manifestPath: string;
  processed: number;
}

interface LansstyrelserCorpusOptions {
  outputDir?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export const LANSSTYRELSER_CORPUS_CLASSIFICATION = 'DISCOVERY_ONLY' as const;
export const LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED =
  'P2-AUTH-03E1 BLOCKED: the Lansstyrelsen portal catalogue is discovery-only and cannot ' +
  'acquire or persist source payloads. Future authority requires exact signed endpoints.';

function rejectLegacyLansstyrelserCorpusAcquisition(): never {
  throw new Error(LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED);
}

export async function buildLansstyrelserCorpus(
  options: LansstyrelserCorpusOptions = {},
): Promise<LansstyrelserCorpusResult> {
  rejectLegacyLansstyrelserCorpusAcquisition();

  const outputDir = options.outputDir ?? resolveLansstyrelserCorpusDirectory();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const pagesDir = path.join(outputDir, 'pages');

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(pagesDir, { recursive: true });

  const homepage = await fetchPage(fetchImpl, `${BASE_URL}/`);
  await fs.writeFile(path.join(outputDir, 'homepage.html'), homepage, 'utf8');

  for (const county of LANSSTYRELSER) {
    const html = await fetchPage(fetchImpl, county.url);
    await fs.writeFile(path.join(pagesDir, `${county.id}.html`), html, 'utf8');
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        extractedAt: now().toISOString(),
        baseUrl: BASE_URL,
        processed: LANSSTYRELSER.length,
        counties: LANSSTYRELSER.map((county) => ({
          ...county,
          savedAs: `pages/${county.id}.html`,
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
    processed: LANSSTYRELSER.length,
  };
}

export function resolveLansstyrelserCorpusDirectory(): string {
  return resolveKnowledgeBasePath('lansstyrelserna');
}

async function fetchPage(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      'User-Agent': 'Miljobeslut Lansstyrelser Corpus Builder/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Kunde inte hämta ${url} (${response.status} ${response.statusText})`);
  }

  return response.text();
}
