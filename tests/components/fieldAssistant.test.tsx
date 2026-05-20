import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FieldAssistant from '../../components/FieldAssistant';

vi.mock('../../services/geminiService', () => ({
  analyzeSiteImage: vi.fn(),
  analyzeTechnicalDrawing: vi.fn(),
  analyzeDrawingOCR: vi.fn(),
}));

const user = userEvent.setup({ delay: null });

describe('FieldAssistant', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Static render ──────────────────────────────────────────────────────────

  it('renders main heading', () => {
    render(<FieldAssistant />);
    expect(screen.getByText(/AI Analys & Granskning/i)).toBeInTheDocument();
  });

  it('renders subtitle text', () => {
    render(<FieldAssistant />);
    expect(screen.getByText(/Specialiserad granskning av fältfoton/i)).toBeInTheDocument();
  });

  it('renders Fältfoto mode tab button', () => {
    render(<FieldAssistant />);
    // "Fältfoto" appears in both the tab button and inside hints – just check it exists at all
    expect(screen.getAllByText(/Fältfoto/i).length).toBeGreaterThan(0);
  });

  it('renders Ritning / Situationskarta mode tab button', () => {
    render(<FieldAssistant />);
    expect(screen.getByText(/Ritning \/ Situationskarta/i)).toBeInTheDocument();
  });

  it('shows "Ta en bild från fältet" upload prompt in site mode (default)', () => {
    render(<FieldAssistant />);
    expect(screen.getByText(/Ta en bild från fältet/i)).toBeInTheDocument();
  });

  // ── Mode switching ─────────────────────────────────────────────────────────

  it('switches to drawing mode when Ritning tab clicked', async () => {
    render(<FieldAssistant />);
    await user.click(screen.getByText(/Ritning \/ Situationskarta/i));
    expect(screen.getByText(/Ladda upp situationskarta/i)).toBeInTheDocument();
  });

  it('switches back to site mode when Fältfoto tab clicked', async () => {
    render(<FieldAssistant />);
    // Go to drawing mode
    await user.click(screen.getByText(/Ritning \/ Situationskarta/i));
    expect(screen.getByText(/Ladda upp situationskarta/i)).toBeInTheDocument();
    // Switch back – the first button in the mode switcher is the Fältfoto tab
    const modeButtons = screen.getAllByRole('button');
    const faltFotoBtn = modeButtons.find((b) => b.textContent?.includes('Fältfoto'));
    if (faltFotoBtn) await user.click(faltFotoBtn);
    // Sitemap text should be gone after switching back to site mode
    expect(screen.queryByText(/Ladda upp situationskarta/i)).not.toBeInTheDocument();
  });
});
