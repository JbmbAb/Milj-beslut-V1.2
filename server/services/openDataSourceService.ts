import { promises as fs } from 'node:fs';
import path from 'node:path';

interface FetchResult {
  source: string;
  ok: boolean;
  endpoint: string;
  status?: number;
  details?: string;
  sample?: unknown;
}

const REQUEST_HEADERS = {
  Accept: '*/*',
  'User-Agent': 'Miljöbeslut/2.0 (+https://miljobeslut.se)',
};

async function fetchJson(endpoint: string): Promise<FetchResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: REQUEST_HEADERS,
    });
    const text = await response.text();
    let sample: unknown = text.length > 2500 ? text.slice(0, 2500) : text;
    try {
      sample = JSON.parse(text);
    } catch {
      // Keep string sample.
    }

    return {
      source: endpoint,
      ok: response.ok,
      endpoint,
      status: response.status,
      sample,
    };
  } catch (error: unknown) {
    return {
      source: endpoint,
      ok: false,
      endpoint,
      details: error instanceof Error ? error.message : 'fetch failed',
    };
  }
}

async function fetchText(endpoint: string): Promise<FetchResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: REQUEST_HEADERS,
    });
    const text = await response.text();
    return {
      source: endpoint,
      ok: response.ok,
      endpoint,
      status: response.status,
      sample: text.length > 2500 ? text.slice(0, 2500) : text,
    };
  } catch (error: unknown) {
    return {
      source: endpoint,
      ok: false,
      endpoint,
      details: error instanceof Error ? error.message : 'fetch failed',
    };
  }
}

async function checkLastkajenSource(): Promise<FetchResult> {
  try {
    const path = './lastkajenService';
    const { pingLastkajen } = await import(path);
    const result = await pingLastkajen();
    return {
      source: result.source,
      ok: result.ok,
      endpoint: result.endpoint,
      details: result.details,
      sample: result.packageCount !== undefined ? { packageCount: result.packageCount } : undefined,
    };
  } catch (error: unknown) {
    return {
      source: 'Lastkajen API',
      ok: false,
      endpoint: 'https://lastkajen.trafikverket.se',
      details: error instanceof Error ? error.message : 'Lastkajen service is not available (module deleted).',
    };
  }
}

async function checkTrafikverketSource(): Promise<FetchResult> {
  const endpoint = String(
    process.env.TRAFIKVERKET_API_BASE_URL || 'https://api.trafikinfo.trafikverket.se/v2/data.json',
  ).trim();
  const apiKey = String(process.env.TRAFIKVERKET_API_KEY || '').trim();

  if (!apiKey) {
    return {
      source: 'trafikverket',
      ok: false,
      endpoint,
      details: 'TRAFIKVERKET_API_KEY saknas.',
    };
  }

  const requestBody = [
    '<REQUEST>',
    `<LOGIN authenticationkey="${apiKey}" />`,
    '<QUERY objecttype="TrainAnnouncement" schemaversion="1.8" limit="1">',
    '<INCLUDE>ActivityType</INCLUDE>',
    '<INCLUDE>LocationSignature</INCLUDE>',
    '<INCLUDE>AdvertisedTimeAtLocation</INCLUDE>',
    '</QUERY>',
    '</REQUEST>',
  ].join('');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...REQUEST_HEADERS,
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: requestBody,
    });

    const text = await response.text();
    let sample: unknown = text.length > 2500 ? text.slice(0, 2500) : text;
    try {
      sample = JSON.parse(text);
    } catch {
      // Keep string sample.
    }

    return {
      source: 'trafikverket',
      ok: response.ok,
      endpoint,
      status: response.status,
      sample,
    };
  } catch (error: unknown) {
    return {
      source: 'trafikverket',
      ok: false,
      endpoint,
      details: error instanceof Error ? error.message : 'trafikverket fetch failed',
    };
  }
}

