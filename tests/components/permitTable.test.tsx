import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PermitTable from '../../components/PermitTable';
import { DecisionType } from '../../types';
import type { Permit } from '../../types';

vi.mock('../../services/geminiService', () => ({
  generateMarketingSummary: vi.fn(),
}));

import { generateMarketingSummary } from '../../services/geminiService';

const makePermit = (overrides: Partial<Permit> = {}): Permit => ({
  id: 1,
  filename: 'beslut_001.pdf',
  checksum: 'abc123',
  received_date: '2024-03-01',
  property_id: 'GBG-001',
  municipality: 'Göteborg',
  waste_codes: '19 08 01',
  decision_type: DecisionType.BIFALL,
  full_text: 'Fulltext.',
  processed_at: '2024-03-02',
  applicant_company: 'Göteborg Miljö AB',
  ...overrides,
});

const twoPermits: Permit[] = [
  makePermit({ id: 1, property_id: 'GBG-001', municipality: 'Göteborg', applicant_company: 'GBG Miljö' }),
  makePermit({
    id: 2,
    property_id: 'MLM-001',
    municipality: 'Malmö',
    decision_type: DecisionType.AVSLAG,
    applicant_company: 'Malmö Återvinning',
  }),
];

const user = userEvent.setup({ delay: null });

describe('PermitTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Static render ──────────────────────────────────────────────────────────

  it('renders Fastighetsdatabas heading', () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    expect(screen.getByText(/Fastighetsdatabas/i)).toBeInTheDocument();
  });

  it('shows the permit count', () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    expect(screen.getByText(/Verifierade poster: 2/)).toBeInTheDocument();
  });

  it('renders both permit rows', () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    expect(screen.getByText('GBG-001')).toBeInTheDocument();
    expect(screen.getByText('MLM-001')).toBeInTheDocument();
  });

  it('renders applicant company names', () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    expect(screen.getByText('GBG Miljö')).toBeInTheDocument();
    expect(screen.getByText('Malmö Återvinning')).toBeInTheDocument();
  });

  // ── Search filter ─────────────────────────────────────────────────────────

  it('filters rows by search term', async () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/Sök sökande/i);
    await user.type(searchInput, 'GBG');
    expect(screen.getByText('GBG-001')).toBeInTheDocument();
    expect(screen.queryByText('MLM-001')).not.toBeInTheDocument();
  });

  it('shows empty-state when no permits match search', async () => {
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/Sök sökande/i), 'xyzxyz');
    expect(screen.getByText(/Inga ärenden matchar din sökning/i)).toBeInTheDocument();
  });

  // ── Row click → onSelect ──────────────────────────────────────────────────

  it('calls onSelect when a permit row is clicked', async () => {
    const onSelect = vi.fn();
    render(<PermitTable permits={twoPermits} onSelect={onSelect} />);
    await user.click(screen.getByText('GBG-001'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'GBG-001' }));
  });

  // ── Marketing summary ─────────────────────────────────────────────────────

  it('shows AI Marknadsinsikt panel after generating summary', async () => {
    vi.mocked(generateMarketingSummary).mockResolvedValue({ text: 'Sammanfattning klar.', sources: [] });
    render(<PermitTable permits={twoPermits} onSelect={vi.fn()} />);
    await user.click(screen.getByText(/Skapa Marknadsunderlag/i));
    await waitFor(() => expect(screen.getByText('Sammanfattning klar.')).toBeInTheDocument());
  });
});
