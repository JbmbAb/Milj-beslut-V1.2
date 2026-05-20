import type { ExternalHealthCheck, ExternalHealthReport } from '../../types';
import { SOURCE_CATALOG, type ActivationClass } from '../datasources/catalog';
import { isLantmaterietOpenMode } from '../security/env';
import { getLantmaterietOpenMapStatus } from './lantmaterietService';
import { fetchImmediateOpenSources } from './openDataSourceService';
import { getSluProductStatus, pingSluProduct } from './sluService';
import { getDispatchProviderRuntimeStatus } from './transportDispatchService';
import { vertexConfigStatus } from './vertexAiService';

type HealthStatus = ExternalHealthCheck['status'];
type HealthMode = ExternalHealthCheck['mode'];

type OpenSourceProbe = Awaited<ReturnType<typeof fetchImmediateOpenSources>>[number];

const SAMPLE_LAT = 59.3293;
const SAMPLE_LNG = 18.0686;

function nowIso(): string {
  return new Date().toISOString();
}

function buildCheck(input: {
  key: string;
  label: string;
  category: string;
  status: HealthStatus;
  mode: HealthMode;
  configured: boolean;
  detail: string;
  endpoint?: string | null;
  responseCode?: number | null;
  activation?: ActivationClass | 'OPTIONAL';
}): ExternalHealthCheck {
  return {
    key: input.key,
    label: input.label,
    category: input.category,
    status: input.status,
    mode: input.mode,
    configured: input.configured,
    detail: input.detail,
    endpoint: input.endpoint ?? null,
    responseCode: input.responseCode ?? null,
    activation: input.activation,
  };
}

function countByStatus(checks: ExternalHealthCheck[], status: HealthStatus): number {
  return checks.filter((check) => check.status === status).length;
}

export function summarizeExternalHealthReport(
  checks: ExternalHealthCheck[],
  checkedAt: string = nowIso(),
): ExternalHealthReport {
  const sortedChecks = [...checks].sort((left, right) => {
    const byCategory = left.category.localeCompare(right.category, 'sv');
    if (byCategory !== 0) return byCategory;
    return left.label.localeCompare(right.label, 'sv');
  });

  const totals = {
    total: sortedChecks.length,
    healthy: countByStatus(sortedChecks, 'healthy'),
    degraded: countByStatus(sortedChecks, 'degraded'),
    error: countByStatus(sortedChecks, 'error'),
    notConfigured: countByStatus(sortedChecks, 'not_configured'),
    configured: sortedChecks.filter((check) => check.configured).length,
    liveChecked: sortedChecks.filter((check) => check.mode === 'live').length,
  };

  const overall: ExternalHealthReport['overall'] =
    totals.error > 0 ? 'error' : totals.degraded > 0 || totals.notConfigured > 0 ? 'degraded' : 'ok';

  const categoryMap = new Map<string, ExternalHealthReport['categories'][number]>();
  for (const check of sortedChecks) {
    const current = categoryMap.get(check.category) || {
      name: check.category,
      total: 0,
      healthy: 0,
      degraded: 0,
      error: 0,
      notConfigured: 0,
    };
    current.total += 1;
    if (check.status === 'healthy') current.healthy += 1;
    if (check.status === 'degraded') current.degraded += 1;
    if (check.status === 'error') current.error += 1;
    if (check.status === 'not_configured') current.notConfigured += 1;
    categoryMap.set(check.category, current);
  }

  return {
    checkedAt,
    overall,
    totals,
    categories: [...categoryMap.values()].sort((left, right) => left.name.localeCompare(right.name, 'sv')),
    checks: sortedChecks,
  };
}

