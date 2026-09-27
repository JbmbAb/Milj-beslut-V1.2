/**
 * DEMO-01 view: shows only server rows with their source line, approval needs a decision per row,
 * and there is no submit control.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callApi = vi.fn();
vi.mock('../../../../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'project-1',
}));

import { CAnmalanDemoView } from '../../CAnmalanDemoView';

const rows = [
  { id: 'user-verksamhetsutovare', section: 'verksamhetsutovare', label: 'Verksamhetsutövare', text: 'användarens uppgift – ej ifylld', provenance: { kind: 'user_input', field: 'verksamhetsutovare' } },
  { id: 'lok-jordart', section: 'lokalisering', label: 'Jordart', text: 'ej analyserat – underlag ofullständigt: x',
    provenance: { kind: 'mimer_layer', layer: 'env.sgu_soil_type_25k_100k', datasetVersion: null, bundleSha256: null, query: 'q' } },
];

const baseCase = { id: 'demo01-abc123-00000000', createdAt: '', updatedAt: '', createdByUserId: 'u', organisationId: 'o', status: 'DRAFT' };

beforeEach(() => {
  callApi.mockReset();
  callApi.mockImplementation(async (url: string, opts: { method?: string; body?: any }) => {
    if (url.endsWith('/status')) return { ok: true, releaseSha: 'abc123', requirements: { state: 'missing', dir: 'x', message: 'inte levererad' } };
    if (url.endsWith('/cases') && opts.method === 'POST') return { case: { ...baseCase, input: opts.body.input } };
    if (url.endsWith('/proposal')) return { case: { ...baseCase, status: 'PROPOSED', proposal: { generatedAt: 'now', rows, inputs: { requirements: { state: 'missing', dir: 'x', message: 'inte levererad' }, localizationLabel: 'Lokalisering: ej governed', legalCorpusCaveat: '' } } } };
    if (url.endsWith('/approve')) return { case: { ...baseCase, status: 'APPROVED', approval: { frozenSha256: 'f'.repeat(64), releaseSha: 'abc123', approvedAt: '', approvedByUserId: 'u', frozenPath: 'x' } } };
    if (url.endsWith('/audit-trail')) return { entries: [] };
    throw new Error(`unexpected ${url}`);
  });
});

describe('CAnmalanDemoView', () => {
  it('walks case → proposal → radvis approval, with sources shown and no submit', async () => {
    render(<CAnmalanDemoView onExit={() => undefined} />);
    await screen.findByText(/Release:/);
    fireEvent.change(screen.getByPlaceholderText('Fastighetsbeteckning'), { target: { value: 'testby 1:1' } });
    fireEvent.click(screen.getByLabelText('90.40'));
    fireEvent.click(screen.getByText('Skapa ärende'));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith('/api/demo/c-anmalan/cases', expect.objectContaining({ method: 'POST' })));
    expect(callApi.mock.calls.find((c) => c[0] === '/api/demo/c-anmalan/cases')![1].body.input).toMatchObject({
      propertyDesignation: 'TESTBY 1:1', verksamhetskoder: ['90.40'], placeholder: true,
    });

    fireEvent.click(screen.getByText('Ta fram förslag'));
    await screen.findByTestId('proposal');
    expect(screen.getByText('Källa: användarens uppgift')).toBeTruthy();
    expect(screen.getByText(/Källa: Mimer-lager env.sgu_soil_type_25k_100k/)).toBeTruthy();
    expect(screen.getByText(/Inga förslag ur kommunkorpusen: inte levererad/)).toBeTruthy();

    const approve = screen.getByTestId('approve') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getAllByText('Godta')[0]);
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getAllByText('Stryk')[1]);
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);

    await screen.findByTestId('approved');
    const body = callApi.mock.calls.find((c) => String(c[0]).endsWith('/approve'))![1].body;
    expect(body.decisions).toEqual([
      { rowId: 'user-verksamhetsutovare', action: 'accept' },
      { rowId: 'lok-jordart', action: 'strike' },
    ]);
    expect(screen.getByText('PDF: C-anmälan – förslag, ej inlämnad')).toBeTruthy();
    // Approved = locked: no silent save or new proposal; reopening is explicit and confirmed.
    expect(screen.getByTestId('locked')).toBeTruthy();
    expect((screen.getByText('Spara ändrade uppgifter') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Ta fram förslag') as HTMLButtonElement).disabled).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByTestId('reopen'));
    expect((screen.getByText('Spara ändrade uppgifter') as HTMLButtonElement).disabled).toBe(true);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('reopen'));
    expect((screen.getByText('Spara ändrade uppgifter') as HTMLButtonElement).disabled).toBe(false);
    confirm.mockRestore();
    expect(screen.queryByText(/skicka in|lämna in/i)).toBeNull();
  });

  it('says the demo is not enabled when the server route is absent', async () => {
    callApi.mockRejectedValueOnce(new Error('HTTP 404'));
    render(<CAnmalanDemoView onExit={() => undefined} />);
    expect((await screen.findByTestId('demo-disabled')).textContent).toMatch(/inte aktiverad/);
  });
});
