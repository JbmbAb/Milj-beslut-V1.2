import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatBot from '../../components/ChatBot';

const user = userEvent.setup({ delay: null });

// PRODUCT-RUNTIME-ANSWER-BYPASS-01: ChatBot is now a non-generative launcher into the governed
// Juridiskt Stöd view -- it makes zero network calls and holds zero conversation state. These
// tests replace the old freeform-chat suite (which exercised /api/gemini directly).
describe('ChatBot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a single launcher button', () => {
    render(<ChatBot onOpenLegalSupport={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('calls onOpenLegalSupport when clicked, and makes no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onOpenLegalSupport = vi.fn();

    render(<ChatBot onOpenLegalSupport={onOpenLegalSupport} />);
    await user.click(screen.getByRole('button'));

    expect(onOpenLegalSupport).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never renders a chat panel, textarea, or message list', () => {
    render(<ChatBot onOpenLegalSupport={vi.fn()} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Legal AI Assistant')).not.toBeInTheDocument();
  });
});