function integrationCategory(key?: string): string {
  if (!key) return 'Ovrigt';
  if (key === 'bankid') return 'Identitet';
  if (key === 'slu' || key === 'viss') return 'Miljo och artdata';
  if (key.startsWith('lantmateriet')) return 'Geodata';
  if (key === 'scb' || key === 'smhi' || key === 'trafikverket') return 'Datakallor';
  if (
    key === 'riksantikvarieambetet' ||
    key === 'naturvardsverket' ||
    key === 'sgu' ||
    key === 'msb' ||
    key === 'boverket' ||
    key === 'hav' ||
    key === 'lansstyrelsen'
  ) {
    return 'Datakallor';
  }
  if (key === 'smp' || key === 'bolagsverket') return 'Myndighetsfloden';
  return 'Ovrigt';
}

function mapOpenProbeToCheck(
  source: (typeof SOURCE_CATALOG)[number],
  probe: OpenSourceProbe | undefined,
): ExternalHealthCheck {
  const key = String(source.implementationKey || source.name).trim();
  const category = integrationCategory(key);

  if (!probe) {
    return buildCheck({
      key,
      label: source.name,
      category,
      status: source.activation === 'PERMIT_REQUIRED' ? 'not_configured' : 'degraded',
      mode: 'derived',
      configured: false,
      detail: source.reason,
      activation: source.activation,
    });
  }

  if (key === 'lantmateriet_open_ftp') {
    return buildCheck({
      key,
      label: source.name,
      category,
      status: 'degraded',
      mode: 'derived',
      configured: true,
      detail: probe.details || 'FTP-kalla markeras aktiv men kan inte liveprobas i Node runtime.',
      endpoint: probe.endpoint,
      responseCode: probe.status ?? null,
      activation: source.activation,
    });
  }

  if (!probe.ok) {
    const isMissingCredential = /saknas/i.test(String(probe.details || ''));
    return buildCheck({
      key,
      label: source.name,
      category,
      status: isMissingCredential ? 'not_configured' : 'error',
      mode: isMissingCredential ? 'config' : 'live',
      configured: !isMissingCredential,
      detail: probe.details || `Livecheck misslyckades (${probe.status || 'okand status'})`,
      endpoint: probe.endpoint,
      responseCode: probe.status ?? null,
      activation: source.activation,
    });
  }

  return buildCheck({
    key,
    label: source.name,
    category,
    status: 'healthy',
    mode: 'live',
    configured: true,
    detail: `Livecheck OK (${probe.status || 'n/a'})`,
    endpoint: probe.endpoint,
    responseCode: probe.status ?? null,
    activation: source.activation,
  });
}

/**
 * Produkten använder Vertex AI (samma fakturering/IAM) — ingen separat
 * "Gemini API key" / OpenAI-hälsokontroll längre.
 */
async function probeVertexAi(): Promise<ExternalHealthCheck> {
  const st = vertexConfigStatus();
  if (!st.configured) {
    return buildCheck({
      key: 'vertex_ai',
      label: 'Vertex AI (generativ AI)',
      category: 'AI',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: `Saknas: ${st.missing.join(', ')}. Använd ADC (t.ex. gcloud) eller service account i molnet.`,
      endpoint: 'https://cloud.google.com/vertex-ai',
      activation: 'OPTIONAL',
    });
  }
  return buildCheck({
    key: 'vertex_ai',
    label: 'Vertex AI (generativ AI)',
    category: 'AI',
    status: st.hasExplicitServiceAccountFile || st.projectId ? 'healthy' : 'degraded',
    mode: 'config',
    configured: true,
    detail: `Projekt ${st.projectId}, region ${st.location}${
      st.hasExplicitServiceAccountFile
        ? ', explicit service account.'
        : ' (använder ADC / workload identity – ok för Cloud Run).'
    }`,
    endpoint: `https://console.cloud.google.com/vertex-ai?project=${encodeURIComponent(String(st.projectId))}`,
    activation: 'OPTIONAL',
  });
}

