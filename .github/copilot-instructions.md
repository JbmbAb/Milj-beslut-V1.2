# GitHub Copilot – Testgenererings-riktlinjer för Milj-beslut-V1.2

## Teknisk stack
- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Express 5, Prisma ORM
- **Databas**: PostgreSQL 16 + PostGIS + pgvector
- **AI**: Google Gemini, OpenAI
- **Testramverk**: Vitest (unit/integration), Playwright (E2E)

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
npm run test:components    # Komponenttester (jsdom)
npm run test:integration   # Integrationstester (kräver DB)
npm run test:e2e           # E2E-tester (kräver server)
npm run test               # Alla tester
```

---

## Kodkonventioner
- Alla typer i `types.ts` (root) – **inga inline interface-definitioner** om typen redan finns
- `DecisionType` är ett TypeScript **enum** (inte string union)
- `Permit.id` är **string** (inte number)
- Backend-routes i `server/secureApi.express.ts`
- Följ befintliga testmönster i `tests/unit/` innan du skapar nya
