/**
 * K0b (DOC-EVIDENCE-CENSUS 2026-10-02) -- the server now returns a machine-readable document check:
 * an extra `governed_layer_checks` element `{ layer: 'document', ... }` in the fresh generate-report
 * response and a `documentCheck` field in GET current-assessment. This file only proves the CURRENT
 * LuWorkspace tolerates both (renders the governed result and the existing checks, no crash). It
 * deliberately asserts nothing about how the document check is displayed: that is the UI lane's
 * (M2b) decision, and no UI file is changed here.
 *
 * Hermetic: callApi / fetchPropertyInfo / Cesium are mocked exactly as in luWorkspace.test.tsx.
 */
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
vi.mock('../../src/ui/api-client/geo.client', () => ({
  fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args),
}));
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'proj-1',
}));
vi.mock('../../components/CesiumMapView', () => ({
  default: () => <div data-testid="cesium-map-view" />,
}));
vi.mock('../../components/cesium/EvidenceDetailsPanel', () => ({
  default: () => <div data-testid="evidence-details-panel" />,
}));

const NO_CURRENT_ASSESSMENT_MESSAGE = 'No current governed LU assessment is available for this project.';
const ASSESSMENT_ID = 'assessment-k0-doc';
const FINDING = {
  finding_id: 'finding-water-k0',
  rule_id: 'LU-WATER-001',
  rule_version: '1.0',
  risk_level: 'MEDIUM',
  explanation: 'Närhet till vatten kräver analys',
  evidence_refs: [{ artifact_id: 'evidence-water-k0', artifact_type: 'SPATIAL_EVIDENCE' }],
};
/** Exactly what the server now emits (server/modules/localization/governedLayerChecks.ts). */
const DOCUMENT_CHECK = {
  layer: 'document',
  rule_id: 'LU-DOC-BESLUT-001',
  status: 'NOT_CHECKED',
  evidence_artifact_id: null,
  reason: 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED',
  message_sv:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningen innehåller inget verifierat dokumentbevis ' +
    'för fastigheten. Att inga dokumentfynd visas betyder inte att det saknas tidigare beslut.',
};

function viewerEvidence() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: null,
        properties: {
          cas_artifact_id: 'evidence-water-k0', dataset: 'water', layer_id: 'water', exists: true,
          distance_meters: 500, match_count_observed: 1, max_features_per_layer: 50,
          result_semantics_kind: 'EXISTENCE_WITHIN_DISTANCE', governance_status: 'VERIFIED_OBSERVATION',
        },
      },
    ],
  };
}

function mockApi(options: { persistedFromStart: boolean }) {
  let persisted = options.persistedFromStart;
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) {
      if (!persisted) return Promise.reject(new Error(NO_CURRENT_ASSESSMENT_MESSAGE));
      return Promise.resolve({
        ok: true,
        assessmentArtifactId: ASSESSMENT_ID,
        findings: [FINDING],
        ruleRefs: [],
        evidenceRefs: FINDING.evidence_refs,
        systemSummary: 'Governed LU assessment: 1 spatial evidence, 0 document evidence.',
        localizationGeometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', provenance_label_sv: 'Angiven' },
        documentCheck: DOCUMENT_CHECK,
      });
    }
    if (url.includes('/viewer/evidence')) return Promise.resolve(viewerEvidence());
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'user_defined', wgs84LngLat: [17.14, 60.67], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/generate-report')) {
      persisted = true;
      return Promise.resolve({
        ok: true,
        projectId: 'proj-1',
        siteAnalyses: [
          {
            documentEvidence: [],
            executionMotor: {
              admitted: true,
              assessment_status: 'ASSESSED',
              assessment_artifact_id: ASSESSMENT_ID,
              findings: [FINDING],
              governed_layer_checks: [
                { layer: 'water', rule_id: 'LU-WATER-001', status: 'CHECKED_HIT', evidence_artifact_id: 'evidence-water-k0', reason: null },
                DOCUMENT_CHECK,
              ],
            },
          },
        ],
      });
    }
    return Promise.reject(new Error(`not mocked in this tolerance test: ${url}`));
  });
}

async function lookUp(user: ReturnType<typeof userEvent.setup>) {
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'GÄVLE BRYNÄS 1:1');
  await user.click(screen.getByTestId('lu-lookup'));
  expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
}

describe('K0b: the current LuWorkspace tolerates the server document check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyInfo.mockResolvedValue({
      id: 'p1', designation: 'GÄVLE BRYNÄS 1:1', municipality: 'Gävle',
      geometry: { type: 'Point', coordinates: [17.14, 60.67] }, centroid: { lat: 60.67, lng: 17.14 },
    });
  });

  it('fresh run: a "document" element in governed_layer_checks does not break the governed result or the existing checks', async () => {
    const user = userEvent.setup();
    mockApi({ persistedFromStart: false });
    await lookUp(user);
    await user.click(screen.getByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(await screen.findByTestId('lu-finding-finding-water-k0')).toBeInTheDocument();
    for (const key of ['property', 'water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area']) {
      expect(screen.getByTestId(`lu-check-${key}`)).toBeInTheDocument();
    }
  });

  it('reopen: a documentCheck field in current-assessment does not break the read-back view', async () => {
    const user = userEvent.setup();
    mockApi({ persistedFromStart: true });
    await lookUp(user);
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(await screen.findByTestId('lu-finding-finding-water-k0')).toBeInTheDocument();
    for (const key of ['property', 'water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area']) {
      expect(screen.getByTestId(`lu-check-${key}`)).toBeInTheDocument();
    }
  });
});
