# Comprehensive Frontend Architecture Guide

Complete documentation of all new frontend features, components, hooks, and utilities added to the Miljobeslut.se application.

---

## 📦 What's New

### **1. Custom React Hooks Library** (`components/hooks/`)

A comprehensive set of reusable React hooks for common patterns:

#### `useMediaQuery(query: string): boolean`
Detect media query changes programmatically
```typescript
const isMobile = useMediaQuery('(max-width: 640px)');
const isDesktop = useMediaQuery('(min-width: 1024px)');
```

#### `useBreakpoints()`
Predefined media queries for common breakpoints
```typescript
const { isMobile, isTablet, isDesktop, isDarkMode, isReducedMotion } = useBreakpoints();
```

#### `useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void]`
Store and retrieve values from localStorage with automatic syncing
```typescript
const [theme, setTheme] = useLocalStorage('theme', 'light');
```

#### `useFetch<T>(url: string, options?: RequestInit): { data, loading, error, refetch }`
Fetch data from API endpoints with automatic loading and error handling
```typescript
const { data, loading, error, refetch } = useFetch('/api/users');
```

#### `useAsync<T>(asyncFunction: () => Promise<T>, immediate?: boolean): { status, data, error, execute }`
Handle async operations with state management
```typescript
const { status, data, execute } = useAsync(() => api.getUsers());
```

#### `useDebounce<T>(value: T, delay?: number): T`
Debounce values for optimized API calls (search, resize, etc.)
```typescript
const debouncedSearchTerm = useDebounce(searchInput, 500);
```

#### `usePrevious<T>(value: T): T | undefined`
Get the previous value of a prop or state
```typescript
const prevCount = usePrevious(count);
```

---

### **2. Form System with Zod Validation** (`components/ui/Form.tsx`, `components/ui/FormField.tsx`)

Complete form solution with validation, error handling, and submission management.

#### `Form<T>` Component
```typescript
<Form<SignupData>
  schema={SignupSchema}
  onSubmit={handleSubmit}
  initialValues={{ email: '', password: '' }}
>
  {({ values, errors, touched, handleChange, handleBlur, isSubmitting }) => (
    <>
      <FormField
        label="Email"
        name="email"
        value={values.email}
        error={errors.email}
        touched={touched.email}
        onChange={handleChange}
        onBlur={handleBlur}
        required
      />
      {/* more fields */}
    </>
  )}
</Form>
```

#### `FormField` Component
- Integrated error display
- Touch tracking for better UX
- Supports: text, email, password, number, textarea, select
- Fully accessible with labels and ARIA attributes

---

### **3. Toast Notification System** (`components/context/ToastContext.tsx`)

Global toast notifications with automatic timeout management.

#### `ToastProvider` & `useToast()`
```typescript
// Wrap app with provider
<ToastProvider>
  <App />
</ToastProvider>

// Use in components
const { addToast } = useToast();
addToast('Success!', 'success', 4000); // message, type, duration
```

#### Toast Types
- `success` - Green toast for successful operations
- `error` - Red toast for errors
- `warning` - Amber toast for warnings
- `info` - Blue toast for informational messages

---

### **4. Modal/Dialog Component** (`components/ui/Modal.tsx`)

Animated modal with backdrop and flexible sizing.

```typescript
const [isOpen, setIsOpen] = useState(false);

<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Confirm Action"
  size="md"
  footer={
    <>
      <button onClick={() => setIsOpen(false)}>Cancel</button>
      <button onClick={handleConfirm}>Confirm</button>
    </>
  }
>
  Are you sure?
</Modal>
```

#### Modal Sizes
- `sm` - max-w-sm
- `md` - max-w-md (default)
- `lg` - max-w-lg
- `xl` - max-w-xl

---

### **5. Data Table Component** (`components/ui/DataTable.tsx`)

Full-featured data table with sorting, filtering, and pagination.

```typescript
<DataTable<User>
  data={users}
  columns={[
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (value, row) => <Badge tone={value === 'active' ? 'ok' : 'default'}>{value}</Badge>,
    },
  ]}
  rowKey="id"
  searchable={true}
  searchFields={['name', 'email']}
  paginate={true}
  pageSize={10}
/>
```

