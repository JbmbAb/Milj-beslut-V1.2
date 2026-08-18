import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveKnowledgeBasePath } from './importPathService';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

interface OpenSourceSweepEntry {
  id: string;
  url: string;
  fileName: string;
  accept: string;
}

interface OpenSourceSweepManifestEntry {
  id: string;
  url: string;
  fileName: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}

export interface OpenSourceSweepResult {
  outputDir: string;
  downloaded: number;
  attempted: number;
  manifestPath: string;
  entries: OpenSourceSweepManifestEntry[];
}

interface OpenSourceSweepOptions {
  outputDir?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export const OPEN_SOURCE_SWEEP_CLASSIFICATION = 'LEGACY_NON_AUTHORITATIVE_QUARANTINE' as const;
export const LEGACY_OPEN_SOURCE_SWEEP_BLOCKED =
  'P2-AUTH-03C BLOCKED: openSourceSweep is non-authoritative legacy discovery and cannot perform live acquisition';

function rejectLegacyOpenSourceSweepAcquisition(): never {
  throw new Error(LEGACY_OPEN_SOURCE_SWEEP_BLOCKED);
}

const OPEN_SOURCE_SWEEP_ENTRIES: readonly OpenSourceSweepEntry[] = [
  {
    id: 'scb-tables',
    url: 'https://api.scb.se/OV0104/v2beta/api/v2/tables',
    fileName: 'scb-tables.json',
    accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
  },
  {
    id: 'smhi-pmp3g-point',
    url: 'https://opendata.smhi.se/metfcst/snow1gv1/geotype/point/lon/18.0686/lat/59.3293/data.json',
    fileName: 'smhi-point-forecast.json',
    accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
  },
  {
    id: 'naturvardsverket-open-data',
    url: 'https://oppnadata.naturvardsverket.se/',
    fileName: 'naturvardsverket-oppnadata.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'sgu-brunnar-wms-capabilities',
    url: 'https://resource.sgu.se/service/wms/130/brunnar?request=GetCapabilities&service=WMS',
    fileName: 'sgu-brunnar-wms-capabilities.xml',
    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'lansstyrelsen-home',
    url: 'https://www.lansstyrelsen.se/',
    fileName: 'lansstyrelsen.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'raa-lamningar-wms-capabilities',
    url: 'https://pub.raa.se/visning/lamningar_v1/wms?service=WMS&request=GetCapabilities',
    fileName: 'raa-lamningar-wms-capabilities.xml',
    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
  {
    // RAÄ Öppna data-portal – geodata, metadata, WMS/API-översikt
    id: 'raa-oppna-data-portal',
    url: 'https://www.raa.se/hitta-information/oppna-data/oppna-data-portal/',
    fileName: 'raa-oppna-data-portal.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // RAÄ Fornsök WFS – GetCapabilities (fornlämningar, registrerade kulturminnen)
    id: 'raa-fornsok-wfs-capabilities',
    url: 'https://services.raa.se/fornsok/wfs/fornsok?service=WFS&version=1.1.0&request=GetCapabilities',
    fileName: 'raa-fornsok-wfs-capabilities.xml',
    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
  {
    // RAÄ Byggnadsminnen WFS – GetCapabilities
    id: 'raa-byggnadsminnen-wfs-capabilities',
    url: 'https://services.raa.se/byggnad/wfs/byggnadminne?service=WFS&request=GetCapabilities',
    fileName: 'raa-byggnadsminnen-wfs-capabilities.xml',
    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
  {
    // K-samsök – nationellt kulturarvs-API (museiföremål, byggnader, bilder m.m.)
    id: 'ksamsok-api-docs',
    url: 'https://www.k-samsok.se/api/',
    fileName: 'ksamsok-api-docs.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'msb-oversvamning-wms-capabilities',
    url: 'https://inspire.msb.se/geoserver/oversvamning/wms?service=WMS&request=GetCapabilities',
    fileName: 'msb-oversvamning-wms-capabilities.xml',
    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'boverket-open-data',
    url: 'https://www.boverket.se/sv/om-boverket/oppna-data/',
    fileName: 'boverket-oppna-data.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'hav-home',
    url: 'https://www.havochvatten.se/',
    fileName: 'havochvatten.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // Rapporter, broschyrer och inlärningsmaterial från Havs- och vattenmyndigheten
    id: 'hav-publikationer',
    url: 'https://www.havochvatten.se/data-kartor-och-rapporter/rapporter-och-andra-publikationer.html',
    fileName: 'havochvatten-publikationer.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // Söktjänst för HaV:s öppna dataset ("Havskatten") – filterat på ämne vatten/hav
    id: 'hav-oppna-data-katalog',
    url: 'https://www.havochvatten.se/data-kartor-och-rapporter/data-och-statistik/sok-oppna-data.html',
    fileName: 'havochvatten-oppna-data.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // Samlingssida för alla HaV API:er (badvatten, fisk, vattenförekomster m.m.)
    id: 'hav-api-oversikt',
    url: 'https://www.havochvatten.se/data-kartor-och-rapporter/data-och-statistik/data-och-apier.html',
    fileName: 'havochvatten-apier.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // HaV API: badplatser och badvatten (öppet REST-API)
    id: 'hav-api-badvatten',
    url: 'https://www.havochvatten.se/data-kartor-och-rapporter/data-och-statistik/data-och-apier/badplatser-och-badvatten.html',
    fileName: 'havochvatten-api-badvatten.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // HaV API: fiskets geografier (fiskegränser, restriktionsområden)
    id: 'hav-api-fiske',
    url: 'https://www.havochvatten.se/data-kartor-och-rapporter/data-och-statistik/data-och-apier/fiskets-geografier.html',
    fileName: 'havochvatten-api-fiske.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    // VISS – VattenInformationsSystem Sverige (vattenförekomster, ekologisk status, miljömål)
    id: 'viss-api',
    url: 'https://viss.lansstyrelsen.se/api',
    fileName: 'viss-api.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'smp-home',
    url: 'https://smp.lansstyrelsen.se/',
    fileName: 'smp.html',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  },
  {
    id: 'lantmateriet-fastighetsomrade-atom',
    url: 'https://api-ver.lantmateriet.se/fastighetsomrade/atom/v1/',
    fileName: 'lantmateriet-fastighetsomrade-atom.xml',
    accept: 'application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1',
  },
];

export async function downloadOpenSourceSweep(
  options: OpenSourceSweepOptions = {},
): Promise<OpenSourceSweepResult> {
  rejectLegacyOpenSourceSweepAcquisition();

  const outputDir = options.outputDir ?? resolveOpenSourceSweepDirectory();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const entries: OpenSourceSweepManifestEntry[] = [];
  let downloaded = 0;

  for (const entry of OPEN_SOURCE_SWEEP_ENTRIES) {
    try {
      const response = await fetchImpl(entry.url, {
        headers: {
          Accept: entry.accept,
          'User-Agent': 'Miljobeslut Open Source Sweeper/1.0',
        },
      });

      if (!response.ok) {
        entries.push({
          id: entry.id,
          url: entry.url,
          fileName: entry.fileName,
          ok: false,
          status: response.status,
          statusText: response.statusText,
        });
        continue;
      }

      await fs.writeFile(path.join(outputDir, entry.fileName), await response.text(), 'utf8');
      downloaded += 1;
      entries.push({
        id: entry.id,
        url: entry.url,
        fileName: entry.fileName,
        ok: true,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (error) {
      entries.push({
        id: entry.id,
        url: entry.url,
        fileName: entry.fileName,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        fetchedAt: now().toISOString(),
        attempted: OPEN_SOURCE_SWEEP_ENTRIES.length,
        downloaded,
        entries,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    outputDir,
    downloaded,
    attempted: OPEN_SOURCE_SWEEP_ENTRIES.length,
    manifestPath,
    entries,
  };
}

export function resolveOpenSourceSweepDirectory(): string {
  return resolveKnowledgeBasePath('open-source-sweep');
}
