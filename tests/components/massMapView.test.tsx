import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MassMapView from '../../components/admin/modules/c-notification-mass/MassMapView';
import type { MassGISAnalysis, MassSiteProfile } from '../../types';

const analysis: MassGISAnalysis = {
  propertyDesignation: 'STOCKHOLM 1:1',
  timestamp: new Date().toISOString(),
  centroid: { lat: 59.33, lng: 18.07 },
  siteConstraints: [{ code: 'NVR', label: 'Skyddad natur', severity: 'MEDIUM' }],
  overallRiskScore: 42,
  logisticsSuitability: 'REVIEW_REQUIRED',
  warnings: [],
  reasoning: [],
};

const siteProfile: MassSiteProfile = {
  propertyDesignation: 'STOCKHOLM 1:1',
  centroid: { lat: 59.33, lng: 18.07 },
  source: 'test',
  recommendedZones: [{ id: 'z1', label: 'Mellanlagring A', operationType: 'MELLANLAGRING', offsetM: 40 }],
};

describe('MassMapView', () => {
  it('renders recommended zones and required MPF map layers', () => {
    render(
      <MassMapView
        analysis={analysis}
        siteProfile={siteProfile}
        requiredMapLayers={['NATURA2000', 'GROUNDWATER']}
      />,
    );

    expect(screen.getByText(/Situationsöversikt — masslogistik/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Mellanlagring A/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('MPF-lager: NATURA2000, GROUNDWATER');
  });
});
