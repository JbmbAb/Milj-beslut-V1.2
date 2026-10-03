/**
 * W-UI1 (B/C/D) -- the workspace with the new failure classes: a record whose integrity cannot be attested
 * (424 with the non-authoritative diagnostic, or a 200 that says RECORD_INTEGRITY_ERROR), a fresh run that
 * produced such a record (never ranked, never best), a site that is not ranked, the property root's transient
 * read fault, the "0 av M" invariant and internal terms in the server's visible text. Fully mocked: no
 * network, no database; read-backs are built by the server's own presentation functions (fixture).
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LuWorkspace } from '../../components/app/lu/LuWorkspace';
import { governedReadBack } from '../fixtures/luGovernedReadBack';

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
vi.mock('../../src/ui/api-client/geo.client', () => ({ fetchPropertyInfo: (...args: unknown[]) => fetchPropertyInfo(...args) }));
vi.mock('../../services/coreApiClient', () => ({
  callApi: (...args: unknown[]) => callApi(...args),
  getActiveProjectId: () => 'proj-1',
}));
let lastMapProps: any = null;
vi.mock('../../components/CesiumMapView', () => ({
  default: (props: any) => {
    lastMapProps = props;
    return <div data-testid="cesium-map-view" />;
  },
}));

const INTERNAL = /\bCAS\b|\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?::[^)]*)?\)/;
const apiError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });

const DIAGNOSTIC = {
  authoritative: false,
  verified: false,
  note_sv: 'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning.',
  assessment_artifact_id: 'assess-broken',
  basis_codes: ['UNKNOWN_SEVERITY'],
  stored_findings_unverified: {
    total: 2,
    highest_level: 'HIGH',
    counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 1, malformed: 0 },
    truncated: false,
    entries: [
      { check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true },
      { check: 'water', rule: 'LU-WATER-001', stored_level: 'UNKNOWN', well_formed: true },
    ],
  },
};
const RECORD_INTEGRITY_424 = () =>
  apiError(424, 'Bedömningen kan inte visas: ... (RECORD_INTEGRITY_ERROR: UNKNOWN_SEVERITY). ... Felet löses inte av ett nytt försök.', {
    code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR',
    failureClass: 'RECORD_INTEGRITY_ERROR',
    reasonCode: 'UNKNOWN_SEVERITY',
    retryable: false,
    record_integrity: DIAGNOSTIC,
  });

type Options = {
  currentAssessment: (call: number, ran: boolean) => unknown;
  run?: () => unknown;
  verify?: () => unknown;
};

function mockApi(opts: Options) {
  fetchPropertyInfo.mockResolvedValue({
    id: 'p1', designation: 'UPPSALA SVIA 1:111', municipality: 'Uppsala',
    geometry: { type: 'Point', coordinates: [17.74, 59.87] }, centroid: { lat: 59.87, lng: 17.74 },
  });
  let ran = false;
  let calls = 0;
  callApi.mockImplementation((url: string) => {
    if (url.includes('/current-assessment')) {
      const value = opts.currentAssessment(calls++, ran);
      if (value === 'missing') return Promise.reject(apiError(404, 'No current governed LU assessment is available for this project.'));
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (url.includes('/viewer/evidence')) return Promise.resolve({ type: 'FeatureCollection', features: [] });
    if (url.includes('/geometry')) {
      return Promise.resolve({
        ok: true,
        geometry: { artifact_id: 'loc-geom-1', provenance: 'derived_from_property_boundary', wgs84LngLat: [17.74, 59.87], provisioningStatus: 'COMPLETED' },
      });
    }
    if (url.includes('/generate-report')) {
      ran = true;
      return Promise.resolve(opts.run?.());
    }
    if (url.includes('/verify-assessment')) {
      const value = opts.verify?.();
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    throw new Error(`unexpected callApi call in this test: ${url}`);
  });
}

async function open() {
  const user = userEvent.setup();
  render(<LuWorkspace />);
  await user.type(screen.getByTestId('lu-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('lu-lookup'));
  expect(await screen.findByTestId('lu-site-ready')).toBeInTheDocument();
  return user;
}

const report = (motor: Record<string, unknown>, summary: Record<string, unknown>) => ({
  ok: true,
  siteAnalyses: [{ executionMotor: { admitted: true, findings: [], ...motor } }],
  summary: { comparison_status: 'PARTIAL', reasoning: 'x', assessed_site_ids: [], not_ranked_site_ids: [], unassessed_site_ids: [], ...summary },
});

describe('W-UI1: integrity, ranking and visible text in the workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastMapProps = null;
  });

  it('424 ASSESSMENT_RECORD_INTEGRITY_ERROR: "Postens integritet kan inte intygas", the stored findings only as a collapsed unverified diagnostic, no retry, no assessment form', async () => {
    mockApi({ currentAssessment: () => RECORD_INTEGRITY_424() });
    await open();
    const message = await screen.findByTestId('lu-persisted-assessment-error-message');
    expect(message).toHaveTextContent('Postens integritet kan inte intygas');
    expect(message).not.toHaveTextContent(/RECORD_INTEGRITY_ERROR|UNKNOWN_SEVERITY/);
    const diagnostic = screen.getByTestId('lu-persisted-assessment-error-diagnostic');
    expect(diagnostic).not.toHaveAttribute('open');
    expect(diagnostic).toHaveTextContent('Lagrade fynd – overifierad diagnostik (auktoritativ: nej)');
    expect(diagnostic).toHaveTextContent('Potentiellt förorenade områden (EBH) – lagrad nivå: hög (overifierad)');
    expect(screen.queryByTestId('lu-persisted-assessment-error-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-control-retry')).not.toBeInTheDocument();
    // Never the valid assessment form: no results, findings, verify or export.
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-findings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-verify-assessment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-export-pdf')).not.toBeInTheDocument();
    for (const layer of ['water', 'ebh']) expect(screen.getByTestId(`lu-check-${layer}`)).toHaveAttribute('data-state', 'TECHNICAL_ERROR');
    expect(lastMapProps.productEvidence.retryable).toBe(false);
  });

  it('a 200 read-back whose overall state is RECORD_INTEGRITY_ERROR is never shown as a valid assessment either (an older server)', async () => {
    mockApi({
      currentAssessment: () => ({
        ...governedReadBack({ id: 'assess-old-form', layers: { water: { kind: 'hit', risk: 'HIGH' } } }),
        overallStatement: { risk_level: 'HIGH', coverage_state: 'RECORD_INTEGRITY_ERROR', coverage_basis: ['UNKNOWN_SEVERITY:f-1'], coverage: null, statement_sv: 'Integritetsfel: ...' },
      }),
    });
    await open();
    expect(await screen.findByTestId('lu-persisted-assessment-error-message')).toHaveTextContent('Postens integritet kan inte intygas');
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lu-verify-assessment')).not.toBeInTheDocument();
    expect(screen.getByTestId('lu-check-water')).not.toHaveAttribute('data-state', 'HIT');
    expect(screen.getByTestId('lu-check-water')).not.toHaveAttribute('data-state', 'NO_HIT');
  });

  it('a fresh run that stored a record whose integrity cannot be attested: its own status, never ranked or best, the diagnostic collapsed', async () => {
    const user = await (async () => {
      mockApi({
        currentAssessment: (_call, ran) => (ran ? RECORD_INTEGRITY_424() : 'missing'),
        run: () =>
          report(
            { assessment_artifact_id: 'assess-broken', assessment_status: 'RECORD_INTEGRITY_ERROR', reason_codes: [], record_integrity: DIAGNOSTIC },
            { not_ranked_site_ids: ['site-uppsala-svia-1:111'], bestAlternativeId: 'site-uppsala-svia-1:111' },
          ),
      });
      return open();
    })();
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-run-outcome-status')).toHaveTextContent('Ingen giltig bedömning – postens integritet kan inte intygas');
    expect(screen.getByTestId('lu-run-outcome-message')).toHaveTextContent('Körningen skapade en post vars integritet inte kan intygas.');
    const ranking = screen.getByTestId('lu-site-ranking');
    expect(ranking).toHaveTextContent('Platsen rangordnas inte och kan inte vara bästa alternativ: postens integritet kan inte intygas.');
    expect(screen.getByTestId('lu-workspace')).not.toHaveTextContent(/[Bb]ästa alternativ(?!:)| är bästa/);
    const diagnostic = screen.getByTestId('lu-run-outcome-diagnostic');
    expect(diagnostic).not.toHaveAttribute('open');
    expect(diagnostic).toHaveTextContent('overifierad diagnostik (auktoritativ: nej)');
    expect(screen.queryByTestId('lu-results')).not.toBeInTheDocument();
  });

  it('a fresh ASSESSED run whose site is in not_ranked_site_ids says it is not ranked and why -- the assessment itself is shown', async () => {
    mockApi({
      currentAssessment: (_call, ran) => (ran ? governedReadBack({ id: 'assess-withheld', layers: { ebh: { kind: 'unavailable' } } }) : 'missing'),
      run: () => report({ assessment_artifact_id: 'assess-withheld', assessment_status: 'ASSESSED', assessment_projection_registered: true }, { not_ranked_site_ids: ['site-uppsala-svia-1:111'] }),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.getByTestId('lu-site-ranking')).toHaveTextContent('Platsen rangordnas inte och kan inte vara bästa alternativ: bedömningen kan inte jämföras med andra platser');
  });

  it('a ranked site gets no ranking line; a run with only the compatibility field and no assessment says it is not in the comparison', async () => {
    mockApi({
      currentAssessment: (_call, ran) => (ran ? governedReadBack({ id: 'assess-ranked' }) : 'missing'),
      run: () => report({ assessment_artifact_id: 'assess-ranked', assessment_status: 'ASSESSED', assessment_projection_registered: true }, { assessed_site_ids: ['site-uppsala-svia-1:111'], bestAlternativeId: 'site-uppsala-svia-1:111' }),
    });
    const user = await open();
    await user.click(await screen.findByTestId('lu-run'));
    expect(await screen.findByTestId('lu-results')).toBeInTheDocument();
    expect(screen.queryByTestId('lu-site-ranking')).not.toBeInTheDocument();
  });

  it('D: the property root could not be read just now (ROOT_READ_ERROR): a clear mark, "försök igen", a re-read -- nothing about authenticity', async () => {
    let rootFault = true;
    let callsAfterRepair = 0;
    mockApi({
      currentAssessment: () => {
        const base = governedReadBack({ id: 'assess-root' });
        if (!rootFault) callsAfterRepair += 1;
        return rootFault
          ? {
              ...base,
              propertyRoot: {
                ...base.propertyRoot,
                status: 'TECHNICAL_ERROR',
                technical_error_class: 'ROOT_READ_ERROR',
                message_sv: 'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas (ROOT_READ_ERROR).',
              },
            }
          : base;
      },
    });
    const user = await open();
    const chip = await screen.findByTestId('lu-check-state-property');
    await waitFor(() => expect(chip).toHaveTextContent('Hittad · fastighetsunderlagets proveniens kunde inte läsas just nu'));
    expect(screen.getByTestId('lu-check-property')).toHaveTextContent('Fastighetsrotens proveniens kunde inte läsas just nu (tekniskt fel); försök igen.');
    expect(screen.getByTestId('lu-check-property')).not.toHaveTextContent(/äkthet|äkta|ROOT_READ_ERROR/);
    rootFault = false;
    await user.click(screen.getByTestId('lu-control-retry'));
    await waitFor(() => expect(screen.getByTestId('lu-check-state-property')).toHaveTextContent('Hittad · lägre säkerhet i fastighetsunderlaget'));
    expect(callsAfterRepair).toBeGreaterThan(0);
    expect(screen.queryByTestId('lu-control-retry')).not.toBeInTheDocument();
  });

  it('C: no internal term of the server (CAS, a code in parentheses) reaches the visible text -- they stay under Teknisk information', async () => {
    mockApi({ currentAssessment: () => governedReadBack({ id: 'assess-unreadable', layers: { water: { kind: 'unreadable' } } }) });
    await open();
    await screen.findByTestId('lu-assessment-overall-statement');
    const visible = (el: HTMLElement) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('details').forEach((d) => d.remove());
      return clone.textContent ?? '';
    };
    expect(visible(screen.getByTestId('lu-workspace'))).not.toMatch(INTERNAL);
    expect(screen.getByTestId('lu-assessment-overall-statement')).toHaveTextContent('kunde inte läsas ur arkivet');
    expect(screen.getByTestId('lu-assessment-overall-technical')).toHaveTextContent('EVIDENCE_NOT_FOUND');
  });

  it('the "0 av M" invariant: a record that says no check was completed beside a stored risk finding is shown as contradictory', async () => {
    mockApi({
      currentAssessment: () => ({
        ...governedReadBack({ id: 'assess-zero', layers: { water: { kind: 'hit', risk: 'HIGH' } } }),
        overallStatement: {
          risk_level: 'HIGH',
          coverage_state: 'DETERMINED',
          coverage_basis: [],
          coverage: { checks_total: 6, checks_completed: 0, checks_not_completed: 6, checks_completed_with_limited_coverage: 0 },
          statement_sv: 'Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.',
        },
      }),
    });
    await open();
    const statement = await screen.findByTestId('lu-assessment-overall-statement');
    expect(statement).not.toHaveTextContent('0 av 6');
    expect(statement).toHaveTextContent('motsägelsefullt');
    expect(screen.getByTestId('lu-assessment-overall')).toHaveAttribute('data-tone', 'technical');
  });

  it('503 ASSESSMENT_PINNED_EVIDENCE_UNREADABLE on verify: "Försök igen" for a read error the server marks retryable, none for a lasting one', async () => {
    let answer: unknown = apiError(503, 'x', { code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', failureClass: 'READ_ERROR', reasonCode: 'ROOT_READ_ERROR', retryable: true });
    mockApi({ currentAssessment: () => governedReadBack({ id: 'assess-v' }), verify: () => answer });
    const user = await open();
    await user.click(await screen.findByTestId('lu-verify-assessment'));
    expect(await screen.findByTestId('lu-verify-error-message')).toHaveTextContent('Fastighetsrotens proveniens kunde inte läsas just nu');
    expect(screen.getByTestId('lu-verify-error-retry')).toBeInTheDocument();
    answer = apiError(503, 'x', { code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', failureClass: 'MISSING_FROM_CAS', reasonCode: 'EVIDENCE_NOT_FOUND', retryable: false });
    await act(async () => {
      await user.click(screen.getByTestId('lu-verify-assessment'));
    });
    await waitFor(() => expect(screen.getByTestId('lu-verify-error-message')).toHaveTextContent('kunde inte hämtas ur arkivet'));
    expect(screen.queryByTestId('lu-verify-error-retry')).not.toBeInTheDocument();
  });
});
