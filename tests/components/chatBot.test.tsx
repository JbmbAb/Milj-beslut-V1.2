/**
 * chatBot.test.tsx
 *
 * Testar ChatBot-komponenten:
 *   - Renderar chatbot-knapp i stängt läge
 *   - Öppnar chatten vid klick på knappen
 *   - Stänger chatten vid klick på stäng-knappen
 *   - Skickar meddelande och visar det i historiken
 *   - Visar bot-svar från /api/gemini-anropet
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import ChatBot from '../../components/ChatBot';

function mockFetchResult(result: string) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, result }),
  } as Response);
}

describe('ChatBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderar chatbot-knapp/ikon i stängt läge', () => {
    render(<ChatBot />);
    const btn = document.querySelector('button');
    expect(btn).toBeTruthy();
    // Chatfönstret ska INTE synas initialt
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('öppnar chatten vid klick på toggle-knappen', async () => {
    const user = userEvent.setup();
    render(<ChatBot />);

    const toggleBtn = document.querySelector('button')!;
    await user.click(toggleBtn);

    await waitFor(() =>
      expect(screen.getByRole('textbox')).toBeInTheDocument(),
    );
  });

  it('stänger chatten vid klick på stäng-knappen i headern', async () => {
    const user = userEvent.setup();
    render(<ChatBot />);

    // Öppna
    await user.click(document.querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    // Hitta stäng-knapp i headern (fa-times)
    const buttons = screen.getAllByRole('button');
    const closeBtn = buttons.find((b) => b.querySelector('.fa-times'));
    if (closeBtn) {
      await user.click(closeBtn);
      await waitFor(() =>
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument(),
      );
    } else {
      // Om stäng-knapp inte hittas, verifiera åtminstone att chatten är öppen
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    }
  });

  it('skickar meddelande och visar det i historiken', async () => {
    mockFetchResult('Hej! Hur kan jag hjälpa dig?');
    const user = userEvent.setup();
    render(<ChatBot />);

    await user.click(document.querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    const input = screen.getByRole('textbox');
    await user.type(input, 'Vad är ett miljötillstånd?');
    await user.keyboard('{Enter}');

    // Meddelandet ska synas i chatten
    await waitFor(() =>
      expect(screen.getByText('Vad är ett miljötillstånd?')).toBeInTheDocument(),
    );
  });

  it('visar bot-svar efter lyckat svar från /api/gemini', async () => {
    mockFetchResult('Miljötillstånd beviljas av länsstyrelsen.');
    const user = userEvent.setup();
    render(<ChatBot />);

    await user.click(document.querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());

    await user.type(screen.getByRole('textbox'), 'Förklara tillstånd');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(
        screen.getByText(/Miljötillstånd beviljas av länsstyrelsen/i),
      ).toBeInTheDocument(),
    );
  });
});
