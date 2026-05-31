/**
 * Supertest-baserade integrationstester använder inte full cookie/CSRF-kedja som en webbläsare.
 * E2E (Playwright) täcker muterande anrop med riktig CSRF.
 */
import { vi } from 'vitest';

// Integration globalSetup kräver PostgreSQL – aktivera DB-tester som standard (CI sätter explicit).
if (!process.env.DATABASE_INTEGRATION) {
  process.env.DATABASE_INTEGRATION = 'true';
}

if (!process.env.VERTEX_PROJECT_ID) process.env.VERTEX_PROJECT_ID = 'miljobeslut-test';
if (!process.env.VERTEX_LOCATION) process.env.VERTEX_LOCATION = 'europe-west1';

vi.mock('../../server/security/csrf', () => ({
  csrfProtection: (_req: unknown, res: { locals: { csrfToken?: string } }, next: () => void) => {
    res.locals.csrfToken = 'integration-test-csrf-token';
    next();
  },
}));