#### Features
- **Sorting**: Click column headers to sort (supports multi-column)
- **Searching**: Built-in search with debouncing
- **Pagination**: Configurable page size with prev/next buttons
- **Custom rendering**: Custom render functions per column
- **Responsive**: Scrollable table on mobile

---

### **6. Theme Provider** (`components/context/ThemeContext.tsx`)

Global theme management with system preference detection and persistent storage.

```typescript
<ThemeProvider>
  <App />
</ThemeProvider>

// Use in components
const { theme, setTheme, isDark } = useTheme();

setTheme('dark'); // 'light' | 'dark' | 'system'
```

---

### **7. API Client Utilities** (`services/apiClient.ts`)

Production-ready API client with error handling, timeouts, and request/response handling.

```typescript
import { apiClient } from '~/services/apiClient';

// GET request
const users = await apiClient.get('/users', { params: { limit: 10 } });

// POST request
const newUser = await apiClient.post('/users', { name: 'John', email: 'john@example.com' });

// PATCH request
const updated = await apiClient.patch('/users/1', { name: 'Jane' });

// DELETE request
await apiClient.delete('/users/1');

// Set custom headers
apiClient.setHeaders({ Authorization: `Bearer ${token}` });
```

#### Features
- Automatic request timeout (30s default)
- Query parameter handling
- JSON serialization/deserialization
- Error handling and messages
- Singleton instance with global configuration

---

### **8. Layout Components**

#### `Container`
Responsive centered container with max-width
```typescript
<Container size="lg">
  <YourContent />
</Container>
```

#### `Stack`
Flexible flex-based layout with consistent spacing
```typescript
<Stack direction="row" spacing="lg" align="center" justify="between">
  <Item1 />
  <Item2 />
</Stack>
```

#### `Grid`
Responsive grid layout
```typescript
<Grid cols={3} gap="md">
  {items.map(item => <GridItem key={item.id}>{item}</GridItem>)}
</Grid>
```

#### `Card`
Container with optional header and footer
```typescript
<Card header="Title" footer="Footer content">
  Card content here
</Card>
```

---

### **9. Error Handling** (`components/context/ErrorBoundary.tsx`)

React Error Boundary for graceful error handling

```typescript
<ErrorBoundary fallback={(error, retry) => (
  <div>
    <p>Error: {error.message}</p>
    <button onClick={retry}>Retry</button>
  </div>
)}>
  <YourComponent />
</ErrorBoundary>
```

---

### **10. Loading Context** (`components/context/LoadingContext.tsx`)

Global loading state management

```typescript
<LoadingProvider>
  <App />
</LoadingProvider>

// Use in components
const { startLoading, stopLoading } = useLoading();

const handleAction = async () => {
  startLoading('Processing...');
  await api.action();
  stopLoading();
};
```

---

## 📁 File Structure

```
components/
├── hooks/
│   ├── useMediaQuery.ts
│   ├── useLocalStorage.ts
│   ├── useFetch.ts
│   ├── useAsync.ts
│   ├── useDebounce.ts
│   ├── usePrevious.ts
│   └── index.ts
├── ui/
│   ├── Badge.tsx
│   ├── MetricCard.tsx
│   ├── ActionCard.tsx
│   ├── IconButton.tsx
│   ├── LoadingSpinner.tsx
│   ├── Form.tsx
│   ├── FormField.tsx
│   ├── Modal.tsx
│   ├── DataTable.tsx
│   ├── Container.tsx
│   ├── Stack.tsx
│   ├── Grid.tsx
│   ├── Card.tsx
│   └── index.ts
├── context/
│   ├── ErrorBoundary.tsx
│   ├── LoadingContext.tsx
│   ├── ToastContext.tsx
│   └── ThemeContext.tsx
├── utils/
│   └── classNameUtils.ts
├── theme/
│   └── designTokens.ts
└── examples/
    └── ExamplePage.tsx

services/
└── apiClient.ts
```

---

## 🚀 Quick Start

### 1. Setup Providers
```typescript
<ErrorBoundary>
  <LoadingProvider>
    <ToastProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ToastProvider>
  </LoadingProvider>
</ErrorBoundary>
```

