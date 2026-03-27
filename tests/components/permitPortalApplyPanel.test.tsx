import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Permit } from '../../types';

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => ({
    plan: {
      permitCodeSelection: { code: '', municipality: '', codeType: '', regulatoryTrack: '' },
      documentArchive: [],
      stageGates: [],
    },
    setPlan: vi.fn(),
    addArchiveDocument: vi.fn(),
    evaluateGate: vi.fn().mockResolvedValue({ status: 'PASSED', changed: false }),
    markModuleReady: vi.fn(),
  }),
}));

vi.mock('../../components/RequirementChecklist', () => ({
  default: () => <div data-testid="requirement-checklist" />,
}));

import PermitPortalApplyPanel from '../../components/PermitPortalApplyPanel';

const samplePermits: Permit[] = [
  {
    id: 'p1',
    diarienummer: 'D-001',
    municipality: 'Stockholm',
    decision_type: 'BIFALL',
    permit_type: 'C-ANMALAN',
    date: '2024-01-01',
    description: 'Test',
  },
];

describe('PermitPortalApplyPanel', () => {
  // ── Main render ───────────────────────────────────────────────────────────

  it('renders the Ansokningsportal label', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByText(/Ansokningsportal/i)).toBeInTheDocument();
  });

  it('renders the main heading', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByText(/Juridiskt saker ansokan/i)).toBeInTheDocument();
  });

  it('renders Steg 1 label', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByText('Steg 1')).toBeInTheDocument();
  });

  it('renders the code selector heading', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByText(/Kodvaljare/i)).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByPlaceholderText(/Sok kod eller verksamhet/i)).toBeInTheDocument();
  });

  it('shows municipality in dropdown when permits provided', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    expect(screen.getByRole('option', { name: 'Stockholm' })).toBeInTheDocument();
  });

  it('shows warning when no permits provided', () => {
    render(<PermitPortalApplyPanel permits={[]} />);
    expect(screen.getByText(/Ingen verifierad permitdata/i)).toBeInTheDocument();
  });

  it('renders waste code entries from WASTE_CODES', () => {
    render(<PermitPortalApplyPanel permits={samplePermits} />);
    // EWC type buttons should exist
    const ewcBadges = screen.getAllByText('EWC');
    expect(ewcBadges.length).toBeGreaterThan(0);
  });
});
