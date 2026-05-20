import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCsrfTokenCache } from '../../services/csrfClient';
import PropertyRegisterExtract from '../../components/PropertyRegisterExtract';

describe('PropertyRegisterExtract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    resetCsrfTokenCache();
    vi.unstubAllGlobals();
  });

  it('shows no-selection state when propertyId is empty', () => {
    render(<PropertyRegisterExtract propertyId="" />);
    expect(screen.getByText('Ingen verifierad fastighet vald')).toBeInTheDocument();
  });

  it('shows no-selection state when propertyId is whitespace only', () => {
    render(<PropertyRegisterExtract propertyId="   " />);
    expect(screen.getByText('Ingen verifierad fastighet vald')).toBeInTheDocument();
  });

  it('shows fetch error state when register lookup fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockRejectedValueOnce(new Error('NÃ¤tverksfel'));

    render(<PropertyRegisterExtract propertyId="AB1234" />);

    await waitFor(() => {
      expect(screen.getByText('Fastighetsuppslag misslyckades')).toBeInTheDocument();
    });
  });

  it('displays the propertyId in the active state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            designation: 'SE-12345',
            geometry: null,
          },
        }),
      } as Response);

    render(<PropertyRegisterExtract propertyId="SE-12345" />);

    await waitFor(() => {
      expect(screen.getByText('Fastighetsutdrag')).toBeInTheDocument();
    });
    expect(screen.getAllByText('SE-12345').length).toBeGreaterThan(0);
  });

  it('shows extracted municipality and missing-geometry state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            designation: 'XYZ 1:23',
            geometry: null,
          },
        }),
      } as Response);

    render(<PropertyRegisterExtract propertyId="XYZ" />);

    await waitFor(() => {
      expect(screen.getAllByText('XYZ 1:23').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('XYZ').length).toBeGreaterThan(0);
    expect(screen.getByText('Ingen geometri tillgänglig')).toBeInTheDocument();
  });

  it('shows Lantmateriet details and raw response access', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'csrf-123' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            designation: 'ORSA STACKMORA 3:12>2',
            geometry: { type: 'Polygon', coordinates: [] },
            boundaries: {
              properties: {
                kommunnamn: 'ORSA',
                trakt: 'STACKMORA',
                objektidentitet: 'obj-123',
              },
            },
            ownership: {
              ownerType: 'PRIVATE',
              share: '1/1',
            },
          },
        }),
      } as Response);

    render(<PropertyRegisterExtract propertyId="ORSA STACKMORA 3:12 (2)" />);

    await waitFor(() => {
      expect(screen.getByText('Fastighetsdata')).toBeInTheDocument();
    });
    expect(screen.getByText('obj-123')).toBeInTheDocument();
    expect(screen.getByText('PRIVATE')).toBeInTheDocument();
    expect(screen.getByText('Visa hela LM-svaret')).toBeInTheDocument();
  });

  it('does not show live-utdrag section when propertyId is empty', () => {
    render(<PropertyRegisterExtract propertyId="" />);
    expect(screen.queryByText('Fastighetsuppslag misslyckades')).not.toBeInTheDocument();
  });
});
