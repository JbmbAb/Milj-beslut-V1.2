import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/createApp';

const app = createApp();

export async function loginAsAdmin(): Promise<string> {
  const loginRes = await request(app)
    .post('/api/admin/auth/login')
    .send({
      username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
      password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
    });

  if (loginRes.status !== 200 || !loginRes.body.accessToken) {
    throw new Error(`Admin login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }

  return String(loginRes.body.accessToken);
}

export function authRequest(token: string) {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  };
}

export function masterArchiveFixtureRoot(): string {
  return path.resolve(process.cwd(), 'tests/fixtures/master-archive');
}

export function documentsFixtureRoot(): string {
  return path.resolve(process.cwd(), 'tests/fixtures/documents');
}
