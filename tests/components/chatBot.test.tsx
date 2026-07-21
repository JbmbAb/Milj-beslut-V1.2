import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatBot from '../../components/ChatBot';

const user = userEvent.setup({ delay: null });

describe('ChatBot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Closed state ────────────────────────────────────────────────────────────

  it('renders the floating toggle button', () => {
    render(<ChatBot />);
    // There is a button with a badge dot - it's always visible in closed state
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('chat panel is not visible when closed', () => {
    render(<ChatBot />);
    expect(screen.queryByText('Legal AI Assistant')).not.toBeInTheDocument();
  });

  // ── Open state ──────────────────────────────────────────────────────────────

  it('opens chat panel when toggle button clicked', async () => {
    render(<ChatBot />);
    const toggleBtn = screen.getAllByRole('button')[0];
    await user.click(toggleBtn);
    expect(screen.getByText('Legal AI Assistant')).toBeInTheDocument();
  });

  it('shows empty-state prompt text when no messages', async () => {
    render(<ChatBot />);
    const toggleBtn = screen.getAllByRole('button')[0];
    await user.click(toggleBtn);
    expect(screen.getByText(/Jag svarar enbart baserat på/)).toBeInTheDocument();
  });

  it('shows textarea and send button when open', async () => {
    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // Send button is a submit button (type=submit)
    const allButtons = screen.getAllByRole('button');
    const submitBtn = allButtons.find((b) => (b as HTMLButtonElement).type === 'submit');
    expect(submitBtn).toBeInTheDocument();
  });

  it('closes panel when × button clicked', async () => {
    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('Legal AI Assistant')).toBeInTheDocument();
    // Find close button (inside header)
    const closeBtn = screen.getAllByRole('button').find((b) => b.className.includes('hover:bg-white/10'));
    if (closeBtn) await user.click(closeBtn);
    expect(screen.queryByText('Legal AI Assistant')).not.toBeInTheDocument();
  });

  // ── Sending a message ───────────────────────────────────────────────────────

  it('shows user message in chat after submitting', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: 'Svar från AI.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    await user.type(screen.getByRole('textbox'), 'Hej AI');
    await user.keyboard('{Enter}');

    expect(screen.getByText('Hej AI')).toBeInTheDocument();
  });

  it('shows AI reply in chat after successful fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: 'Svar från AI.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    await user.type(screen.getByRole('textbox'), 'Test fråga');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('Svar från AI.')).toBeInTheDocument());
  });

  it('shows error message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    await user.type(screen.getByRole('textbox'), 'Test');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Jag kunde tyvärr inte svara/)).toBeInTheDocument());
  });

  it('shows session-missing message on 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: 'Unauthorized' }),
      }),
    );

    render(<ChatBot />);
    await user.click(screen.getAllByRole('button')[0]);
    await user.type(screen.getByRole('textbox'), 'Test');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Session saknas/)).toBeInTheDocument());
  });
});
