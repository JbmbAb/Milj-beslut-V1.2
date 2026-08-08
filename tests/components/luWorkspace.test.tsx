import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

const fetchPropertyInfo = vi.fn();
const callApi = vi.fn();
const getActiveProjectId = vi.fn(() => 'proj-1');

vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => getActiveProjectId(),
}));

describe('LuWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up property and runs assessment without LocalizationStudyUI', async () => {
    const user = userEvent.setup();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1',
      designation: 'GÄVLE BRYNÄS 1:1',
      municipality: 'Gävle',
      centroid: { lat: 60.67, lng: 17.14 },
    });
    callApi.mockResolvedValue({
      ok: true,
      projectId: 'proj-1',
      siteAnalyses: [
        {
          complianceAnalysis: {
            overallRisk: 'MEDIUM',
            permitProbability: 0.5,
            requiredActions: ['Kontrollera brunn'],
            notes: ['Nära vatten'],
          },
          executionMotor: {
            admitted: true,
            attempt_id: 'att-1',
            outcome_id: 'out-1',
            manifest_id: 'man-1',
            assessment_artifact_id: 'assess-site-1-abc',
            property_context_id: 'prop-site-1',
            finding_ids: ['LU-WATER-001'],
          },
        },
      ],
      humanInTheLoop: 'Human in the loop',
    });

    render(<LuWorkspace />);
    expect(screen.getByTestId('lu-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('localization-study-ui')).not.toBeInTheDocument();

    await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
    await user.click(screen.getByTestId('lu-lookup'));
    expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();

    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-risk')).toHaveTextContent('MEDIUM');
    expect(screen.getByTestId('lu-assessment-id')).toHaveTextContent('assess-site-1-abc');
    expect(screen.getByTestId('lu-property-context-id')).toHaveTextContent('prop-site-1');
    expect(screen.getByTestId('lu-finding-ids')).toHaveTextContent('LU-WATER-001');
    expect(callApi).toHaveBeenCalledWith(
      '/api/localization/generate-report',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
