/**
 * smoke.test.tsx
 *
 * Verifierar att React test-miljön (jsdom + @testing-library/react +
 * @testing-library/jest-dom) fungerar korrekt.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

// ── Enkel inline-komponent för smoke-test ──────────────────────────────────

function Greeting({ name }: { name: string }) {
  return <h1>Hej, {name}!</h1>;
}

function Counter() {
  const [count, setCount] = React.useState(0);
  return (
    <div>
      <p data-testid="count">Räknare: {count}</p>
      <button onClick={() => setCount((c) => c + 1)}>Öka</button>
    </div>
  );
}

// ── Tester ─────────────────────────────────────────────────────────────────

describe('React test-miljö (smoke)', () => {
  it('renderar en komponent och hittar text', () => {
    render(<Greeting name="Världen" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hej, Världen!');
  });

  it('jest-dom matchers fungerar (toBeInTheDocument)', () => {
    render(<Greeting name="Test" />);
    expect(screen.getByText('Hej, Test!')).toBeInTheDocument();
  });

  it('userEvent hanterar klick och state-uppdatering', async () => {
    const user = userEvent.setup();
    render(<Counter />);

    expect(screen.getByTestId('count')).toHaveTextContent('Räknare: 0');
    await user.click(screen.getByRole('button', { name: 'Öka' }));
    expect(screen.getByTestId('count')).toHaveTextContent('Räknare: 1');
  });

  it('jsdom tillhandahåller window och document', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
    expect(document.createElement('div')).toBeTruthy();
  });
});
