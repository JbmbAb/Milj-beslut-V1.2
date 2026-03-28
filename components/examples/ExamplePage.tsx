/**
 * Example Page Component
 * Demonstrates usage of all new UI components, hooks, forms, and utilities
 * This is a reference template for building feature-rich pages
 */

import React, { useState } from 'react';
import { z } from 'zod';
import {
  Container,
  Stack,
  Grid,
  Card,
  Badge,
  MetricCard,
  ActionCard,
  Modal,
  Form,
  FormField,
  DataTable,
} from '../ui';
import { useToast } from '../context/ToastContext';
import { useBreakpoints } from '../hooks';

// Example form schema
const ContactFormSchema = z.object({
  name: z.string().min(2, 'Namn måste vara minst 2 tecken'),
  email: z.string().email('Ogiltig e-postadress'),
  message: z.string().min(10, 'Meddelande måste vara minst 10 tecken'),
});

type ContactFormData = z.infer<typeof ContactFormSchema>;

// Example data for table
interface User {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'inactive';
  joinDate: string;
}

const exampleUsers: User[] = [
  {
    id: 1,
    name: 'Anna Bergström',
    email: 'anna@example.com',
    status: 'active',
    joinDate: '2024-01-15',
  },
  {
    id: 2,
    name: 'Erik Lundström',
    email: 'erik@example.com',
    status: 'active',
    joinDate: '2024-02-20',
  },
  {
    id: 3,
    name: 'Lisa Johansson',
    email: 'lisa@example.com',
    status: 'inactive',
    joinDate: '2023-12-10',
  },
];

export const ExamplePage: React.FC = () => {
  const { addToast } = useToast();
  const { isDesktop } = useBreakpoints();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFormSubmit = async (data: ContactFormData) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    addToast(`Tack ${data.name}! Ditt meddelande har skickats.`, 'success');
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <Container>
        <Stack spacing="lg">
          {/* Header Section */}
          <div>
            <h1 className="text-4xl font-black text-slate-900 mb-2">
              Exempel på alla UI-komponenter
            </h1>
            <p className="text-lg text-slate-600">
              En komplett guide till de nya komponenter och hooks vi tillhandahåller
            </p>
          </div>

          {/* Badges Section */}
          <Card header={<h2 className="text-xl font-bold">Badges</h2>}>
            <Stack direction="row" spacing="sm" align="center">
              <Badge tone="default">Standard</Badge>
              <Badge tone="ok">Aktiv</Badge>
              <Badge tone="warn">Varning</Badge>
              <Badge tone="error">Fel</Badge>
            </Stack>
          </Card>

          {/* Metrics Grid */}
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Mätvärden</h2>
            <Grid cols={3}>
              <MetricCard label="Aktiva användare" value="1,234" tone="ok" />
              <MetricCard label="Väntande" value="42" tone="warn" />
              <MetricCard label="Inaktiva" value="156" tone="default" />
            </Grid>
          </div>

          {/* Action Cards */}
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Åtgärdskort</h2>
            <Grid cols={2}>
              <ActionCard
                title="Lägg till användare"
                description="Bjud in nya medlemmar till ditt team"
                tone="ok"
                actionLabel="Bjud in"
                onAction={() => addToast('Bjudning skickad!', 'success')}
              />
              <ActionCard
                title="Granska ändringar"
                description="Det finns 5 väntande ändringar att granska"
                tone="warn"
                actionLabel="Granska"
                onAction={() => addToast('Öppnar ändringsöversikt...', 'info')}
              />
            </Grid>
          </div>

          {/* Data Table */}
          <Card header={<h2 className="text-xl font-bold">Användarlista</h2>}>
            <DataTable<User>
              data={exampleUsers}
              columns={[
                { key: 'name', label: 'Namn', sortable: true },
                { key: 'email', label: 'E-post', sortable: true },
                {
                  key: 'status',
                  label: 'Status',
                  sortable: true,
                  render: (value) => (
                    <Badge tone={value === 'active' ? 'ok' : 'default'}>
                      {value === 'active' ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  ),
                },
                { key: 'joinDate', label: 'Medlemssidan', sortable: true },
              ]}
              rowKey="id"
              searchable={true}
              searchFields={['name', 'email']}
              paginate={true}
              pageSize={10}
            />
          </Card>

          {/* Modal Form */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Öppna formulär i modal
          </button>

          <Modal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title="Kontaktformulär"
            size="md"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  form="contact-form"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Skicka
                </button>
              </>
            }
          >
            <Form<ContactFormData>
              schema={ContactFormSchema}
              onSubmit={handleFormSubmit}
              initialValues={{ name: '', email: '', message: '' }}
            >
              {({ values, errors, touched, handleChange, handleBlur, isSubmitting }) => (
                <>
                  <FormField
                    label="Namn"
                    name="name"
                    value={values.name}
                    error={errors.name}
                    touched={touched.name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                  />
                  <FormField
                    label="E-post"
                    name="email"
                    type="email"
                    value={values.email}
                    error={errors.email}
                    touched={touched.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    required
                  />
                  <FormField
                    label="Meddelande"
                    name="message"
                    value={values.message}
                    error={errors.message}
                    touched={touched.message}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    multiline
                    required
                  />
                </>
              )}
            </Form>
          </Modal>

          {/* Info Section */}
          <Card header={<h2 className="text-xl font-bold">Information</h2>}>
            <Stack spacing="md">
              <div>
                <h3 className="font-bold text-slate-900">Responsive Design</h3>
                <p className="text-slate-600 text-sm">
                  {isDesktop
                    ? '✓ Du är på en skärmstorlek för desktop'
                    : '✓ Du är på en mobil eller tablet'}
                </p>
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Tillgängliga Hooks</h3>
                <p className="text-slate-600 text-sm">
                  useMediaQuery • useBreakpoints • useLocalStorage • useFetch • useAsync • useDebounce • usePrevious
                </p>
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Tillgängliga Kontexster</h3>
                <p className="text-slate-600 text-sm">
                  LoadingProvider • ToastProvider • ThemeProvider • ErrorBoundary
                </p>
              </div>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </div>
  );
};

export default ExamplePage;
