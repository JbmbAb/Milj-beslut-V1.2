/**
 * Supertest-baserade integrationstester använder inte full cookie/CSRF-kedja som en webbläsare.
 * E2E (Playwright) täcker muterande anrop med riktig CSRF.
 */
import { vi } from 'vitest';

vi.mock('../../server/security/csrf', () => ({
  csrfProtection: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
