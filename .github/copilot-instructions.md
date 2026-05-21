# Copilot Instructions for Miljöbeslut V2.0

## Project Overview

Swedish environmental decision support system:

- **Framework**: Vite 5 + Express API (`server/`)
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`) + design tokens in `src/index.css` / `components/admin/admin-tokens.css`
- **Data fetching**: TanStack Query v5 + `services/apiClient.ts` / `services/coreApiClient.ts`
- **Database**: PostgreSQL 16 with PostGIS, pgvector + Prisma ORM (server-side only)
- **AI**: Google Vertex AI (Gemini) via `server/services/vertexAiService.ts`
- **Testing**: Vitest (unit/integration), Playwright (E2E)

## Architecture Rules

- **Never import `server/**` from React components.** Use `/api/*` endpoints and client services in `services/`.
- **Never use Prisma in frontend code.** Database access belongs in `server/routes` and `server/services`.
- **Single QueryClientProvider** at app root (`src/main.tsx` via `src/queryClient.ts`). Do not nest additional providers.
- Shared frontend types live in `src/types/` — not in `server/services/`.

## Test Generation Rules

### When asked for tests:

1. Use Vitest with `describe`, `it`, `expect`, `vi.mock`, `beforeEach`
2. Place unit tests in `tests/unit/{filename}.test.ts`
3. Mock Prisma client for all database calls
4. Mock external APIs (Lantmäteriet, SLU, SMHI) - never call real endpoints
5. Test edge cases: null, undefined, empty arrays, invalid input
6. Include Swedish characters in test data (å, ä, ö)
7. Test async error handling with `rejects.toThrow()`

### Coverage Targets

- Lines: 75%
- Branches: 60%
- Functions: 75%
- Focus areas: `server/services/`, `server/security/`, `server/repositories/`

### File Naming Patterns

- Service `fooService.ts` → test `tests/unit/fooService.test.ts`
- Route `fooRoutes.ts` → test `tests/unit/fooRoutes.test.ts`
- Repository `fooRepository.ts` → test `tests/unit/fooRepository.test.ts`

## Test Templates

### Unit Test with Prisma Mock

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    modelName: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from '../../server/db/prisma';
import { functionToTest } from '../../server/services/serviceName';

describe('serviceName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('functionToTest', () => {
    it('returns expected result on success', async () => {
      vi.mocked(prisma.modelName.findUnique).mockResolvedValue({ id: '1' });
      const result = await functionToTest('1');
      expect(result).toEqual({ id: '1' });
    });

    it('throws error when not found', async () => {
      vi.mocked(prisma.modelName.findUnique).mockResolvedValue(null);
      await expect(functionToTest('invalid')).rejects.toThrow();
    });

    it('handles database errors', async () => {
      vi.mocked(prisma.modelName.findUnique).mockRejectedValue(new Error('DB error'));
      await expect(functionToTest('1')).rejects.toThrow('DB error');
    });
  });
});
```

### External API Mock

```typescript
vi.mock('../../server/services/lantmaterietService', () => ({
  fetchPropertyData: vi.fn(),
}));

import { fetchPropertyData } from '../../server/services/lantmaterietService';

it('handles external API response', async () => {
  vi.mocked(fetchPropertyData).mockResolvedValue({ designation: 'GÄVLE 1:1' });
  // test code
});
```

## Priority Test Files

### Batch 1: Security (Critical)

1. `server/security/rateLimit.ts`
2. `server/security/rateLimitDb.ts`
3. `server/security/auditTrail.ts`
4. `server/security/auditSanitization.ts`
5. `server/security/projectAccess.ts`

### Batch 2: Core Services

6. `server/services/documentGenerator.ts`
7. `server/services/completionService.ts`
8. `server/services/knowledgeGraphService.ts`
9. `server/services/gdprComplianceService.ts`
10. `server/services/bankIdService.ts`

### Batch 3: External Integrations

11. `server/services/lantmaterietService.ts`
12. `server/services/limsService.ts`
13. `server/services/externalHealthService.ts`
14. `server/datasources/*`

### Batch 4: Repositories

15. `server/repositories/*`

## Code Style

### TypeScript

- Use strict mode, avoid `any`
- Prefer `type` over `interface` for simple types
- Use Zod for runtime validation

### Naming

- Files: `camelCase.ts` for modules, `PascalCase.tsx` for components
- Functions: `camelCase`
- Types: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`

### Error Handling

```typescript
import { AppError } from '../../server/security/secureErrors';
throw new AppError('Error message', 400);
```

## Swedish Context & Legal Compliance

- UI strings MUST be in Swedish.
- Environmental regulations follow "Miljöbalken (MB)".
- All AI-generated content MUST include the disclaimer: "Human-in-the-loop: juridisk slutgranskning krävs".
- Coordinate system: SWEREF99 TM (EPSG:3006).
- Test data examples: "Stockholms kommun", "GÄVLE BRYNÄS 1:1".

## Frontend Component Testing (React/Vitest)

### Frontend Test Strategy

When asked to test components in `components/`:

1. Use React Testing Library (`render`, `screen`, `userEvent`)
2. Place tests in `tests/unit/{ComponentName}.test.tsx`
3. Mock all data fetching hooks (`useEffect` → mock APIs)
4. Test user interactions only (clicks, form submissions)
5. Test accessibility attributes (`data-testid`, `role`, `aria-*`)

### Frontend Cleanup Rules

**Hardcoded Mock Data to Remove:**

- `const _MOCK_*` variables → DELETE (use props or API instead)
- Hardcoded `user={{ name: 'System User' }}` → PASS FROM PROPS
- Hardcoded stats/numbers in UI → FETCH FROM BACKEND
- `TEST_*` or `DUMMY_*` constants → DELETE

**Fallback Data (KEEP):**

- `FALLBACK_CARDS` in IntegrationsDashboard (used when API fails)
- Configuration constants (`MODULES`, `MONTHS`, etc.)
- Helper functions and type definitions

### Priority Frontend Components

1. **Critical (highest impact on user flow):**
   - `App.tsx` - entry point, user context
   - `TechnicalDashboardHub.tsx` - module selection, statistics
   - `WorkspaceApp.tsx` - main workspace router

2. **High (core workflows):**
   - `ProjectWorkspace.tsx` - project editing
   - `StandaloneWorkspace.tsx` - standalone workflows
   - `CNotificationMassUI.tsx` - canonical C-anmälan schaktmassor
   - `PermitPortalView.tsx` - **deprecated** legacy kart-/provningsyta (se `docs/architecture/PERMIT_PORTAL_LEGACY.md`)

3. **Medium (supporting features):**
   - `GanttChart.tsx` - timeline visualization
   - `MapView.tsx` - GIS integration
   - `ChatBot.tsx` - AI interactions

### Component Test Template

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders with required props', () => {
    render(<MyComponent title="Test" onAction={vi.fn()} />);
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('calls onAction when button is clicked', async () => {
    const handleAction = vi.fn();
    render(<MyComponent onAction={handleAction} />);
    await userEvent.click(screen.getByRole('button'));
    expect(handleAction).toHaveBeenCalledOnce();
  });
});
```

## Design System & UI Guidelines (2026 Spring Update)

### Global Design Tokens

All design tokens are defined in `public/design-system.css` as CSS custom properties:

**Colors:**

- Primary: `--primary` (#6366F1 Indigo), `--primary-light`, `--primary-dark`
- Secondary: `--secondary` (#14B8A6 Teal), `--secondary-light`, `--secondary-dark`
- Accent: `--accent` (#F43F5E Rose), `--accent-light`, `--accent-dark`
- Status: `--status-high` (RED), `--status-medium` (ORANGE), `--status-low` (GREEN)
- Neutrals: `--text-primary`, `--text-secondary`, `--text-muted`, `--bg-main`, `--bg-card`

**Typography:**

- Display: `--font-display` = 'Outfit' (headings, UI elements)
- Body: `--font-body` = 'Inter' (all text)
- Mono: `--font-mono` = 'JetBrains Mono' (code, data tables)
- Weights: `--font-weight-light` through `--font-weight-black`

**Spacing:** `--space-1` through `--space-32` (4px base unit)

**Border Radius:** `--radius-xs` (4px) through `--radius-full` (9999px)

**Shadows:** `--shadow-xs` through `--shadow-xl` + `--shadow-glow`

**Animation:**

- Durations: `--duration-75` through `--duration-1000` (ms)
- Easing: `--ease-linear`, `--ease-in`, `--ease-out`, `--ease-in-out`, `--ease-spring`

### CSS Implementation Rules

1. **Tailwind CSS v4:** Use `@tailwind base/components/utilities` in `src/index.css`. Prefer utility classes and design tokens over ad-hoc CSS.
2. **Design Tokens:** Admin tokens in `components/admin/admin-tokens.css`; global tokens via CSS custom properties.
3. **Animation Keyframes:** Pre-built animations where defined in design system CSS.
4. **Accessibility:** All interactive elements must support keyboard focus (`outline: 2px solid var(--primary)`).

### Motion.dev Integration

When animating React components:

```typescript
import { motion } from 'framer-motion';

// Use Spring physics for natural motion
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.3, ease: 'easeOut' }}
>
  Content
</motion.div>
```

**Recommended Easing:**

- Entrance: `easeOut` (quick, natural)
- Exit: `easeIn` (quick departure)
- Continuous: `easeInOut` (smooth loops)
- Spring: `spring` (bouncy, playful)

### Component Card Pattern

Module/feature cards in dashboards should follow:

```html
<div class="tech-card glow-indigo group">
  <div class="relative z-10">
    <span class="icon-wrapper"><!-- icon --></span>
    <span class="badge">BADGE</span>
    <h3 class="text-2xl font-bold font-display">Title</h3>
    <p class="text-secondary text-sm">Description</p>
    <div class="action-link">CTA <i class="icon"></i></div>
  </div>
</div>
```

### Loading States

- **Skeleton:** Apply `.skeleton` CSS class + optional `.skeleton-text`, `.skeleton-card` variants
- **Spinner:** Use `.animate-spin` on icon element
- **Pulse:** Use `.animate-pulse` for subtle breathing effect
- **Shimmer:** Background shift animation for placeholders

### Dark Theme Consistency

- Background: `var(--bg-main)` (#060607) for page, `var(--bg-card)` for containers
- Borders: `var(--border)` (8% white) for subtle, `var(--border-bright)` (15%) for emphasis
- Text: `var(--text-primary)` for primary, `var(--text-secondary)` for meta, `var(--text-muted)` for disabled

## Dashboard & Service Integration (NEW)

### 1. Data Mapping Rules (Zero Fake Data)

When building components for `app/routes/dashboard.tsx` or related views:

- **Progress Tracking**: Map data from `completionService.getAppCompletion()` directly to UI.
  - `donePercent` -> Main circular progress.
  - `categories` -> Progress cards with `percent`, `done`, and `total`.
- **Knowledge Graph**: Map `knowledgeGraphService.searchGraph()` to visual nodes.
  - `nodeType: 'RISK'` -> Render with `--status-high/medium/low` based on metadata.
  - `nodeType: 'LEGAL_RULE'` -> Render with a scale icon and link to documentation.
- **Environmental Risk**: Map `sguRiskService.calculateRisk()` results to the `RiskBadge` component.
  - `HIGH` -> `var(--status-high)` (Red) + Pulse animation.
  - `MEDIUM` -> `var(--status-medium)` (Orange).
  - `LOW` -> `var(--status-low)` (Green).

### Frontend Data Fetching Pattern

Use TanStack Query hooks that call typed API helpers — never direct `server/` imports:

```typescript
// services/sewageApi.ts
import { callCore } from './coreApiClient';

export async function fetchSewageRequirementChecklist(params: SewageRequirementChecklistRequest) {
  const result = await callCore<{ ok: boolean; requirements: SewageRequirement[] }>(
    '/api/sewage/requirement-checklist',
    { body: params },
  );
  return result.requirements;
}

// components/admin/hooks/useSewageRequirementChecklist.ts
import { useQuery } from '@tanstack/react-query';
import { fetchSewageRequirementChecklist } from '../../../services/sewageApi';

export function useSewageRequirementChecklist(params: SewageRequirementChecklistRequest) {
  return useQuery({
    queryKey: ['sewage', 'requirement-checklist', params],
    queryFn: () => fetchSewageRequirementChecklist(params),
  });
}
```

Public endpoints use `services/apiClient.ts`; authenticated admin endpoints use `services/coreApiClient.ts` (`callCore`).

### 3. Figma to Code Fidelity

- **Glassmorphism**: Always apply `.glass` or `.glass-strong` to container backgrounds from Figma.
- **Micro-animations**: Add `whileHover={{ scale: 1.02 }}` and `whileTap={{ scale: 0.98 }}` to all interactive cards.
- **Responsive Layout**: Use CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))` for dashboard cards.

## Do NOT

- Create placeholder tests with `test.todo()`
- Skip error handling tests
- Use `any` type in test files
- Call real external APIs in tests
- Commit tests that don't pass
- **Import `server/**` from React components or client-side `services/` (except type-only re-exports in `src/types/`)**
- **Accept HTTP 500/501 as passing smoke-test status codes**
- **Hardcode UI arrays for "demonstration" (use real service data instead)**
- Use console.log for debugging (use proper logging service)
- Use hardcoded colors instead of CSS variables or Tailwind tokens
- Apply animations without considering performance (60fps target)
- **Ignore Swedish grammar in UI strings (e.g., use "Miljöbeslut" not "Miljo beslut")**