async function checkLocalCsv(csvPath: string): Promise<FetchResult> {
  if (!csvPath) {
    return {
      source: 'kommun_kontakter_csv',
      ok: false,
      endpoint: '',
      details: 'MUNICIPAL_CONTACTS_CSV_PATH eller LOCAL_DB_ROOT ar inte satt.',
    };
  }

  try {
    const stat = await fs.stat(csvPath);
    const handle = await fs.open(csvPath, 'r');
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    await handle.close();
    const preview = buffer.subarray(0, bytesRead).toString('utf8');

    return {
      source: 'kommun_kontakter_csv',
      ok: true,
      endpoint: csvPath,
      status: 200,
      sample: {
        sizeBytes: stat.size,
        preview: preview.slice(0, 500),
      },
    };
  } catch (error: unknown) {
    return {
      source: 'kommun_kontakter_csv',
      ok: false,
      endpoint: csvPath,
      details: error instanceof Error ? error.message : 'csv check failed',
    };
  }
}

function resolveMunicipalContactsCsvPath(): string {
  const explicit = String(process.env.MUNICIPAL_CONTACTS_CSV_PATH || '').trim();
  if (explicit) {
    return explicit;
  }

  const localDbRoot = String(process.env.LOCAL_DB_ROOT || '').trim();
  if (!localDbRoot) {
    return '';
  }

  return path.join(localDbRoot, 'Kontaktuppgifter kommuner.csv');
}

async function checkMunicipalDiariesSource(): Promise<FetchResult> {
  const indexUrl = String(process.env.MUNICIPAL_DIARIES_INDEX_URL || '').trim();
  if (!indexUrl) {
    return {
      source: 'kommunala_diarier',
      ok: false,
      endpoint: '',
      details: 'MUNICIPAL_DIARIES_INDEX_URL saknas.',
    };
  }

  const result = await fetchText(indexUrl);
  return {
    ...result,
    source: 'kommunala_diarier',
  };
}

function checkFtpSource(endpoint: string): FetchResult {
  return {
    source: 'lantmateriet_open_ftp',
    ok: true,
    endpoint,
    status: 200,
    details: 'FTP-kalla markerad som aktiv. Livecheck via HTTP-fetch stods inte i Node runtime.',
  };
}

export async function fetchImmediateOpenSources(): Promise<FetchResult[]> {
  const checks: Array<Promise<FetchResult>> = [
    fetchJson('https://api.scb.se/OV0104/v2beta/api/v2/tables').then((row) => ({ ...row, source: 'scb' })),
    fetchJson('https://opendata.smhi.se/metfcst/snow1gv1/geotype/point/lon/18.0686/lat/59.3293/data.json').then(
      (row) => ({ ...row, source: 'smhi' }),
    ),
    fetchText('https://oppnadata.naturvardsverket.se/').then((row) => ({
      ...row,
      source: 'naturvardsverket',
    })),
    fetchText('https://resource.sgu.se/service/wms/130/brunnar?request=GetCapabilities&service=WMS').then(
      (row) => ({
        ...row,
        source: 'sgu',
      }),
    ),
    fetchText('https://www.lansstyrelsen.se/').then((row) => ({ ...row, source: 'lansstyrelsen' })),
    fetchText('https://pub.raa.se/visning/lamningar_v1/wms?service=WMS&request=GetCapabilities').then(
      (row) => ({
        ...row,
        source: 'riksantikvarieambetet',
      }),
    ),
    fetchText('https://inspire.msb.se/geoserver/oversvamning/wms?service=WMS&request=GetCapabilities').then(
      (row) => ({
        ...row,
        source: 'msb',
      }),
    ),
    fetchText('https://www.boverket.se/sv/om-boverket/oppna-data/').then((row) => ({
      ...row,
      source: 'boverket',
    })),
    fetchText('https://www.havochvatten.se/').then((row) => ({ ...row, source: 'hav' })),
    fetchText('https://smp.lansstyrelsen.se/').then((row) => ({ ...row, source: 'smp' })),
    checkTrafikverketSource(),
    checkLastkajenSource(),
    fetchText('https://api-ver.lantmateriet.se/fastighetsomrade/atom/v1/').then((row) => ({
      ...row,
      source: 'lantmateriet_open_fastighetsomrade',
    })),
    Promise.resolve(checkFtpSource('ftp://download-opendata.lantmateriet.se/')),
    checkLocalCsv(resolveMunicipalContactsCsvPath()),
    checkMunicipalDiariesSource(),
  ];

  return Promise.all(checks);
}
