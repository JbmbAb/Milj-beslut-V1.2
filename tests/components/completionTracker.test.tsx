import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CompletionTracker from '../../components/admin/CompletionTracker';
import type { AppCompletionResponse } from '../../types';

const completion: AppCompletionResponse = {
  checkedAt: '2024-06-01T12:00:00.000Z',
  donePercent: 72,
  remainingPercent: 28,
  counts: { total: 50, done: 36, partial: 4, pending: 10 },
  categories: [
    {
      name: 'Karta',
      total: 5,
      done: 5,
      partial: 0,
      pending: 0,
      percent: 100,
      features: [{ id: 'f1', label: 'Kartvy', category: 'Karta', status: 'DONE' }],
    },
    {
      name: 'AI',
      total: 10,
      done: 5,
      partial: 2,
      pending: 3,
      percent: 50,
      features: [
        { id: 'f2', label: 'Klassificering', category: 'AI', status: 'PARTIAL', note: 'Beta' },
        { id: 'f3', label: 'RAG', category: 'AI', status: 'PENDING' },
      ],
    },
  ],
};

describe('CompletionTracker', () => {
  it('renders nothing when hasActiveSession is false', () => {
    const { container } = render(<CompletionTracker appCompletion={completion} hasActiveSession={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders loading placeholder when appCompletion is null', () => {
    render(<CompletionTracker appCompletion={null} hasActiveSession />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('shows done percentage', () => {
    render(<CompletionTracker appCompletion={completion} hasActiveSession />);
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('shows remaining percentage text', () => {
    render(<CompletionTracker appCompletion={completion} hasActiveSession />);
    expect(screen.getByText(/28% återstår/)).toBeInTheDocument();
  });

  it('renders the completion bar', () => {
    render(<CompletionTracker appCompletion={completion} hasActiveSession />);
    expect(screen.getByTestId('completion-bar')).toBeInTheDocument();
  });

  it('shows category details after clicking Visa detaljer', () => {
    render(<CompletionTracker appCompletion={completion} hasActiveSession />);
    fireEvent.click(screen.getByText('Visa detaljer'));
    expect(screen.getByText('Karta')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('hides category details after toggling back', () => {
    render(<CompletionTracker appCompletion={completion} hasActiveSession />);
    fireEvent.click(screen.getByText('Visa detaljer'));
    fireEvent.click(screen.getByText('Dölj detaljer'));
    expect(screen.queryByText('Karta')).not.toBeInTheDocument();
  });
});