async function probeViss(): Promise<ExternalHealthCheck> {
  const apiKey = String(process.env.VISS_API_KEY || '').trim();
  const baseUrl = String(process.env.VISS_API_BASE_URL || 'https://viss.lansstyrelsen.se/api').trim();
  if (!apiKey) {
    return buildCheck({
      key: 'viss',
      label: 'VISS Open API',
      category: 'Miljo och artdata',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: 'VISS_API_KEY saknas.',
      endpoint: baseUrl,
      activation: 'OPTIONAL',
    });
  }

  const params = new URLSearchParams({
    method: 'coordinateinfo',
    format: 'Json',
    apikey: apiKey,
    x: String(SAMPLE_LAT),
    y: String(SAMPLE_LNG),
    radius: '200',
    coordinateformat: 'WGS84',
  });
  const endpoint = `${baseUrl}?${params.toString()}`;
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    return buildCheck({
      key: 'viss',
      label: 'VISS Open API',
      category: 'Miljo och artdata',
      status: 'error',
      mode: 'live',
      configured: true,
      detail: `VISS svarade ${response.status}: ${text.slice(0, 140)}`,
      endpoint: baseUrl,
      responseCode: response.status,
      activation: 'OPTIONAL',
    });
  }

  const payload = (await response.json()) as { NearbyWaters?: unknown[] };
  return buildCheck({
    key: 'viss',
    label: 'VISS Open API',
    category: 'Miljo och artdata',
    status: 'healthy',
    mode: 'live',
    configured: true,
    detail: `Livecheck OK. NearbyWaters=${Array.isArray(payload.NearbyWaters) ? payload.NearbyWaters.length : 0}.`,
    endpoint: baseUrl,
    responseCode: response.status,
    activation: 'OPTIONAL',
  });
}

async function probeLantmaterietLicensed(): Promise<ExternalHealthCheck> {
  const accessToken = String(process.env.LANTMATERIET_ACCESS_TOKEN || '').trim();
  const consumerKey = String(process.env.LANTMATERIET_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.LANTMATERIET_CONSUMER_SECRET || '').trim();
  const apiKey = String(process.env.LANTMATERIET_API_KEY || '').trim();
  const baseUrl = String(
    process.env.LANTMATERIET_BASE_URL || 'https://api.lantmateriet.se/ogc-features/v1',
  ).trim();
  const configuredTokenUrl = String(process.env.LANTMATERIET_TOKEN_URL || '').trim();
  const tokenUrl = configuredTokenUrl || `${new URL(baseUrl).origin}/token`;

  if (!accessToken && !consumerKey && !consumerSecret && !apiKey) {
    return buildCheck({
      key: 'lantmateriet_licensed',
      label: 'Lantmateriet licensierad API',
      category: 'Geodata',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: 'Ingen licensierad Lantmateriet-konfiguration hittades.',
      endpoint: baseUrl,
      activation: 'PERMIT_REQUIRED',
    });
  }

  if (accessToken && !consumerKey && !consumerSecret) {
    return buildCheck({
      key: 'lantmateriet_licensed',
      label: 'Lantmateriet licensierad API',
      category: 'Geodata',
      status: 'degraded',
      mode: 'config',
      configured: true,
      detail: 'Access token finns, men ingen live tokenprobe gjordes. Kontrollera scope manuellt vid behov.',
      endpoint: baseUrl,
      activation: 'PERMIT_REQUIRED',
    });
  }

  if (!consumerKey || !consumerSecret) {
    return buildCheck({
      key: 'lantmateriet_licensed',
      label: 'Lantmateriet licensierad API',
      category: 'Geodata',
      status: 'degraded',
      mode: 'config',
      configured: true,
      detail: apiKey
        ? 'API-nyckel finns, men property lookup-flodet anvander OAuth consumer credentials eller access token.'
        : 'Konfigurationen ar ofullstandig for licensierad lookup.',
      endpoint: baseUrl,
      activation: 'PERMIT_REQUIRED',
    });
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const lookupMode = String(process.env.LANTMATERIET_LOOKUP_MODE || '')
    .trim()
    .toLowerCase();
  const defaultScope = lookupMode === 'ogc' ? 'ogc-features:fastighetsindelning.read' : '';
  const scope = String(process.env.LANTMATERIET_SCOPE || defaultScope);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    return buildCheck({
      key: 'lantmateriet_licensed',
      label: 'Lantmateriet licensierad API',
      category: 'Geodata',
      status: 'error',
      mode: 'live',
      configured: true,
      detail: `Tokenprobe misslyckades (${response.status}): ${text.slice(0, 140)}`,
      endpoint: tokenUrl,
      responseCode: response.status,
      activation: 'PERMIT_REQUIRED',
    });
  }

  const payload = (await response.json()) as { scope?: string; expires_in?: number };
  return buildCheck({
    key: 'lantmateriet_licensed',
    label: 'Lantmateriet licensierad API',
    category: 'Geodata',
    status: 'healthy',
    mode: 'live',
    configured: true,
    detail: `Tokenprobe OK. Scope: ${payload.scope || scope || 'okand'}.`,
    endpoint: tokenUrl,
    responseCode: response.status,
    activation: 'PERMIT_REQUIRED',
  });
}

