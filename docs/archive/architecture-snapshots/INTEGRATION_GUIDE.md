# Integration Guide: Setting Up Your Enhanced Frontend Architecture

Complete step-by-step guide to integrate all new features into your Miljobeslut.se application.

---

## Step 1: Update App.tsx with Providers

Wrap your entire application with context providers:

```typescript
import React, { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/context/ErrorBoundary';
import { LoadingProvider } from './components/context/LoadingContext';
import { ToastProvider } from './components/context/ToastContext';
import { ThemeProvider } from './components/context/ThemeContext';
import App from './components/App';
import { ContentFallback } from './components/ui/LoadingSpinner';

export function RootApp() {
  return (
    <ErrorBoundary>
      <LoadingProvider>
        <ToastProvider>
          <ThemeProvider>
            <Suspense fallback={<ContentFallback label="Laddar app" />}>
              <App />
            </Suspense>
          </ThemeProvider>
        </ToastProvider>
      </LoadingProvider>
    </ErrorBoundary>
  );
}
```

---

## Step 2: Configure API Client

Create an `api.ts` file to configure your API client:

```typescript
// services/api.ts
import { apiClient } from './apiClient';

// Set base URL from environment
apiClient.setBaseUrl(import.meta.env.VITE_API_URL || '');

// Set default headers
export function setAuthToken(token: string) {
  apiClient.setHeaders({
    Authorization: `Bearer ${token}`,
  });
}

export function clearAuthToken() {
  apiClient.setHeaders({
    Authorization: '',
  });
}

export default apiClient;
```

Add to `.env.local`:

```env
VITE_API_URL=https://api.miljobeslut.se
```

---

## Step 3: Create Validation Schemas

Create schema files for your forms:

```typescript
// schemas/forms.ts
import { z } from 'zod';

export const SignupSchema = z.object({
  name: z.string().min(2, 'Namn måste vara minst 2 tecken'),
  email: z.string().email('Ogiltig e-postadress'),
  password: z.string().min(8, 'Lösenord måste vara minst 8 tecken'),
  acceptTerms: z.boolean().refine((val) => val === true, {
    message: 'Du måste acceptera villkoren',
  }),
});

export const ProjectSchema = z.object({
  title: z.string().min(3, 'Titel måste vara minst 3 tecken'),
  description: z.string().optional(),
  municipality: z.string().min(1, 'Kommun är obligatorisk'),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

export type SignupFormData = z.infer<typeof SignupSchema>;
export type ProjectFormData = z.infer<typeof ProjectSchema>;
```

---

## Step 4: Create Custom Hooks for Your Domain

```typescript
// hooks/useProjects.ts
import { useState, useCallback } from 'react';
import { useFetch, useAsync } from '../components/hooks';
import { useToast } from '../components/context/ToastContext';
import { apiClient } from '../services/api';

export function useProjects() {
  const { addToast } = useToast();
  const { data: projects, loading, error, refetch } = useFetch('/projects');

  const createProject = useCallback(
    async (data: any) => {
      try {
        const result = await apiClient.post('/projects', data);
        addToast('Projekt skapat!', 'success');
        refetch();
        return result;
      } catch (error) {
        addToast('Kunde inte skapa projekt', 'error');
        throw error;
      }
    },
    [addToast, refetch],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await apiClient.delete(`/projects/${id}`);
        addToast('Projekt raderat', 'success');
        refetch();
      } catch (error) {
        addToast('Kunde inte radera projekt', 'error');
        throw error;
      }
    },
    [addToast, refetch],
  );

  return { projects, loading, error, createProject, deleteProject, refetch };
}
```

---

## Step 5: Create Reusable Page Components

```typescript
// components/pages/ProjectsPage.tsx
import React, { useState } from 'react';
import {
  Container,
  Stack,
  Card,
  DataTable,
  Modal,
  Form,
  FormField,
  Button,
} from '../ui';
import { ProjectSchema, type ProjectFormData } from '../../schemas/forms';
import { useProjects } from '../../hooks/useProjects';
import { useToast } from '../context/ToastContext';

export const ProjectsPage: React.FC = () => {
  const { projects, loading, createProject } = useProjects();
  const { addToast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const handleCreateProject = async (data: ProjectFormData) => {
    await createProject(data);
    setIsCreateOpen(false);
  };

  return (
    <Container size="xl">
      <Stack spacing="lg">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-black">Projekt</h1>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
          >
            + Nytt projekt
          </button>
        </div>

        {loading ? (
          <div>Laddar...</div>
        ) : (
          <DataTable
            data={projects || []}
            columns={[
              { key: 'title', label: 'Titel', sortable: true },
              { key: 'municipality', label: 'Kommun', sortable: true },
              { key: 'riskLevel', label: 'Risknivå', sortable: true },
              { key: 'createdAt', label: 'Skapad', sortable: true },
            ]}
            rowKey="id"
            searchable
            searchFields={['title', 'municipality']}
            paginate
            pageSize={20}
          />
        )}

        <Modal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Skapa nytt projekt"
          size="lg"
          footer={
            <>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg"
              >
                Avbryt
              </button>
              <button
                type="submit"
                form="create-project-form"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Skapa
              </button>
            </>
          }
        >
          <Form<ProjectFormData>
            schema={ProjectSchema}
            onSubmit={handleCreateProject}
            initialValues={{
              title: '',
              description: '',
              municipality: '',
              riskLevel: 'MEDIUM',
            }}
          >
            {({ values, errors, touched, handleChange, handleBlur }) => (
              <>
                <FormField
                  label="Titel"
                  name="title"
                  value={values.title}
                  error={errors.title}
                  touched={touched.title}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                />
                <FormField
                  label="Beskrivning"
                  name="description"
                  value={values.description}
                  error={errors.description}
                  touched={touched.description}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  multiline
                />
                <FormField
                  label="Kommun"
                  name="municipality"
                  value={values.municipality}
                  error={errors.municipality}
                  touched={touched.municipality}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
                  options={[
                    { value: 'stockholm', label: 'Stockholm' },
                    { value: 'gothenburg', label: 'Göteborg' },
                    { value: 'malmo', label: 'Malmö' },
                  ]}
                />
                <FormField
                  label="Risknivå"
                  name="riskLevel"
                  value={values.riskLevel}
                  error={errors.riskLevel}
                  touched={touched.riskLevel}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  options={[
                    { value: 'LOW', label: 'Låg' },
                    { value: 'MEDIUM', label: 'Medel' },
                    { value: 'HIGH', label: 'Hög' },
                  ]}
                />
              </>
            )}
          </Form>
        </Modal>
      </Stack>
    </Container>
  );
};

export default ProjectsPage;
```

