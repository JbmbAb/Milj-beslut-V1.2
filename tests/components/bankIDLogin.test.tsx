/**
 * bankIDLogin.test.tsx
 *
 * Testar BankIDLogin-komponenten:
 *   - Renderar välkomstvy med personnummer-inmatning
 *   - Knapp inaktiv om personnummer < 12 siffror
 *   - Knapp aktiv och klickbar med 12-siffrigt personnummer
 *   - Övergår till SCAN-steg när formuläret skickas
 *   - Anropar onLogin-callback efter lyckad autentisering
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock motion/react since animations aren't important in tests
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) =>
      React.createElement('div', props, children),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

import BankIDLogin from '../../components/BankIDLogin';

describe('BankIDLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderar välkomstvy med personnummer-inmatning', () => {
    render(<BankIDLogin onLogin={vi.fn()} />);
    expect(screen.getByText(/Välkommen/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/198501011234/i)).toBeInTheDocument();
  });

  it('knapp är inaktiv om personnummer < 12 siffror', () => {
    render(<BankIDLogin onLogin={vi.fn()} />);

    const input = screen.getByPlaceholderText(/198501011234/i);
    fireEvent.change(input, { target: { value: '12345' } });

    const btn = screen.getByRole('button', { name: /Öppna BankID/i });
    fireEvent.click(btn);
    // Fortfarande på IDLE-steget
    expect(screen.getByText(/Välkommen/i)).toBeInTheDocument();
  });

  it('accepterar exakt 12 siffror och begränsar fler', () => {
    render(<BankIDLogin onLogin={vi.fn()} />);

    const input = screen.getByPlaceholderText(/198501011234/i);
    // Input onChange strippas via .replace(/\D/g,'').slice(0,12)
    fireEvent.change(input, { target: { value: '19850101123456' } });

    expect((input as HTMLInputElement).value).toBe('198501011234');
  });

  it('byter till SCAN-steg med 12-siffrigt personnummer', () => {
    vi.useFakeTimers();
    render(<BankIDLogin onLogin={vi.fn()} />);

    const input = screen.getByPlaceholderText(/198501011234/i);
    fireEvent.change(input, { target: { value: '198501011234' } });
    fireEvent.click(screen.getByRole('button', { name: /Öppna BankID/i }));

    // SCAN-steget ska visa QR-relaterad text
    expect(screen.getByText(/Väntar på BankID/i)).toBeInTheDocument();
    expect(screen.getByText(/Skanna QR-koden/i)).toBeInTheDocument();
  });

  it('anropar onLogin-callback efter lyckad autentisering (timers)', async () => {
    vi.useFakeTimers();
    const onLogin = vi.fn();
    render(<BankIDLogin onLogin={onLogin} />);

    const input = screen.getByPlaceholderText(/198501011234/i);
    fireEvent.change(input, { target: { value: '198501011234' } });
    fireEvent.click(screen.getByRole('button', { name: /Öppna BankID/i }));

    // SCAN-steget är nu aktivt
    expect(screen.getByText(/Väntar på BankID/i)).toBeInTheDocument();

    // Steg 1: SCAN → SUCCESS (3 s)
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/Inloggad!/i)).toBeInTheDocument();

    // Steg 2: SUCCESS → onLogin (ytterligare 1,5 s)
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(onLogin).toHaveBeenCalledTimes(1);
    const user_arg = onLogin.mock.calls[0][0];
    expect(user_arg).toMatchObject({
      id: 'u1',
      name: 'Erik Andersson',
      personalNumber: '198501011234',
      isAuthenticated: true,
    });
  });
});
