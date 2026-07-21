/**
 * scripts/smoke/staging-verify.ts
 *
 * Verifierar att staging-miljön är korrekt konfigurerad för att köra
 * Lokaliseringsutredning, C-anmälan och Enskilt avlopp med äkta data.
 *
 * Kontrollerar:
 *   1. Inga mock/demo-flaggor är aktiva
 *   2. Kritiska nycklar finns
 *   3. Staging-URL är satt
 *   4. BankID är konfigurerat med riktiga certifikat (ej mock)
 *
 * Kör: npx tsx scripts/smoke/staging-verify.ts
 * Eller: npm run smoke:staging-verify
 */

import { loadEnvFile } from '../../server/loadEnv';

loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

type CheckResult = {
  check: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
};

const results: CheckResult[] = [];

function env(key: string): string {
  return (process.env[key] ?? '').trim();
}

function isTrue(key: string): boolean {
  return ['true', '1', 'yes'].includes(env(key).toLowerCase());
}

function pass(check: string, detail: string) {
  results.push({ check, status: 'OK', detail });
}

function warn(check: string, detail: string) {
  results.push({ check, status: 'WARN', detail });
}

function fail(check: string, detail: string) {
  results.push({ check, status: 'FAIL', detail });
}

const allowBankIdPending = isTrue('STAGING_VERIFY_ALLOW_BANKID_PENDING');

// ── 1. Mock-flaggor ─────────────────────────────────────────────────────────

if (isTrue('BANKID_MOCK_MODE')) {
  if (allowBankIdPending) {
    warn(
      'BANKID_MOCK_MODE',
      'Är true men STAGING_VERIFY_ALLOW_BANKID_PENDING=true – tillfälligt tillåtet tills avtal/cert är klart',
    );
  } else {
    fail('BANKID_MOCK_MODE', 'Är true – måste vara false i staging för äkta BankID');
  }
} else {
  pass('BANKID_MOCK_MODE', 'false – OK');
}

if (isTrue('AUTHORITY_MOCK_MODE')) {
  fail('AUTHORITY_MOCK_MODE', 'Är true – måste vara false i staging');
} else {
  pass('AUTHORITY_MOCK_MODE', 'false – OK');
}

if (env('DISPATCH_PROVIDER_MODE') === 'MOCK_FRAKTBORS') {
  warn(
    'DISPATCH_PROVIDER_MODE',
    'MOCK_FRAKTBORS – OK för utredning, men inte om transportdispatch är i scope',
  );
} else {
  pass('DISPATCH_PROVIDER_MODE', env('DISPATCH_PROVIDER_MODE') || '(ej satt)');
}

if (isTrue('LANTMATERIET_OPEN_MODE')) {
  warn(
    'LANTMATERIET_OPEN_MODE',
    'true – öppet läge utan autentisering, fastighetsuppslag kan vara begränsat',
  );
} else {
  pass('LANTMATERIET_OPEN_MODE', 'false – autentiserat läge');
}

if (isTrue('LANTMATERIET_DEMO_MODE')) {
  fail('LANTMATERIET_DEMO_MODE', 'true – demo-läget returnerar falsk geometri, inte äkta data');
} else {
  pass('LANTMATERIET_DEMO_MODE', 'false – OK');
}

// ── 2. Kritiska nycklar ──────────────────────────────────────────────────────

const requiredKeys: Array<{ key: string; label: string; allowEmpty?: boolean }> = [
  { key: 'JWT_ACCESS_SECRET', label: 'JWT Access Secret' },
  { key: 'JWT_REFRESH_SECRET', label: 'JWT Refresh Secret' },
  { key: 'ADMIN_CONSOLE_PASSWORD', label: 'Admin lösenord' },
  { key: 'DATABASE_URL', label: 'Databas-URL' },
];

for (const { key, label } of requiredKeys) {
  const value = env(key);
  if (!value) {
    fail(key, `${label} saknas`);
  } else if (value.includes('dev-') || value === 'admin' || value === 'admin123') {
    warn(key, `${label} verkar vara ett dev-värde – byt till staging-specifikt`);
  } else {
    pass(key, `${label} är satt`);
  }
}

// ── 3. Lantmäteriet ──────────────────────────────────────────────────────────

const hasLmOAuth = env('LANTMATERIET_CONSUMER_KEY') && env('LANTMATERIET_CONSUMER_SECRET');
const hasLmToken = env('LANTMATERIET_ACCESS_TOKEN') || env('LANTMATERIET_API_KEY');
const hasLmOpenSubscription = Boolean(env('LANTMATERIET_OPEN_SUBSCRIPTION_KEY'));