---

## Step 6: Environment Configuration

Create `.env.local`:

```env
# API Configuration
VITE_API_URL=https://api.miljobeslut.se

# Feature Flags
VITE_ENABLE_DARK_MODE=true
VITE_ENABLE_ANALYTICS=true

# Other
VITE_APP_VERSION=2.0.0
```

---

## Step 7: Update TypeScript Configuration

Ensure `tsconfig.json` includes proper module resolution:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./*"],
      "@/*": ["./*"]
    }
  }
}
```

---

## Step 8: Update Main index.tsx

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RootApp } from './RootApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>
  );
}
```

---

## Step 9: Package Installation

Ensure all dependencies are installed:

```bash
npm install zod clsx
npm install -D @types/react @types/react-dom
```

Verify `package.json` includes:

- `react`: ^19.2.4
- `react-dom`: ^19.2.4
- `motion`: ^12.34.3
- `tailwind-merge`: ^3.5.0
- `lucide-react`: ^0.575.0
- `zod`: ^3.25.76

---

## Step 10: Testing Setup

Create a simple test for a custom hook:

```typescript
// hooks/__tests__/useLocalStorage.test.ts
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should store and retrieve values', () => {
    const { result } = renderHook(() => useLocalStorage('test', 'initial'));

    expect(result.current[0]).toBe('initial');

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(localStorage.getItem('test')).toBe('"updated"');
  });
});
```

---

## Verification Checklist

- [ ] All context providers added to App.tsx
- [ ] API client configured with base URL
- [ ] Environment variables set in `.env.local`
- [ ] TypeScript compilation passes (`npm run typecheck`)
- [ ] No linting errors (`npm run lint`)
- [ ] Example page loads correctly
- [ ] Forms validate and submit properly
- [ ] Toast notifications appear
- [ ] Theme provider works (theme persists in localStorage)
- [ ] Data table sorting and filtering work
- [ ] Modal opens and closes properly
- [ ] useBreakpoints hook detects screen sizes correctly

---

## Common Issues & Solutions

### Issue: "useToast must be used within ToastProvider"

**Solution**: Ensure ToastProvider wraps the component using useToast

### Issue: API calls return CORS errors

**Solution**: Configure CORS on backend or use proxy in development

### Issue: Form validation not working

**Solution**: Verify Zod schema matches form field names exactly

### Issue: Theme not persisting

**Solution**: Check localStorage is enabled and ThemeProvider is at app root

### Issue: Modal backdrop not appearing

**Solution**: Ensure parent has `overflow: hidden` or increase z-index of modal

---

## Performance Optimization Tips

1. **Use React.memo for components**

   ```typescript
   export const MyComponent = React.memo(({ prop1, prop2 }) => (...));
   ```

2. **Lazy load heavy components**

   ```typescript
   const HeavyComponent = lazy(() => import('./HeavyComponent'));
   ```

3. **Debounce search inputs**

   ```typescript
   const debouncedSearch = useDebounce(searchTerm, 500);
   ```

4. **Memoize callbacks**

   ```typescript
   const handleClick = useCallback(() => { ... }, []);
   ```

5. **Use DataTable pagination**
   ```typescript
   <DataTable paginate pageSize={20} />
   ```

---

## Next Steps

1. ✅ Complete integration above
2. Review `COMPREHENSIVE_FEATURES.md` for all available features
3. Check `components/examples/ExamplePage.tsx` for usage examples
4. Customize `components/theme/designTokens.ts` for your brand
5. Create domain-specific hooks in `hooks/` folder
6. Build your pages using the new components
7. Set up automated testing for custom hooks and components
8. Deploy and monitor performance in production

---

## Support Resources

- **React Documentation**: https://react.dev
- **Zod Documentation**: https://zod.dev
- **Motion.dev**: https://motion.dev
- **Tailwind CSS**: https://tailwindcss.com
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/

---

Need help? Check the error messages and consult the Troubleshooting section in `COMPREHENSIVE_FEATURES.md`.