### 2. Use Hooks
```typescript
import { useBreakpoints, useLocalStorage, useFetch, useDebounce } from '~/components/hooks';

const { isDesktop } = useBreakpoints();
const [theme, setTheme] = useLocalStorage('theme', 'light');
const { data: users } = useFetch('/api/users');
const debouncedSearch = useDebounce(searchTerm, 500);
```

### 3. Use Components
```typescript
import { Badge, Card, Modal, DataTable, Form } from '~/components/ui';
import { useToast } from '~/components/context/ToastContext';

const { addToast } = useToast();

<Card header="Users">
  <DataTable data={users} ... />
</Card>
```

### 4. Make API Calls
```typescript
import { apiClient } from '~/services/apiClient';

const data = await apiClient.get('/endpoint');
const result = await apiClient.post('/endpoint', { ...body });
```

---

## 🎨 Design Token System

Centralized design tokens for consistency:

```typescript
import { designTokens } from '~/components/theme/designTokens';

const color = designTokens.colors.semantic.primary;
const spacing = designTokens.spacing.lg;
const radius = designTokens.radius['2xl'];
```

---

## 📊 Usage Examples

### Contact Form Example
See `components/examples/ExamplePage.tsx` for a complete implementation demonstrating:
- Form validation with Zod
- Toast notifications
- Modal dialogs
- Data tables with sorting & filtering
- Responsive layouts
- All components working together

---

## ✅ Features Summary

| Feature | Status | Location |
|---------|--------|----------|
| Custom Hooks (6 types) | ✅ | `components/hooks/` |
| Form System with Zod | ✅ | `components/ui/Form*` |
| Toast Notifications | ✅ | `components/context/ToastContext` |
| Modal/Dialog | ✅ | `components/ui/Modal` |
| Data Table | ✅ | `components/ui/DataTable` |
| Theme Provider | ✅ | `components/context/ThemeContext` |
| API Client | ✅ | `services/apiClient` |
| Layout Components | ✅ | `components/ui/(Container\|Stack\|Grid\|Card)` |
| Error Boundary | ✅ | `components/context/ErrorBoundary` |
| Loading State | ✅ | `components/context/LoadingContext` |
| Design Tokens | ✅ | `components/theme/designTokens` |
| UI Components (5) | ✅ | `components/ui/(Badge\|MetricCard\|...)` |

---

## 🔧 Configuration

### API Client Base URL
```typescript
// Set via environment variable
// .env.local
VITE_API_URL=https://api.example.com

// Or set programmatically
apiClient.setBaseUrl('https://api.example.com');
apiClient.setHeaders({ Authorization: `Bearer ${token}` });
```

### Theme
```typescript
const { theme, setTheme } = useTheme();
setTheme('dark'); // persists to localStorage
```

### Timeouts & Delays
```typescript
// Fetch timeout (default 30s)
useFetch(url, { timeout: 60000 });

// Debounce delay (default 500ms)
useDebounce(value, 1000);

// Toast duration (default 4s)
addToast('Message', 'info', 6000);
```

---

## 🎯 Next Steps

1. **Integrate into App.tsx** - Wrap with all providers
2. **Review ExamplePage.tsx** - See all components in action
3. **Customize designTokens.ts** - Adjust colors, spacing, etc.
4. **Set API base URL** - Configure for your backend
5. **Test responsiveness** - Use `useBreakpoints()` for logic

---

## 📚 Additional Resources

- [Zod Documentation](https://zod.dev)
- [Motion.dev Documentation](https://motion.dev)
- [Tailwind CSS v3](https://tailwindcss.com)
- [React Hooks Best Practices](https://react.dev/reference/react/hooks)

---

## 🐛 Troubleshooting

### useTheme outside ThemeProvider
**Error**: `useTheme must be used within ThemeProvider`
**Solution**: Wrap your app with `<ThemeProvider>`

### useToast outside ToastProvider
**Error**: `useToast must be used within ToastProvider`
**Solution**: Wrap your app with `<ToastProvider>`

### Form validation not working
**Check**: Ensure schema is properly defined with Zod
**Check**: Verify form fields have `name` matching schema keys

### API calls failing
**Check**: Verify `VITE_API_URL` is set correctly
**Check**: Check network tab for actual request/response
**Check**: Ensure CORS headers are configured on backend