async function probeLantmaterietOpen(): Promise<ExternalHealthCheck> {
  const result = await getLantmaterietOpenMapStatus();
  return buildCheck({
    key: 'lantmateriet_open_map',
    label: 'Lantmateriet open map',
    category: 'Geodata',
    status: result.ok ? 'healthy' : 'error',
    mode: 'live',
    configured: true,
    detail: result.ok
      ? `Livecheck OK (${result.status || 'n/a'}), mode=${result.mode}${isLantmaterietOpenMode() ? ', open mode' : ''}.`
      : `Open map svarade ${result.status || 'okand status'}.`,
    endpoint: result.endpoint,
    responseCode: result.status ?? null,
    activation: 'IMMEDIATE',
  });
}

async function probeSlu(): Promise<ExternalHealthCheck> {
  const productStatus = getSluProductStatus();
  const missing = productStatus.filter((product) => !product.hasApiKey || !product.hasBasePath);
  if (missing.length > 0) {
    return buildCheck({
      key: 'slu',
      label: 'SLU Artdatabanken',
      category: 'Miljo och artdata',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: `Ofullstandig konfiguration for: ${missing.map((product) => product.product).join(', ')}.`,
      endpoint: String(process.env.SLU_API_BASE_URL || '').trim() || null,
      activation: 'PERMIT_REQUIRED',
    });
  }

  const products = productStatus.map((product) => product.product);
  const pingResults = await Promise.allSettled(products.map((product) => pingSluProduct(product)));
  const failing = pingResults
    .map((result, index) => {
      const product = products[index];
      if (result.status === 'fulfilled' && result.value.ok) return null;
      if (result.status === 'fulfilled') return `${product} (${result.value.status})`;
      return `${product} (${result.reason instanceof Error ? result.reason.message : 'ping failed'})`;
    })
    .filter((value): value is string => Boolean(value));

  if (failing.length > 0) {
    return buildCheck({
      key: 'slu',
      label: 'SLU Artdatabanken',
      category: 'Miljo och artdata',
      status: 'error',
      mode: 'live',
      configured: true,
      detail: `SLU liveprobe misslyckades for: ${failing.join(', ')}.`,
      endpoint: String(process.env.SLU_API_BASE_URL || '').trim() || null,
      activation: 'PERMIT_REQUIRED',
    });
  }

  const okEndpoint = pingResults.find(
    (result): result is PromiseFulfilledResult<{ ok: boolean; status: number; endpoint: string }> => {
      return result.status === 'fulfilled' && result.value.ok;
    },
  );
  return buildCheck({
    key: 'slu',
    label: 'SLU Artdatabanken',
    category: 'Miljo och artdata',
    status: 'healthy',
    mode: 'live',
    configured: true,
    detail: `Livecheck OK for ${products.length} produkter.`,
    endpoint: okEndpoint?.value.endpoint || String(process.env.SLU_API_BASE_URL || '').trim() || null,
    responseCode: okEndpoint?.value.status ?? null,
    activation: 'PERMIT_REQUIRED',
  });
}

