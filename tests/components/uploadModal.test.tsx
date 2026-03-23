/**
 * uploadModal.test.tsx
 *
 * Testar UploadModal-komponenten:
 *   - Renderar i idle-läge med uppladdningsikon
 *   - Stänger modal när "Avbryt"-knapp klickas
 *   - Visar loading-spinner och meddelande under filanalys
 *   - Visar felmeddelande när OCR misslyckas
 *   - Anropar onComplete med extraherade data vid lyckat uppladdning
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/geminiService', () => ({
  processDocumentOCR: vi.fn(),
}));

import { processDocumentOCR } from '../../services/geminiService';
import UploadModal from '../../components/UploadModal';

const mockOCR = processDocumentOCR as ReturnType<typeof vi.fn>;

const FAKE_DATA_URL = 'data:application/pdf;base64,ZHVtbXk=';

/**
 * Hjälpklass: en FileReader-mock som triggar onload asynkront
 * (efter att komponenten hunnit sätta reader.onload).
 */
class MockFileReader {
  result: string = FAKE_DATA_URL;
  onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((e: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(_file: Blob) {
    // Mikrotask → onload triggas EFTER att EventHandler är satt
    Promise.resolve().then(() => {
      if (this.onload) {
        this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    });
  }
}

function installFileReaderMock() {
  vi.stubGlobal('FileReader', MockFileReader);
}

describe('UploadModal', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    installFileReaderMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renderar i idle-läge med uppladdningsikon', () => {
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    expect(document.querySelector('.fa-cloud-upload-alt')).toBeTruthy();
  });

  it('anropar onClose när Avbryt-knapp klickas i idle-läge', async () => {
    const user = userEvent.setup();
    render(<UploadModal onComplete={onComplete} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /Avbryt/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('visar loading-spinner när fil bearbetas (OCR hänger)', async () => {
    mockOCR.mockReturnValue(new Promise(() => {})); // aldrig klar

    render(<UploadModal onComplete={onComplete} onClose={onClose} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'permit.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    // Vänta på att MockFileReader triggar onload och OCR startar
    await waitFor(() =>
      expect(mockOCR).toHaveBeenCalledTimes(1),
    );

    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('visar felmeddelande när OCR kastar ett fel', async () => {
    mockOCR.mockRejectedValue(new Error('OCR tjänsten är nere'));

    render(<UploadModal onComplete={onComplete} onClose={onClose} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText(/Ett fel uppstod vid analysen/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(document.querySelector('.fa-exclamation-triangle')).toBeTruthy();
  });

  it('anropar onComplete med extraherade data efter lyckad OCR', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const mockResult = { title: 'Miljötillstånd', municipality: 'Haninge', status: 'BIFALL' };
    mockOCR.mockResolvedValue(mockResult);

    render(<UploadModal onComplete={onComplete} onClose={onClose} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'permit.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    // Vänta på success-ikon
    await waitFor(
      () => expect(document.querySelector('.fa-check-circle')).toBeTruthy(),
      { timeout: 3000 },
    );

    // Advance setTimeout (1200ms) för att trigga onComplete
    vi.advanceTimersByTime(1500);

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ ...mockResult, filename: 'permit.pdf' }),
      ),
    );

    vi.useRealTimers();
  });
});
