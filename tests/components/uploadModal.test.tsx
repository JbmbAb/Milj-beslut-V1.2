import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadModal from '../../components/UploadModal';

vi.mock('../../services/geminiService', () => ({
  processDocumentOCR: vi.fn(),
  analyzeBiodiversity: vi.fn(),
  generateMarketingSummary: vi.fn(),
  classifyAsset: vi.fn(),
}));

import { processDocumentOCR } from '../../services/geminiService';

const ocrMock = processDocumentOCR as ReturnType<typeof vi.fn>;

import type { Permit } from '../../types';

const user = userEvent.setup({ delay: null });

function makeFile(name = 'beslut.pdf', type = 'application/pdf', content = 'base64data') {
  return new File([content], name, { type });
}

describe('UploadModal', () => {
  let onComplete: (permit: Partial<Permit>) => void;
  let onClose: () => void;

  beforeEach(() => {
    onComplete = vi.fn<(permit: Partial<Permit>) => void>();
    onClose = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Idle state ──────────────────────────────────────────────────────────────

  it('renders the file drop area', () => {
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    expect(
      screen.getByText(/Ladda upp PDF/i) ||
      screen.getByRole('button', { name: /Avbryt/i })
    ).toBeInTheDocument();
  });

  it('renders the "Avbryt Import" button in idle state', () => {
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /Avbryt Import/i })).toBeInTheDocument();
  });

  it('calls onClose when Avbryt Import is clicked', async () => {
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /Avbryt Import/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows Avbryt Import button is disabled during loading', async () => {
    ocrMock.mockReturnValue(new Promise(() => {}));
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeFile());
    // After file upload and before OCR completes, the Avbryt button should be disabled
    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /Avbryt Import/i });
      if (btn) expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it('shows error details when OCR throws', async () => {
    ocrMock.mockRejectedValue(new Error('OCR service down'));
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeFile());
    await waitFor(() => expect(screen.getByText(/OCR service down/)).toBeInTheDocument());
  });

  it('shows "Försök Igen" button after error', async () => {
    ocrMock.mockRejectedValue(new Error('network error'));
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeFile());
    await waitFor(() => expect(screen.getByRole('button', { name: /Försök Igen/i })).toBeInTheDocument());
  });

  it('resets to idle when "Försök Igen" is clicked', async () => {
    ocrMock.mockRejectedValue(new Error('fail'));
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeFile());
    await waitFor(() => screen.getByRole('button', { name: /Försök Igen/i }));
    await user.click(screen.getByRole('button', { name: /Försök Igen/i }));
    expect(screen.getByRole('button', { name: /Avbryt Import/i })).toBeInTheDocument();
  });
});