if (hasLmOAuth) {
  pass('LANTMATERIET_AUTH', 'OAuth2 consumer key + secret satt');
} else if (hasLmOpenSubscription) {
  pass('LANTMATERIET_AUTH', 'Öppen prenumerationsnyckel (LANTMATERIET_OPEN_SUBSCRIPTION_KEY) satt');
} else if (hasLmToken) {
  warn('LANTMATERIET_AUTH', 'Statisk token/API-nyckel – fungerar men OAuth2 rekommenderas');
} else if (isTrue('LANTMATERIET_OPEN_MODE')) {
  warn('LANTMATERIET_AUTH', 'Öppet läge utan credentials – begränsad åtkomst');
} else {
  fail('LANTMATERIET_AUTH', 'Ingen Lantmäteriet-autentisering konfigurerad');
}

// ── 4. SLU ────────────────────────────────────────────────────────────────────

const hasSlu =
  env('SLU_API_KEY') ||
  env('SLU_SPECIES_OBS_API_KEY') ||
  env('SLU_TAXONOMY_API_KEY') ||
  env('SLU_ARTFAKTA_API_KEY') ||
  env('SLU_METODKATALOG_API_KEY');

if (hasSlu) {
  pass('SLU_API_KEY', 'Minst en SLU-nyckel satt');
} else {
  fail('SLU_API_KEY', 'Ingen SLU-nyckel satt – använd SLU_API_KEY eller produktspecifik SLU_*_API_KEY');
}

// ── 5. BankID ─────────────────────────────────────────────────────────────────

const hasBankIdCert = env('BANKID_PFX_PATH') || env('BANKID_PFX_CONTENT') || env('BANKID_CERT_PATH');
const hasBankIdUrl = env('BANKID_BASE_URL');

if (!isTrue('BANKID_MOCK_MODE') && hasBankIdCert && hasBankIdUrl) {
  pass('BANKID_CERT', 'Certifikat + URL konfigurerat');
} else if (!isTrue('BANKID_MOCK_MODE') && !hasBankIdCert) {
  if (allowBankIdPending) {
    warn(
      'BANKID_CERT',
      'BANKID_MOCK_MODE=false men cert saknas; STAGING_VERIFY_ALLOW_BANKID_PENDING=true är aktiv',
    );
  } else {
    fail('BANKID_CERT', 'BANKID_MOCK_MODE=false men inget certifikat är konfigurerat');
  }
}

// ── 6. AI-modeller ────────────────────────────────────────────────────────────

const hasVertexProject = Boolean(env('VERTEX_PROJECT_ID'));
const hasVertexLocation = Boolean(env('VERTEX_LOCATION'));
const hasVertexAdc =
  Boolean(env('GOOGLE_APPLICATION_CREDENTIALS')) || Boolean(env('GOOGLE_APPLICATION_CREDENTIALS_JSON'));

if (hasVertexProject && hasVertexLocation) {
  pass(
    'VERTEX_AI',
    `Project ${env('VERTEX_PROJECT_ID')} @ ${env('VERTEX_LOCATION')}${hasVertexAdc ? '' : ' (förväntar ADC/workload identity i moln)'}`,
  );
} else if (env('GEMINI_API_KEY')) {
  warn('VERTEX_AI', 'GEMINI_API_KEY satt men VERTEX_PROJECT_ID saknas – Vertex används inte i prod');
} else {
  fail('VERTEX_AI', 'VERTEX_PROJECT_ID + VERTEX_LOCATION krävs (GEMINI_API_KEY räcker inte längre)');
}

// ── 7. CORS ───────────────────────────────────────────────────────────────────

const cors = env('CORS_ALLOW_ORIGINS');
if (cors.includes('localhost')) {
  warn('CORS_ALLOW_ORIGINS', `Innehåller localhost: ${cors} – OK för local, inte för staging`);
} else if (cors) {
  pass('CORS_ALLOW_ORIGINS', cors);
} else {
  warn('CORS_ALLOW_ORIGINS', 'Ej satt');
}

// ── Rapport ───────────────────────────────────────────────────────────────────

const width = 60;
console.log('\n' + '─'.repeat(width));
console.log('  Staging Verify – Miljöbeslut');
console.log('─'.repeat(width));

for (const r of results) {
  const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
  console.log(`  ${icon} [${r.status.padEnd(4)}] ${r.check}`);
  console.log(`           ${r.detail}`);
}

console.log('─'.repeat(width));

const fails = results.filter((r) => r.status === 'FAIL');
const warns = results.filter((r) => r.status === 'WARN');
const oks = results.filter((r) => r.status === 'OK');

console.log(`  Resultat: ${oks.length} OK  ${warns.length} WARN  ${fails.length} FAIL`);

if (fails.length > 0) {
  console.log('\n  ✗ STAGING EJ REDO – åtgärda FAIL-punkterna ovan innan körning.');
  console.log('─'.repeat(width) + '\n');
  process.exit(1);
} else if (warns.length > 0) {
  console.log('\n  ⚠ STAGING DELVIS REDO – granska WARN-punkterna.');
  console.log('─'.repeat(width) + '\n');
  process.exit(0);
} else {
  console.log('\n  ✓ STAGING REDO – alla kontroller passerade.');
  console.log('─'.repeat(width) + '\n');
  process.exit(0);
}
