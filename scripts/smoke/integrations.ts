/**
 * scripts/smoke/integrations.ts
 *
 * Snabb funktionskontroll av externa integrationer. Rapporterar per tjänst:
 *   CONFIGURED  — alla nycklar/vars finns
 *   DEGRADED    — delvis konfigurerad eller endast mock-läge
 *   MISSING     — obligatoriska värden saknas
 *
 * Scriptet gör inga riktiga kedjeanrop till myndigheter — det är en
 * konfigurationsspegel + billig ping mot publika tjänster.
 */

import { loadEnvFile } from '../../server/loadEnv';
import { vertexConfigStatus } from '../../server/services/vertexAiService';

type Status = 'CONFIGURED' | 'DEGRADED' | 'MISSING';

interface IntegrationCheck {
  name: string;
  status: Status;
  detail: string;
}

function checkEnv(keys: string[]): { missing: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];
  for (const k of keys) {
    const v = process.env[k];
    if (!v || v === '') missing.push(k);
    else present.push(k);
  }
  return { missing, present };
}

async function pingUrl(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

async function runChecks(): Promise<IntegrationCheck[]> {
  const checks: IntegrationCheck[] = [];

  // Lantmäteriet
  {
    const keys = ['LANTMATERIET_CONSUMER_KEY', 'LANTMATERIET_CONSUMER_SECRET'];
    const altKeys = ['LANTMATERIET_ACCESS_TOKEN', 'LANTMATERIET_API_KEY'];
    const hasOAuth = checkEnv(keys).missing.length === 0;
    const hasAlt = altKeys.some((k) => process.env[k]);
    checks.push({
      name: 'lantmateriet',
      status: hasOAuth || hasAlt ? 'CONFIGURED' : 'MISSING',
      detail: hasOAuth ? 'OAuth2 konfigurerad' : hasAlt ? 'Statisk token/API-nyckel' : 'saknar credentials',
    });
  }

  // SGU (publikt API)
  {
    const ping = await pingUrl('https://resource.sgu.se/service/ogc/features/jordarter-25-100-tusen');
    checks.push({
      name: 'sgu',
      status: ping.ok ? 'CONFIGURED' : 'DEGRADED',
      detail: ping.ok ? `HTTP ${ping.status}` : 'ingen svar från publikt OGC API',
    });
  }

  // SMHI
  {
    const ping = await pingUrl('https://opendata-download-metfcst.smhi.se');
    checks.push({
      name: 'smhi',
      status: ping.ok ? 'CONFIGURED' : 'DEGRADED',
      detail: ping.ok ? `HTTP ${ping.status}` : 'ingen svar',
    });
  }

  // SLU Artdatabanken
  {
    const hasKey = !!process.env.SLU_API_KEY || !!process.env.SLU_SPECIES_OBS_API_KEY;
    checks.push({
      name: 'slu_artdatabanken',
      status: hasKey ? 'CONFIGURED' : 'MISSING',
      detail: hasKey ? 'API-nyckel satt' : 'SLU_API_KEY eller produktspecifik SLU_*_API_KEY saknas',
    });
  }

  // BankID
  {
    const pfx = !!process.env.BANKID_PFX_PATH || !!process.env.BANKID_CERT_PATH;
    const url = !!process.env.BANKID_BASE_URL;
    const mockMode = process.env.BANKID_MOCK_MODE === 'true';
    checks.push({
      name: 'bankid',
      status: pfx && url ? 'CONFIGURED' : mockMode ? 'DEGRADED' : 'MISSING',
      detail: pfx && url ? 'cert + base URL' : mockMode ? 'mock-läge' : 'ingen cert och inte mock',
    });
  }

  // eIDAS QTSP
  {
    const hasEndpoint = !!process.env.EIDAS_QTSP_ENDPOINT;
    const hasKey = !!process.env.EIDAS_QTSP_API_KEY;
    checks.push({
      name: 'eidas_qtsp',
      status: hasEndpoint && hasKey ? 'CONFIGURED' : hasEndpoint ? 'DEGRADED' : 'MISSING',
      detail: hasEndpoint && hasKey ? 'full QTSP' : hasEndpoint ? 'endpoint utan nyckel' : 'saknas',
    });
  }

  // LIMS
  {
    const hasApi = !!process.env.LIMS_API_ENDPOINT;
    const hasSftp = !!process.env.LIMS_SFTP_HOST && !!process.env.LIMS_SFTP_PATH;
    checks.push({
      name: 'lims',
      status: hasApi ? 'CONFIGURED' : hasSftp ? 'CONFIGURED' : 'MISSING',
      detail: hasApi ? 'HTTP API' : hasSftp ? 'SFTP' : 'ingen hämtningsväg',
    });
  }

  // Outlook (Graph)
  {
    const graphKeys = [
      'OUTLOOK_GRAPH_TENANT_ID',
      'OUTLOOK_GRAPH_CLIENT_ID',
      'OUTLOOK_GRAPH_CLIENT_SECRET',
      'OUTLOOK_GRAPH_USER',
    ];
    const missing = checkEnv(graphKeys).missing;
    const hasFolder = !!process.env.OUTLOOK_FOLDER_PATH;
    checks.push({
      name: 'outlook',
      status: missing.length === 0 ? 'CONFIGURED' : hasFolder ? 'DEGRADED' : 'MISSING',
      detail:
        missing.length === 0
          ? 'Microsoft Graph konfigurerad'
          : hasFolder
            ? `filsystem-mapp satt men Graph saknar: ${missing.join(', ')}`
            : `saknar: ${missing.join(', ')}`,
    });
  }

  // Myndighetsinlämning
  {
    const hasEndpoint = !!process.env.AUTHORITY_SUBMIT_ENDPOINT;
    const mock = (process.env.AUTHORITY_MOCK_MODE ?? '').toLowerCase() === 'true';
    checks.push({
      name: 'authority_submit',
      status: hasEndpoint ? 'CONFIGURED' : mock ? 'DEGRADED' : 'MISSING',
      detail: hasEndpoint ? 'live endpoint' : mock ? 'mock-läge (testbar)' : 'ingen endpoint',
    });
  }

  // Domstolarnas RSS (publik)
  {
    const ping = await pingUrl('https://www.domstol.se/feed/15972/?scope=decision&searchPageId=15972');
    const enabled = process.env.DOMSTOL_RSS_ENABLED !== 'false';
    checks.push({
      name: 'domstol_rss',
      status: ping.ok && enabled ? 'CONFIGURED' : ping.ok ? 'DEGRADED' : 'MISSING',
      detail: ping.ok
        ? enabled
          ? `HTTP ${ping.status}, scheduler aktiverad`
          : `HTTP ${ping.status}, men DOMSTOL_RSS_ENABLED=false`
        : 'ingen svar',
    });
  }

  // Vertex AI (enda AI-leverantör)
  {
    const status = vertexConfigStatus();
    const authNote = status.hasExplicitServiceAccountFile
      ? 'service account via env'
      : 'förlitar sig på ADC (gcloud) eller molnets workload identity';
    checks.push({
      name: 'vertex_ai',
      status: status.configured ? 'CONFIGURED' : 'MISSING',
      detail: status.configured
        ? `projekt=${status.projectId} location=${status.location} (${authNote})`
        : `saknar: ${status.missing.join(', ')}`,
    });
  }

  return checks;
}

async function main(): Promise<void> {
  loadEnvFile('.env');
  loadEnvFile('.env.local');
  console.log('Integrations smoketest');
  console.log('─'.repeat(80));
  const checks = await runChecks();
  for (const c of checks) {
    const glyph = c.status === 'CONFIGURED' ? '[OK]' : c.status === 'DEGRADED' ? '[WARN]' : '[MISS]';
    console.log(`${glyph} ${c.name.padEnd(24)} ${c.status.padEnd(12)} ${c.detail}`);
  }
  const missing = checks.filter((c) => c.status === 'MISSING').length;
  console.log('─'.repeat(80));
  console.log(`${checks.length} integrationer kontrollerade. Missing=${missing}`);
  if (process.env.SMOKE_JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.SMOKE_JSON_OUT, JSON.stringify(checks, null, 2));
    console.log(`JSON-rapport skriven: ${process.env.SMOKE_JSON_OUT}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoketest error:', err);
  process.exit(1);
});
