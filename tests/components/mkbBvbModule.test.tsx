import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import MkbBvbModule from '../../components/MkbBvbModule';

describe('MkbBvbModule', () => {
  // ── Initial render ───────────────────────────────────────────────────────

  it('renders the module heading', () => {
    render(<MkbBvbModule />);
    expect(screen.getByText('Behovsbedömning & MKB')).toBeInTheDocument();
  });

  it('shows the description text', () => {
    render(<MkbBvbModule />);
    expect(
      screen.getByText(/Identifiera om verksamheten innebär betydande miljöpåverkan/i),
    ).toBeInTheDocument();
  });

  it('renders all BVB criteria labels', () => {
    render(<MkbBvbModule />);
    expect(screen.getByText(/Inom eller nära skyddat område/i)).toBeInTheDocument();
    expect(screen.getByText(/Betydande påverkan på vatten/i)).toBeInTheDocument();
    expect(screen.getByText(/Stora mängder avfall/i)).toBeInTheDocument();
    expect(screen.getByText(/Påverkan på kulturmiljö/i)).toBeInTheDocument();
  });

  it('renders all criteria descriptions', () => {
    render(<MkbBvbModule />);
    expect(screen.getByText(/Ligger verksamheten inom ett Natura 2000-område/i)).toBeInTheDocument();
  });

  // ── Button states ────────────────────────────────────────────────────────

  it('renders "Generera MKB-utkast" button', () => {
    render(<MkbBvbModule />);
    const button = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    expect(button).toBeInTheDocument();
  });

  it('button is disabled until all criteria are answered', () => {
    render(<MkbBvbModule />);
    const button = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    expect(button).toBeDisabled();
  });

  it('button becomes enabled when all criteria are answered', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    // Answer all criteria with "Nej"
    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(0, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    expect(generateButton).not.toBeDisabled();
  });

  // ── User interactions ────────────────────────────────────────────────────

  it('highlights "Nej" button when clicked', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const firstNoButton = screen.getAllByRole('button', { name: 'Nej' })[0];
    await user.click(firstNoButton);

    expect(firstNoButton).toHaveClass('bg-emerald-600');
    expect(firstNoButton).toHaveClass('text-white');
  });

  it('highlights "Ja" button when clicked', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const firstJaButton = screen.getAllByRole('button', { name: 'Ja' })[0];
    await user.click(firstJaButton);

    expect(firstJaButton).toHaveClass('bg-rose-600');
    expect(firstJaButton).toHaveClass('text-white');
  });

  // ── MKB generation ──────────────────────────────────────────────────────

  it('shows "Genererar utkast..." text while generating', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(0, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    expect(screen.getByText(/Genererar utkast/i)).toBeInTheDocument();
  }, 10000);

  it('displays MKB draft after generation completes', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(0, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    await waitFor(
      () => {
        expect(screen.getByText(/Miljökonsekvensbeskrivning/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  }, 10000);

  it('shows "Ej betydande miljöpåverkan" in draft when all answered "Nej"', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(0, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    await waitFor(
      () => {
        expect(screen.getByText(/bedöms inte medföra betydande miljöpåverkan/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  }, 10000);

  it('shows "Betydande miljöpåverkan" in draft when any criterion is "Ja"', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const jaButtons = screen.getAllByRole('button', { name: 'Ja' });
    await user.click(jaButtons[0]);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(1, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    await waitFor(
      () => {
        expect(screen.getByText(/krävs en fullständig MKB/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  }, 10000);

  // ── Draft display ───────────────────────────────────────────────────────

  it('shows "Dokumentutkast" heading', () => {
    render(<MkbBvbModule />);
    expect(screen.getByText(/Dokumentutkast/i)).toBeInTheDocument();
  });

  it('shows download button in draft section', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(0, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    await waitFor(
      () => {
        const downloadBtn = screen.getByRole('button', { name: /Ladda ner som PDF/i });
        expect(downloadBtn).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  }, 10000);

  it('shows empty state placeholder before draft is generated', () => {
    render(<MkbBvbModule />);
    expect(screen.getByText(/Fyll i behovsbedömningen för att generera MKB/i)).toBeInTheDocument();
  });

  // ── Criteria status display ──────────────────────────────────────────────

  it('includes criteria status in generated draft', async () => {
    const user = userEvent.setup();
    render(<MkbBvbModule />);

    const jaButtons = screen.getAllByRole('button', { name: 'Ja' });
    await user.click(jaButtons[0]);

    const noButtons = screen.getAllByRole('button', { name: 'Nej' });
    for (const btn of noButtons.slice(1, 4)) {
      await user.click(btn);
    }

    const generateButton = screen.getByRole('button', { name: /Generera MKB-utkast/i });
    await user.click(generateButton);

    await waitFor(
      () => {
        expect(screen.getByText(/Behovsbedömning \(BVB\)/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  }, 10000);
});
