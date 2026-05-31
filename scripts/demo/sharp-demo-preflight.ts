/**
 * sharp-demo-preflight.ts
 *
 * Verifierar att lokal eller staging-miljö är redo för skarp demo (P3):
 * admin-inloggning utan BankID, tre fokusmoduler, inga demo-flaggor.
 *
 * Kör: npx tsx scripts/demo/sharp-demo-preflight.ts
 * Eller: npm run demo:preflight
 * Endast env (ingen körande server): npm run demo:preflight -- --env-only
 */

import { loadEnvFile } from '../../server/loadEnv';

loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

const envOnly = process.argv.includes('--env-only');

type StepResult = { step: string; ok: boolean; detail: string };

const results: StepResult[] = [];

function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
}

function env(key: string): string {
  return String(process.env[key] ?? '').trim();
}

function isTrue(key: string): boolean {
  return ['true', '1', 'yes'].includes(env(key).toLowerCase());
}

async function pingHealth(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} från ${url}` };
    const body = (await res.json()) as { ok?: boolean; liveness?: string };
    if (body.ok !== true || body.liveness !== 'up') {
      return { ok: false, detail: `Oväntat svar från ${url}: ${JSON.stringify(body)}` };
    }
    return { ok: true, detail: url };
  } catch (err) {
    return { ok: false, detail: `Kunde inte nå ${url}: ${String(err)}` };
  }
}

function resolveApiBase(): string {
  const explicit =
    env('PLAYWRIGHT_API_BASE_URL') ||
    env('STAGING_API_BASE_URL');
  if (explicit) return explicit;

  const stagingUrl = env('STAGING_URL');
  // STAGING_URL pekar ofta på Vite (3000/3200) — health ligger på backend-porten.
  if (stagingUrl && !/localhost:3000|127\.0\.0\.1:3000|localhost:3200|127\.0\.0\.1:3200/i.test(stagingUrl)) {
    return stagingUrl;
  }

  return `http://127.0.0.1:${env('PLAYWRIGHT_LOCAL_API_PORT') || '8787'}`;
}

async function main() {
  const apiBase = resolveApiBase();

  // ── 1. Obligatoriska env ─────────────────────────────────────────────────
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ADMIN_CONSOLE_PASSWORD',
    'LANTMATERIET_BASE_URL',
    'SLU_API_BASE_URL',
    'SLU_API_KEY',
  ] as const;

  for (const key of required) {
    record(`env:${key}`, Boolean(env(key)), env(key) ? 'satt' : 'saknas');
  }

  const hasLmAuth = Boolean(
    (env('LANTMATERIET_CONSUMER_KEY') && env('LANTMATERIET_CONSUMER_SECRET')) ||
      env('LANTMATERIET_ACCESS_TOKEN') ||
      env('LANTMATERIET_API_KEY') ||
      env('LANTMATERIET_OPEN_SUBSCRIPTION_KEY') ||
      isTrue('LANTMATERIET_OPEN_MODE'),
  );
  record('env:LANTMATERIET_AUTH', hasLmAuth, hasLmAuth ? 'konfigurerad' : 'saknar nycklar');

  const hasVertex = Boolean(env('VERTEX_PROJECT_ID') && env('VERTEX_LOCATION'));
  record('env:VERTEX_AI', hasVertex, hasVertex ? env('VERTEX_PROJECT_ID') : 'VERTEX_PROJECT_ID saknas');

  // ── 2. Demo-flaggor ──────────────────────────────────────────────────────
  record('flag:LANTMATERIET_DEMO_MODE', !isTrue('LANTMATERIET_DEMO_MODE'), isTrue('LANTMATERIET_DEMO_MODE') ? 'AKTIV — stäng av' : 'av');
  record('flag:AUTHORITY_MOCK_MODE', !isTrue('AUTHORITY_MOCK_MODE'), isTrue('AUTHORITY_MOCK_MODE') ? 'AKTIV — stäng av i demo' : 'av');

  const bankIdOk = isTrue('BANKID_MOCK_MODE') || isTrue('STAGING_VERIFY_ALLOW_BANKID_PENDING') || Boolean(env('BANKID_PFX_PATH') || env('BANKID_PFX_CONTENT'));
  record(
    'flag:BANKID',
    bankIdOk,
    isTrue('BANKID_MOCK_MODE')
      ? 'mock (OK för lokal demo, ej skarp staging)'
      : bankIdOk
        ? 'cert eller pending-flagga'
        : 'saknar cert — använd admin-inloggning',
  );

  // ── 3. Backend health ──────────────────────────────────────────────────────
  if (!envOnly) {
    const health = await pingHealth(apiBase);
    record('api:/health', health.ok, health.detail);

    if (health.ok) {
      const readyUrl = `${apiBase.replace(/\/$/, '')}/ready`;
      try {
        const res = await fetch(readyUrl, { signal: AbortSignal.timeout(12000) });
        const body = (await res.json()) as { ok?: boolean; database?: string };
        record('api:/ready', res.ok && body.database === 'ok', `${readyUrl} → db=${body.database ?? '?'}`);
      } catch (err) {
        record('api:/ready', false, String(err));
      }
    }
  } else {
    record('api:/health', true, 'hoppad över (--env-only)');
  }

  // ── Rapport ────────────────────────────────────────────────────────────────
  const width = 62;
  console.log('\n' + '─'.repeat(width));
  console.log('  Skarp demo — preflight');
  console.log('─'.repeat(width));
  console.log(`  API-bas: ${apiBase}`);

  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.step.padEnd(28)} ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('─'.repeat(width));
  if (failed.length > 0) {
    console.log(`  ${failed.length} blockerande punkt(er). Se docs/deploy/ENV_CHECKLIST.md.`);
    console.log('─'.repeat(width) + '\n');
    process.exit(1);
  }

  console.log('  Alla preflight-kontroller OK. Kör staging E2E mot denna bas.');
  console.log('─'.repeat(width) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
