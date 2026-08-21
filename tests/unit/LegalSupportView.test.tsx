import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LegalSupportView } from '../../components/legal/LegalSupportView';
import * as legalAnswerClient from '../../src/ui/api-client/legalAnswer.client';
import type { LegalAnswerResponse } from '../../src/ui/api-client/legalAnswer.client';

// LEGAL-ANSWER-PRODUCT-WIRING-01, proof P7: the UI renders returned citations -- using the real
// component code and a realistic mocked API response, never a stub of the rendering itself.
describe('LegalSupportView', () => {
  it('renders claims and their exact citations from a real-shaped ANSWERED response', async () => {
    const response: LegalAnswerResponse = {
      ok: true,
      contract_version: 'legal-answer-serving-v1',
      mode: 'ANSWERED',
      query_run_identity: 'a'.repeat(64),
      retrieval: { results_count: 6 },
      answer_trace: {
        contract_version: 'legal-answer-trace-v1',
        mode: 'ANSWERED',
        query_run_identity: 'a'.repeat(64),
        context_policy_version: 'legal-answer-context-v1',
        cited_fragment_ids: ['frag:abc123'],
        answer_model_id: 'gemini-2.5-flash',
        answer_model_version: '2.5',
        answer_pipeline_version: 'answer-pipeline-gemini-v1',
        answer_trace_hash: 'b'.repeat(64),
      },
      query_specificity: { verdict: 'SPECIFIED', reason: null },
      named_source_consistency: null,
      claims: [
        {
          text: 'Miljöbalkens mål är att främja en hållbar utveckling.',
          citations: [
            {
              citation_id: 'c'.repeat(64),
              fragment_id: 'frag:abc123',
              materialization_id: 'mat:xyz789',
              source_provenance_refs: ['materialization:mat:xyz789'],
              rank: 1,
              score: 0.91,
              query_run_identity: 'a'.repeat(64),
            },
          ],
        },
      ],
    };

    vi.spyOn(legalAnswerClient, 'queryLegalAnswer').mockResolvedValue(response);

    render(<LegalSupportView />);

    fireEvent.change(screen.getByTestId('legal-support-query-input'), {
      target: { value: 'Vad är miljöbalkens mål?' },
    });
    fireEvent.click(screen.getByTestId('legal-support-submit'));

    await waitFor(() => expect(screen.getByTestId('legal-support-result')).toBeInTheDocument());

    expect(screen.getByText(/Miljöbalkens mål är att främja en hållbar utveckling/)).toBeInTheDocument();
    const citation = screen.getByTestId('legal-support-citation');
    expect(citation).toHaveTextContent('frag:abc123');
    expect(citation).toHaveTextContent('mat:xyz789');
    expect(citation).toHaveTextContent('materialization:mat:xyz789');
  });

  it('renders the NAMED_SOURCE_NOT_AVAILABLE banner and no claims when the safety gate blocks', async () => {
    const response: LegalAnswerResponse = {
      ok: true,
      contract_version: 'legal-answer-serving-v1',
      mode: 'NAMED_SOURCE_NOT_AVAILABLE',
      query_run_identity: 'a'.repeat(64),
      retrieval: { results_count: 6 },
      answer_trace: {
        contract_version: 'legal-answer-trace-v1',
        mode: 'NAMED_SOURCE_NOT_AVAILABLE',
        query_run_identity: 'a'.repeat(64),
        context_policy_version: 'legal-answer-context-v1',
        cited_fragment_ids: [],
        answer_model_id: 'gemini-2.5-flash',
        answer_model_version: '2.5',
        answer_pipeline_version: 'answer-pipeline-gemini-v1',
        answer_trace_hash: 'b'.repeat(64),
      },
      query_specificity: { verdict: 'SPECIFIED', reason: null },
      named_source_consistency: {
        verdict: 'NAMED_SOURCE_NOT_AVAILABLE',
        named_known_source_ids: [],
        unrecognized_statute_mentions: ['fiskelagen'],
        missing_source_ids: [],
        reason: "query names a statute-shaped reference (fiskelagen) not recognized among this corpus's known sources",
      },
      claims: [],
    };

    vi.spyOn(legalAnswerClient, 'queryLegalAnswer').mockResolvedValue(response);

    render(<LegalSupportView />);
    fireEvent.change(screen.getByTestId('legal-support-query-input'), {
      target: { value: 'Vad säger fiskelagen om fiskevård?' },
    });
    fireEvent.click(screen.getByTestId('legal-support-submit'));

    await waitFor(() => expect(screen.getByTestId('legal-support-result')).toBeInTheDocument());

    expect(screen.getByText(/fiskelagen/)).toBeInTheDocument();
    expect(screen.queryByTestId('legal-support-claim')).not.toBeInTheDocument();
  });
});