function probeBankId(): ExternalHealthCheck {
  const hasPfx = Boolean(String(process.env.BANKID_PFX_PATH || '').trim());
  const hasPemPair = Boolean(
    String(process.env.BANKID_CERT_PATH || '').trim() && String(process.env.BANKID_KEY_PATH || '').trim(),
  );
  const baseUrl = String(process.env.BANKID_BASE_URL || '').trim();
  const configured = Boolean(baseUrl) && (hasPfx || hasPemPair);

  return buildCheck({
    key: 'bankid',
    label: 'BankID',
    category: 'Identitet',
    status: configured ? 'degraded' : 'not_configured',
    mode: 'config',
    configured,
    detail: configured
      ? 'mTLS-konfiguration finns, men ingen live authprobe goras for att undvika riktiga bestallningar.'
      : 'BankID saknar certifikat/PFX eller base URL.',
    endpoint: baseUrl || 'https://appapi2.bankid.com/rp/v6.0',
    activation: 'PERMIT_REQUIRED',
  });
}

async function probeMarketIntel(): Promise<ExternalHealthCheck> {
  const endpoint = String(process.env.MARKET_INTEL_ENDPOINT || '').trim();
  if (!endpoint) {
    return buildCheck({
      key: 'market_intel',
      label: 'Market intel endpoint',
      category: 'Workflow',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail: 'MARKET_INTEL_ENDPOINT saknas. Appen faller tillbaka till statiska priser.',
      activation: 'OPTIONAL',
    });
  }

  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    return buildCheck({
      key: 'market_intel',
      label: 'Market intel endpoint',
      category: 'Workflow',
      status: 'error',
      mode: 'live',
      configured: true,
      detail: `Endpoint svarade ${response.status}: ${text.slice(0, 140)}`,
      endpoint,
      responseCode: response.status,
      activation: 'OPTIONAL',
    });
  }

  return buildCheck({
    key: 'market_intel',
    label: 'Market intel endpoint',
    category: 'Workflow',
    status: 'healthy',
    mode: 'live',
    configured: true,
    detail: 'Livecheck OK.',
    endpoint,
    responseCode: response.status,
    activation: 'OPTIONAL',
  });
}

function probePermitAuthority(): ExternalHealthCheck {
  const endpoint = String(process.env.AUTHORITY_SUBMIT_ENDPOINT || '').trim();
  const apiKey = String(process.env.AUTHORITY_API_KEY || '').trim();
  if (!endpoint) {
    return buildCheck({
      key: 'permit_authority',
      label: 'Permit authority submit',
      category: 'Workflow',
      status: 'not_configured',
      mode: 'config',
      configured: false,
      detail:
        'AUTHORITY_SUBMIT_ENDPOINT saknas. Permit-submit ar blockerad tills riktig endpoint ar konfigurerad.',
      activation: 'OPTIONAL',
    });
  }

  return buildCheck({
    key: 'permit_authority',
    label: 'Permit authority submit',
    category: 'Workflow',
    status: 'degraded',
    mode: 'config',
    configured: true,
    detail: apiKey
      ? 'Endpoint och API-nyckel finns, men ingen generell liveprobe goras mot myndighetssystem.'
      : 'Endpoint finns men AUTHORITY_API_KEY saknas eller ar tom.',
    endpoint,
    activation: 'OPTIONAL',
  });
}

function probeConfigOnlyIntegration(input: {
  key: string;
  label: string;
  category: string;
  endpointEnv?: string;
  keyEnv?: string;
  notConfiguredDetail: string;
  configuredDetail: string;
}): ExternalHealthCheck {
  const endpoint = input.endpointEnv ? String(process.env[input.endpointEnv] || '').trim() : '';
  const apiKey = input.keyEnv ? String(process.env[input.keyEnv] || '').trim() : '';
  const configured = Boolean(endpoint || apiKey);
  return buildCheck({
    key: input.key,
    label: input.label,
    category: input.category,
    status: configured ? 'degraded' : 'not_configured',
    mode: 'config',
    configured,
    detail: configured ? input.configuredDetail : input.notConfiguredDetail,
    endpoint: endpoint || null,
    activation: 'OPTIONAL',
  });
}

