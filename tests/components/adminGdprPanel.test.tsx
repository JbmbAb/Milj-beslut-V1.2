/**
 * adminGdprPanel.test.tsx
 *
 * Testar AdminGdprPanel-komponenten:
 *   - Renderar rubrik och knappar
 *   - Exporterar personuppgifter (Art. 20) och visar resultat
 *   - Visar felmeddelande om export misslyckas
 *   - Visar underhållsresultat efter maintenance
 *   - Kräver admin-token för skyddade endpoints
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import AdminGdprPanel from '../../components/AdminGdprPanel';

const MOCK_EXPORT_RESULT = {
  userId: 'user-123',
  email: 'test@example.com',
  name: 'Test Testsson',
  exportedAt: '2026-03-23T00:00:00.000Z',
  projects: [],
  documents: [],
  auditEntries: [],
};


function setupFetchMock(responses: Record<string, object>) {
  return vi.spyOn(global, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const urlStr = String(url);
    for (const [key, val] of Object.entries(responses)) {
      if (urlStr.includes(key)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, ...val }),
        } as Response);
      }
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: 'Not found' }),
    } as Response);
  });
}

describe('AdminGdprPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sätt admin-token i localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-admin-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderar rubrik och export-knapp', () => {
    render(<AdminGdprPanel />);
    expect(screen.getByText('GDPR-hantering')).toBeInTheDocument();
    expect(
      screen.getByTestId('gdpr-export-button'),
    ).toBeInTheDocument();
  });

  it('exporterar personuppgifter och visar bekräftelse', async () => {
    setupFetchMock({
      'gdpr/me/export': { data: MOCK_EXPORT_RESULT },
    });

    render(<AdminGdprPanel />);

    const exportBtn = screen.getByRole('button', { name: /Exportera mina uppgifter/i });
    fireEvent.click(exportBtn);

    await waitFor(() =>
      expect(screen.getByText(/Personuppgifter exporterade/i)).toBeInTheDocument(),
    );

    // Download-knapp ska dyka upp
    expect(
      screen.getByRole('button', { name: /Ladda ned JSON/i }),
    ).toBeInTheDocument();
  });

  it('visar felmeddelande om export misslyckas', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: 'Saknar behörighet' }),
    } as Response);

    render(<AdminGdprPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Exportera mina uppgifter/i }));

    await waitFor(() =>
      expect(screen.getByText(/Saknar behörighet/i)).toBeInTheDocument(),
    );
  });

  it('visar underhållsresultat efter maintenance-anrop', async () => {
    setupFetchMock({
      'gdpr/maintenance': {
        ok: true,
        deletedExpiredSessions: 3,
        anonymizedOldAuditEntries: 10,
        purgedSoftDeleted: 2,
      },
    });

    render(<AdminGdprPanel />);

    const maintBtn = screen.getByTestId('gdpr-maintenance-button');
    fireEvent.click(maintBtn);

    await waitFor(() =>
      expect(screen.getByText(/Raderade utgångna sessioner/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('visar varning om admin-token saknas', async () => {
    // Ingen token i localStorage
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ ok: false, error: 'Ingen admin-token – logga in i Admin sökcenter först' }),
    } as Response);

    render(<AdminGdprPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Exportera mina uppgifter/i }));

    await waitFor(() =>
      expect(screen.getByText(/admin-token/i)).toBeInTheDocument(),
    );
  });
});
