/**
 * Smoke: POST /api/property/lookup mot ORSA STACKMORA 3:12 (+ delar).
 * Kräver .env med DATABASE_URL och admin-credentials.
 */
import request from 'supertest';
import { loadEnvFile } from '../../server/loadEnv';
import { createApp } from '../../server/createApp';

loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });
process.env.PROPERTY_LOOKUP_MODE = 'postgis';

const app = createApp();

const CASES = [
  'ORSA STACKMORA 3:12',
  'ORSA STACKMORA 3:12>1',
  'ORSA STACKMORA 3:12>2',
  'ORSA STACKMORA 3:12>3',
  'ORSA STACKMORA 3:12 (2)',
] as const;

async function obtainCsrf(agent: request.Agent): Promise<string> {
  const res = await agent.get('/api/csrf-token');
  if (res.status !== 200 || !res.body?.csrfToken) {
    throw new Error(`csrf-token failed: ${res.status}`);
  }
  return String(res.body.csrfToken);
}

async function main() {
  const agent = request.agent(app);
  const csrf = await obtainCsrf(agent);

  const loginRes = await agent
    .post('/api/admin/auth/login')
    .set('x-csrf-token', csrf)
    .send({
      username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
      password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
    });

  if (loginRes.status !== 200) {
    console.error('Login failed', loginRes.status, loginRes.body);
    process.exit(1);
  }

  const token = String(loginRes.body.accessToken || '');
  const csrf2 = await obtainCsrf(agent);
  const projectRes = await agent
    .post('/api/admin/projects')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrf2)
    .send({ propertyDesignation: 'ORSA STACKMORA 3:12' });

  if (projectRes.status !== 200) {
    console.error('Create project failed', projectRes.status, projectRes.body);
    process.exit(1);
  }

  const projectId = String(projectRes.body?.project?.id || '');
  console.log(`projectId=${projectId}\n`);

  let failed = 0;
  for (const designation of CASES) {
    const csrfN = await obtainCsrf(agent);
    const res = await agent
      .post('/api/property/lookup')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrfN)
      .send({ projectId, propertyDesignation: designation, purpose: 'orsa-api-smoke' });

    const geom = res.body?.result?.geometry;
    const coords =
      geom?.type === 'Polygon' || geom?.type === 'MultiPolygon'
        ? JSON.stringify(geom.coordinates).slice(0, 80) + '…'
        : geom?.type ?? 'none';

    const ok = res.status === 200 && res.body?.ok === true && geom;
    if (!ok) failed += 1;

    console.log(
      [
        ok ? 'OK' : 'FAIL',
        designation.padEnd(28),
        `status=${res.status}`,
        `source=${res.body?.source ?? '-'}`,
        `match=${res.body?.result?.matchType ?? '-'}`,
        `designation=${res.body?.result?.designation ?? res.body?.error ?? '-'}`,
        `geom=${coords}`,
      ].join(' | '),
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
