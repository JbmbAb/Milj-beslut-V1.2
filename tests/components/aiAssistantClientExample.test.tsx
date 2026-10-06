import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiAssistantClientExample from '../../components/AiAssistantClientExample';
import type { Permit } from '../../types';
import { DecisionType } from '../../types';

const mockPermit: Permit = {
  id: '1',
  filename: 'test.pdf',
  checksum: 'abc123',
  received_date: '2024-01-01',
  property_id: 'SE-12345',
  municipality: 'Stockholm',
  waste_codes: 'EWC 19 12 12',
  decision_type: DecisionType.BIFALL,
  full_text: 'Test permit text',
  processed_at: '2024-01-02',
};

describe('AiAssistantClientExample', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the heading', () => {
    render(<AiAssistantClientExample permit={mockPermit} />);
    expect(screen.getByText('AI Assistant: Analysera tillstånd')).toBeInTheDocument();
  });

  it('displays the property_id', () => {
    render(<AiAssistantClientExample permit={mockPermit} />);
    expect(screen.getByText(/SE-12345/)).toBeInTheDocument();
  });

  it('displays the municipality', () => {
    render(<AiAssistantClientExample permit={mockPermit} />);
    expect(screen.getByText(/Stockholm/)).toBeInTheDocument();
  });

  it('renders the "Kör analys" button initially', () => {
    render(<AiAssistantClientExample permit={mockPermit} />);
    expect(screen.getByRole('button', { name: /Kör analys/i })).toBeInTheDocument();
  });

  it('button is enabled initially', () => {
    render(<AiAssistantClientExample permit={mockPermit} />);
    const btn = screen.getByRole('button', { name: /Kör analys/i });
    expect(btn).not.toBeDisabled();
  });

  it('shows loading state when button is clicked', async () => {
    // Mock fetch to never resolve during this test
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<AiAssistantClientExample permit={mockPermit} />);
    await userEvent.click(screen.getByRole('button', { name: /Kör analys/i }));
    expect(screen.getByRole('button', { name: /Analyserar/i })).toBeDisabled();
  });

  it('shows error when fetch fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    render(<AiAssistantClientExample permit={mockPermit} />);
    await userEvent.click(screen.getByRole('button', { name: /Kör analys/i }));
    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it('shows result when fetch succeeds', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: 'Analys klar' }),
    });
    render(<AiAssistantClientExample permit={mockPermit} />);
    await userEvent.click(screen.getByRole('button', { name: /Kör analys/i }));
    expect(await screen.findByText('Analys klar')).toBeInTheDocument();
  });

  it('shows server error when response not ok', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'Local generation unavailable' }),
    });
    render(<AiAssistantClientExample permit={mockPermit} />);
    await userEvent.click(screen.getByRole('button', { name: /Kör analys/i }));
    expect(await screen.findByText(/Local generation unavailable/)).toBeInTheDocument();
  });
});
