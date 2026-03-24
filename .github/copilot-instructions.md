# GitHub Copilot – Testgenererings-riktlinjer för Milj-beslut-V1.2

## Teknisk stack
- **Frontend**: React 19, TypeScript, Vite + TailwindCSS
- **Backend**: Express 5, Prisma ORM
- **Databas**: PostgreSQL 16 + PostGIS + pgvector
- **AI**: Google Gemini, OpenAI
- **Testramverk**: Vitest (unit/integration), Playwright (E2E)

---

## App-garanti (Readiness)

Appen garanteras fungera när `GET /api/health` (ingen autentisering krävs) returnerar `ok: true` med 3-nivå readiness-matris:

| Tier | Vad täcks |
|------|-----------|
| 1 | Kodkvalitet – alltid redo (TS, lint, bygg) |
| 2 | Databas + JWT – kräver körande PostgreSQL + `JWT_SECRET` |
| 3 | Externa API:er – Lantmäteriet, BankID, AI (demo-läge aktiveras automatiskt om credentials saknas) |

`AppReadinessPanel` i admin-konsolen (flik `admin-readiness`) visualiserar denna matris i realtid.

---

## Teststruktur

```
tests/
  unit/          # Vitest – Node-miljö, inga DB-anrop
  integration/   # Vitest – kräver live PostgreSQL (DATABASE_URL)
  components/    # Vitest – jsdom + @testing-library/react
  e2e/           # Playwright – kräver körande server
  setup/
    env.ts       # Node-testkonfiguration
    react.ts     # jsdom + @testing-library/jest-dom
```

---

## Test Guidelines

### Unit-tester (`tests/unit/**/*.test.ts`)
- Använd **Vitest** (`describe`, `it`, `expect`, `vi`)
- Mocka Prisma-klienten med `vi.mock('@/server/db/prisma')`
- Mocka externa API-anrop med `vi.spyOn` eller `vi.mock`
- Inga riktiga DB-anrop – all state via mocks
- Namnkonvention: `<modulnamn>.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myService } from '@/server/services/myService';

vi.mock('@/server/db/prisma', () => ({
  default: { modelName: { findMany: vi.fn(), create: vi.fn() } },
}));

describe('myService', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should return expected result', async () => {
    // arrange, act, assert
  });
});
```

### Komponenttester (`tests/components/**/*.test.tsx`)
- Använd **@testing-library/react** + **@testing-library/user-event**
- Mocka `fetch` med `vi.stubGlobal('fetch', vi.fn())`
- Mocka `FileReader` med `vi.stubGlobal('FileReader', MockFileReader)`
- Använd `screen.getByRole`, `screen.getByText` (föredra semantiska queries)
- Namnkonvention: `<KomponentNamn>.test.tsx` (camelCase → lowerCamelCase för fil)

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyComponent from '@/components/MyComponent';

describe('MyComponent', () => {
  it('renders heading', () => {
    render(<MyComponent />);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });
});
```

### Integrationstester (`tests/integration/**/*.test.ts`)
- Kräver live PostgreSQL (`DATABASE_URL` i env)
- Kör migrationer och seed innan tester
- Rensa upp testdata i `afterEach`/`afterAll`

### E2E-tester (`tests/e2e/**/*.spec.ts`)
- Använd **Playwright** med `@playwright/test`
- Testa kritiska användarflöden (inloggning, sökning, uppladdning)
- Använd `page.getByRole`, `page.getByLabel` (tillgänglighetsbaserade selektorer)

---

## Mockning av Prisma

```typescript
// Standard Prisma-mock-mönster
vi.mock('@/server/db/prisma', () => ({
  default: {
    documentRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'test-id' }),
      update: vi.fn().mockResolvedValue({ id: 'test-id' }),
      delete: vi.fn().mockResolvedValue({ id: 'test-id' }),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));
```

### Komplett unit-test-mall med Prisma

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  default: {
    tableName: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import prisma from '../../server/db/prisma';
import { serviceFunction } from '../../server/services/serviceName';

describe('serviceName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('serviceFunction', () => {
    it('returns expected result on success', async () => {
      vi.mocked(prisma.tableName.findUnique).mockResolvedValue({ id: '1', name: 'Test' });
      const result = await serviceFunction('1');
      expect(result).toEqual({ id: '1', name: 'Test' });
    });

    it('throws error when not found', async () => {
      vi.mocked(prisma.tableName.findUnique).mockResolvedValue(null);
      await expect(serviceFunction('invalid')).rejects.toThrow();
    });

    it('handles database errors', async () => {
      vi.mocked(prisma.tableName.findUnique).mockRejectedValue(new Error('DB error'));
      await expect(serviceFunction('1')).rejects.toThrow('DB error');
    });
  });
});
```

---

## Täckningskrav

| Metrik     | Tröskel |
|------------|---------|
| Lines      | 70%     |
| Branches   | 60%     |
| Functions  | 70%     |
| Statements | 70%     |

Kör `npm run test:unit` för att se coverage-rapport.

---

## Kommandon

```bash
npm run test:unit          # Unit-tester med coverage
npm run test:integration   # Integrationstester (kräver DB)
npm run test:e2e           # E2E-tester (kräver server)
npm run test               # Unit + integration
npm run qa                 # typecheck + lint + format:check + test
npm run qa:full            # qa + build + test:e2e
```

VS Code tasks (`.vscode/tasks.json`):
- **Ctrl+Shift+P → "Tasks: Run Task"** för att välja task
- Kopiera `.vscode/keybindings.example.json` till din user keybindings.json för snabbkommandon

---

## Prioriterade testfiler (i ordning)

### Batch 1: Säkerhet (kritisk)
1. `server/security/rateLimit.ts`
2. `server/security/rateLimitDb.ts`
3. `server/security/auditTrail.ts`
4. `server/security/auditSanitization.ts`
5. `server/security/projectAccess.ts`

### Batch 2: Kärntjänster
6. `server/services/documentGenerator.ts`
7. `server/services/completionService.ts`
8. `server/services/knowledgeGraphService.ts`
9. `server/services/gdprComplianceService.ts`
10. `server/services/bankIdService.ts`

### Batch 3: Externa integrationer (mocka alla API:er)
11. `server/services/lantmaterietService.ts`
12. `server/services/limsService.ts`
13. `server/services/externalHealthService.ts`
14. `server/datasources/` (alla filer)

### Batch 4: Repositories
15. `server/repositories/` (alla filer)

---

## Kodkonventioner
- Alla typer i `types.ts` (root) – **inga inline interface-definitioner** om typen redan finns
- `DecisionType` är ett TypeScript **enum** (inte string union)
- `Permit.id` är **string** (inte number)
- Backend-routes i `server/secureApi.express.ts`
- Följ befintliga testmönster i `tests/unit/` innan du skapar nya
- Fel: använd `AppError` från `server/security/secureErrors.ts`
- Svensk kontext: koordinatsystem SWEREF99 TM (EPSG:3006), testdata med å/ä/ö

## Gör INTE
- Skapa platshållartester med `test.todo()`
- Hoppa över felhanteringstester
- Använd `any`-typ i testfiler
- Anropa riktiga externa API:er i tester
- Committa tester som inte passerar
