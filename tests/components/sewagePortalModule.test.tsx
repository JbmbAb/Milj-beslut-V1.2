import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SewageGISAnalysis, SewageProtectionProfile } from '../../types';

vi.mock('../../components/admin/hooks', () => ({
  useAdminProjectsQuery: vi.fn(() => ({
    data: { projects: [{ id: 'p1', propertyDesignation: 'NACKA BOO 1:2', status: 'ACTIVE' }], total: 1 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('../../components/admin/hooks/usePaginationState', () => ({
  usePaginationState: vi.fn(() => ({
    page: 1,
    pageSize: 10,
    setPage: vi.fn(),
    totalPages: 1,
  })),
}));

vi.mock('../../services/geminiService', () => ({
  askGeneralAssistant: vi.fn().mockResolvedValue('Placeringen uppfyller avståndskrav.'),
}));

vi.mock('../../components/context/OperationsCenterContext', () => ({
  useOperationsCenter: vi.fn(() => ({
    addAiActivity: vi.fn(),
    setInspectorData: vi.fn(),
  })),
}));

vi.mock('../../components/context/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}));

vi.mock('../../components/app/providers/AppWorkspaceProvider', () => ({
  useAppWorkspace: vi.fn(() => ({
    mode: null,
    activeTab: 'summary',
    setActiveTab: vi.fn(),
    setMode: vi.fn(),
    openMode: vi.fn(),
    permits: [],
    selectedPermit: null,
    setSelectedPermit: vi.fn(),
    showUpload: false,
    setShowUpload: vi.fn(),
    modeCardMap: {},
    activeMode: null,
    activeProjectLabel: 'Test project',
  })),
}));

import SewagePortalModule from '../../components/admin/modules/sewage-portal/SewagePortalModule';
import SewageMapView from '../../components/admin/modules/sewage-portal/SewageMapView';

const user = userEvent.setup({ delay: null });

const mockProtectionProfile: SewageProtectionProfile = {
  propertyId: 'prop-test',
  protectionLevel: 'NORMAL',
  reason: 'Normalskyddsnivå',
  nearestWell: {
    distance: 60,
    owner: 'NEIGHBOR',
    coordinates: { lat: 59.33, lng: 18.07 },
  },
  nearestWaterCourse: { distance: 120, type: 'Å', name: 'Testån' },
  distanceToPropertyLine: 6,
  soilProfile: {
    soilType: 'Morän',
    depthToRock: 4,
    groundwaterLevel: 2,
    infiltrationCapacity: 'MEDIUM',
    permeability: 25,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'SOIL_BED',
  timelineEstimateWeeks: 10,
  requiredGates: [],
};

const mockAnalysis: SewageGISAnalysis = {
  propertyId: 'prop-test',
  timestamp: '2025-01-01T00:00:00Z',
  sguJordartData: {
    soilType: 'Morän',
    depthToRock: 4,
    groundwaterLevel: 2,
    loadingCapacity: 'MEDIUM',
  },
  sguBrunnarData: {
    nearestNeighborWells: [{ distance: 60, coordinates: { lat: 59.33, lng: 18.07 } }],
  },
  protectedAreas: [],
  propertyBoundaries: { area: 3000, perimeter: 220, nearestNeighbor: 6 },
  overallRiskScore: 40,
  feasibilityScore: 70,
  recommendedSystems: ['SOIL_BED'],
  blockedSystems: [],
  reasoning: ['Morän kräver markbädd'],
};

describe('SewagePortalModule', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders module title and application list', () => {
    render(<SewagePortalModule />);
    expect(screen.getByRole('heading', { name: /Enskilt Avlopp/i })).toBeInTheDocument();
    expect(screen.getByText(/NACKA BOO 1:2/i)).toBeInTheDocument();
  });

  it('opens new application form modal', async () => {
    render(<SewagePortalModule />);
    await user.click(screen.getByRole('button', { name: /Ny ansökan/i }));
    expect(screen.getByText(/Ny ansökan – Enskilt Avlopp/i)).toBeInTheDocument();
    expect(screen.getByText(/Fastighetsuppgifter/i)).toBeInTheDocument();
  });
});

describe('SewageMapView', () => {
  it('renders placement stats and lock button', () => {
    render(<SewageMapView analysis={mockAnalysis} protectionProfile={mockProtectionProfile} />);
    expect(screen.getByText(/Aktuell Placering/i)).toBeInTheDocument();
    expect(screen.getByText(/Avstånd till brunn/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lås & Kör Miljöanalys/i })).toBeInTheDocument();
  });

  it('runs AI assessment when locking position', async () => {
    render(<SewageMapView analysis={mockAnalysis} protectionProfile={mockProtectionProfile} />);
    await user.click(screen.getByRole('button', { name: /Lås & Kör Miljöanalys/i }));
    expect(await screen.findByText(/Placeringen uppfyller avståndskrav/i)).toBeInTheDocument();
  });
});
