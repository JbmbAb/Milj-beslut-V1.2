/**
 * requirementChecklist.test.tsx
 *
 * Testar RequirementChecklist-komponenten:
 *   - Renderar checklistans rubrik
 *   - Visar standardvärden för lagringsposter
 *   - Visar värden från WasteCode-requirements
 *   - Visar extra citations som checklistposter
 *   - Hanterar tom citations-array korrekt
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import RequirementChecklist from '../../components/RequirementChecklist';
import type { WasteCode } from '../../types';
import type { RequirementCitation } from '../../components/RequirementChecklist';

const SAMPLE_CODE: WasteCode = {
  code: '01 01 01',
  name: 'Gruvavfall',
  type: 'EWC',
  requirements: {
    storageTime: 'Max 6 månader',
    maxAmount: '100 ton/år',
    safetyDistance: '50 meter',
    legalReference: 'MB 15 kap 1 §',
  },
};

const SAMPLE_CITATIONS: RequirementCitation[] = [
  {
    id: 'cit-1',
    quoteText: 'Avfall ska förvaras på ett säkert sätt',
    sourceType: 'Lagringstid',
    legalReference: 'MB 15 kap 1 §',
  },
  {
    id: 'cit-2',
    quoteText: 'Maxmängd per kalenderår begränsas',
    sourceType: 'Maxmängd',
    legalReference: 'Avfallsförordningen 3 §',
  },
];

describe('RequirementChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderar checklistans rubrik', () => {
    render(<RequirementChecklist code={SAMPLE_CODE} />);
    expect(screen.getByText(/Checklista för regelefterlevnad/i)).toBeInTheDocument();
  });

  it('visar lagringstid-posten med rätt rubrik', () => {
    render(<RequirementChecklist code={SAMPLE_CODE} />);
    expect(screen.getByText(/Lagringstid/i)).toBeInTheDocument();
  });

  it('visar värde från requirements.storageTime', () => {
    render(<RequirementChecklist code={SAMPLE_CODE} />);
    expect(screen.getByText(/Max 6 månader/i)).toBeInTheDocument();
  });

  it('visar standard-värde för maxmängd när citations ges', () => {
    render(<RequirementChecklist code={SAMPLE_CODE} citations={SAMPLE_CITATIONS} />);
    expect(screen.getByText(/Maxmängd/i)).toBeInTheDocument();
  });

  it('hanterar tom citations-array utan fel', () => {
    render(<RequirementChecklist code={SAMPLE_CODE} citations={[]} />);
    expect(screen.getByText(/Skyddsavstånd/i)).toBeInTheDocument();
  });
});