function probeDispatchProviders(): ExternalHealthCheck[] {
  const runtime = getDispatchProviderRuntimeStatus();

  const timocom = buildCheck({
    key: 'timocom',
    label: 'TIMOCOM',
    category: 'Transport',
    status: runtime.credentials.timocomConfigured ? 'degraded' : 'not_configured',
    mode: 'derived',
    configured: runtime.credentials.timocomConfigured,
    detail: runtime.credentials.timocomConfigured
      ? `Credential finns. Aktiv provider just nu: ${runtime.activeProvider}. Ingen liveprobe finns annu.`
      : 'TIMOCOM_API_KEY saknas.',
    activation: 'OPTIONAL',
  });

  const transEu = buildCheck({
    key: 'trans_eu',
    label: 'TRANS.EU',
    category: 'Transport',
    status: runtime.credentials.transEuConfigured ? 'degraded' : 'not_configured',
    mode: 'derived',
    configured: runtime.credentials.transEuConfigured,
    detail: runtime.credentials.transEuConfigured
      ? `Credential finns. Aktiv provider just nu: ${runtime.activeProvider}. Ingen liveprobe finns annu.`
      : 'TRANS_EU_API_KEY saknas.',
    activation: 'OPTIONAL',
  });

  return [timocom, transEu];
}

export async function getExternalHealthReport(): Promise<ExternalHealthReport> {
  const checkedAt = nowIso();

  const specialCatalogKeys = new Set([
    'lantmateriet_licensed',
    'bankid',
    'slu',
    'kommun_kontakter_csv',
    'kommunala_diarier',
  ]);
  const openCatalogSources = SOURCE_CATALOG.filter(
    (source) => !specialCatalogKeys.has(String(source.implementationKey || '')),
  );
  const openResults = await fetchImmediateOpenSources();
  const openResultMap = new Map<string, OpenSourceProbe>(openResults.map((probe) => [probe.source, probe]));

  const checks: ExternalHealthCheck[] = openCatalogSources.map((source) =>
    mapOpenProbeToCheck(source, openResultMap.get(String(source.implementationKey || ''))),
  );

  const extraChecks = await Promise.all([
    probeVertexAi(),
    probeViss(),
    probeLantmaterietLicensed(),
    probeLantmaterietOpen(),
    probeSlu(),
    probeMarketIntel(),
  ]);

  checks.push(...extraChecks);
  checks.push(probeBankId());
  checks.push(probePermitAuthority());
  checks.push(...probeDispatchProviders());
  checks.push(
    probeConfigOnlyIntegration({
      key: 'eidas_qtsp',
      label: 'eIDAS QTSP',
      category: 'Dokument',
      endpointEnv: 'EIDAS_QTSP_ENDPOINT',
      keyEnv: 'EIDAS_QTSP_API_KEY',
      notConfiguredDetail: 'EIDAS_QTSP_ENDPOINT/EIDAS_QTSP_API_KEY saknas.',
      configuredDetail: 'QTSP-konfiguration finns, men ingen leverantorsspecifik liveprobe goras.',
    }),
    probeConfigOnlyIntegration({
      key: 'lims_api',
      label: 'LIMS API',
      category: 'Dokument',
      endpointEnv: 'LIMS_API_ENDPOINT',
      keyEnv: 'LIMS_API_KEY',
      notConfiguredDetail: 'LIMS_API_ENDPOINT saknas.',
      configuredDetail:
        'LIMS-endpoint finns, men ingen generell liveprobe goras eftersom kontraktet ar systemspecifikt.',
    }),
    probeConfigOnlyIntegration({
      key: 'ocr_api',
      label: 'OCR API',
      category: 'Dokument',
      keyEnv: 'OCR_API_KEY',
      notConfiguredDetail: 'OCR_API_KEY saknas.',
      configuredDetail: 'OCR-nyckel finns, men ingen neutral liveprobe ar definierad.',
    }),
  );

  return summarizeExternalHealthReport(checks, checkedAt);
}
