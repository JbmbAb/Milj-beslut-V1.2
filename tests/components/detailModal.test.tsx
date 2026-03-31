import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DetailModal from '../../components/DetailModal';
import { DecisionType } from '../../types';
import type { Permit } from '../../types';

vi.mock('../../services/geminiService', () => ({
  analyzePermitRisk: vi.fn(),
  chatWithPermit: vi.fn(),
}));

import { analyzePermitRisk, chatWithPermit } from '../../services/geminiService';

const mockPermit: Permit = {
  id: 1,
  filename: 'beslut_2024_001.pdf',
  checksum: 'abc123def456',
  received_date: '2024-01-15',
  property_id: 'STHLM-1234',
  municipality: 'Stockholm',
  waste_codes: '19 12 12',
  decision_type: DecisionType.BIFALL,
  full_text: 'Fulltext av tillståndet från Länsstyrelsen.',
  processed_at: '2024-01-16',
  applicant_company: 'Miljö AB',
  consultant_company: 'Konsult AB',
  contact_person: 'Anna Svensson',
  email: 'anna@miljoab.se',
};

const user = userEvent.setup({ delay: null });

describe('DetailModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Static render ──────────────────────────────────────────────────────────

  it('renders property_id as heading', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText('STHLM-1234')).toBeInTheDocument();
  });

  it('renders municipality name', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText(/Stockholm Kommun/i)).toBeInTheDocument();
  });

  it('renders applicant_company', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText('Miljö AB')).toBeInTheDocument();
  });

  it('renders consultant_company in ContactItem', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText('Konsult AB')).toBeInTheDocument();
  });

  it('renders email address', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText('anna@miljoab.se')).toBeInTheDocument();
  });

  it('renders STARTA ANALYS button initially', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    expect(screen.getByText('STARTA ANALYS')).toBeInTheDocument();
  });

  it('calls onClose when × button is clicked', async () => {
    const onClose = vi.fn();
    render(<DetailModal permit={mockPermit} onClose={onClose} />);
    // Close button is the only button in the header that has onClose
    const allButtons = screen.getAllByRole('button');
    const closeBtn = allButtons.find((b) => b.className.includes('w-12') && b.className.includes('h-12'));
    if (closeBtn) await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── AI analysis ───────────────────────────────────────────────────────────

  it('shows analysis result after clicking STARTA ANALYS', async () => {
    vi.mocked(analyzePermitRisk).mockResolvedValue('Ingen risk identifierad.');
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    await user.click(screen.getByText('STARTA ANALYS'));
    await waitFor(() => expect(screen.getByText('Ingen risk identifierad.')).toBeInTheDocument());
  });

  it('shows error message when analyzePermitRisk throws', async () => {
    vi.mocked(analyzePermitRisk).mockRejectedValue(new Error('network error'));
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    await user.click(screen.getByText('STARTA ANALYS'));
    await waitFor(() => expect(screen.getByText('Fel vid analys.')).toBeInTheDocument());
  });

  // ── Chat ──────────────────────────────────────────────────────────────────

  it('shows user message in chat after submit', async () => {
    vi.mocked(chatWithPermit).mockResolvedValue('AI svarar.');
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Fråga om tillståndet/);
    await user.type(input, 'Vad gäller?');
    await user.keyboard('{Enter}');
    expect(screen.getByText('Vad gäller?')).toBeInTheDocument();
  });

  it('shows AI reply in chat after successful chatWithPermit', async () => {
    vi.mocked(chatWithPermit).mockResolvedValue('AI svarar korrekt.');
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Fråga om tillståndet/);
    await user.type(input, 'Test?');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('AI svarar korrekt.')).toBeInTheDocument());
  });
});
