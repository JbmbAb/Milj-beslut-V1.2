import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import ProjectPlanStructurePanel from '../../components/ProjectPlanStructurePanel';
import { createDefaultProjectPlan } from '../../services/projectStructure';
import type { ProjectPlan } from '../../types';

vi.mock('../../services/documentUploadClient', () => ({
  uploadProjectDocument: vi.fn(),
}));

vi.mock('../../services/documentAccessClient', () => ({
  openProjectDocument: vi.fn(),
  downloadProjectDocument: vi.fn(),
  deleteProjectDocument: vi.fn(),
}));

describe('ProjectPlanStructurePanel', () => {
  let onUpdatePlan: (key: keyof ProjectPlan, value: unknown) => void;

  beforeEach(() => {
    onUpdatePlan = vi.fn();
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderPanel = () =>
    render(<ProjectPlanStructurePanel plan={createDefaultProjectPlan()} onUpdatePlan={onUpdatePlan} />);

  // ── Branding section ──────────────────────────────────────────────────────

  it('renders Branding & Report Layout heading', () => {
    renderPanel();
    expect(screen.getByText('Branding & Report Layout')).toBeInTheDocument();
  });

  it('renders Organisationsnamn placeholder input', () => {
    renderPanel();
    expect(screen.getByPlaceholderText('Organisationsnamn')).toBeInTheDocument();
  });

  it('renders Logo URL placeholder input', () => {
    renderPanel();
    expect(screen.getByPlaceholderText('Logo URL')).toBeInTheDocument();
  });

  it('renders layout template dropdown', () => {
    renderPanel();
    expect(screen.getByRole('option', { name: 'CORPORATE' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AUTHORITIES' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'COMPACT' })).toBeInTheDocument();
  });

  // ── Module readiness section ───────────────────────────────────────────────

  it('renders Integrated Module Readiness heading', () => {
    renderPanel();
    expect(screen.getByText('Integrated Module Readiness')).toBeInTheDocument();
  });

  it('renders module readiness selects', () => {
    renderPanel();
    expect(screen.getByText('PROJECT_MANAGER')).toBeInTheDocument();
    expect(screen.getByText('PERMIT_PORTAL')).toBeInTheDocument();
  });

  // ── Document archive section ───────────────────────────────────────────────

  it('renders Structured Document Archive heading', () => {
    renderPanel();
    expect(screen.getByText('Structured Document Archive')).toBeInTheDocument();
  });

  it('renders file upload input', () => {
    renderPanel();
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
  });

  it('calls onUpdatePlan when branding org name is changed', () => {
    renderPanel();
    const orgInput = screen.getByPlaceholderText('Organisationsnamn');
    fireEvent.change(orgInput, { target: { value: 'Testorg AB' } });
    expect(onUpdatePlan).toHaveBeenCalledWith(
      'branding',
      expect.objectContaining({ organizationName: 'Testorg AB' }),
    );
  });

  it('shows upload warning when no session', async () => {
    renderPanel();
    // Find upload button
    const uploadBtn = screen.getByRole('button', { name: /Ladda upp till projektarkiv/i });
    fireEvent.click(uploadBtn);
    expect(await screen.findByText(/Valj en fil forst|Välj en fil först/i)).toBeInTheDocument();
  });
});
